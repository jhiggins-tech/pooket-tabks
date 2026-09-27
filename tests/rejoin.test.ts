import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/game/constants';
import { createGame, setAim, step } from '../src/game/game';
import type { GameState, PlayerConfig } from '../src/game/state';
import { HostedRoom, joinRoom, rejoinRoom } from '../src/net/rooms';
import { Rtdb } from '../src/net/rtdb';
import { AUTO_REJOIN_MS, clearSeat, loadSeat, SEAT_EXPIRY_MS, saveSeat, touchSeat } from '../src/net/seat';
import { NetSession } from '../src/net/session';
import { takeSnapshot } from '../src/net/snapshot';
import { startRtdb, type FakeRtdb } from './support/rtdb';

let server: FakeRtdb;
let db: Rtdb;
beforeEach(async () => {
  server = await startRtdb();
  db = new Rtdb(server.url);
});
afterEach(async () => {
  await server.close();
});
const until = async (cond: () => boolean, ms = 8000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};
const fast = { pingMs: 100, lostMs: 500 };
const onStart = (seed: number, players: PlayerConfig[]) => createGame({ seed, players });
const PLAYERS: PlayerConfig[] = [
  { name: 'H', characterId: 'kcaj', colour: '#fc0' },
  { name: 'G', characterId: 'tones', colour: '#f55' },
];

async function match() {
  const room = await HostedRoom.open(db);
  const hostSide = room.waitForGuest(fast);
  const guest = new NetSession(await joinRoom(db, room.code, fast, 'guest-id'), 'guest');
  const host = new NetSession(await hostSide, 'host');
  for (const s of [host, guest]) s.onStart = onStart;
  host.setPick({ name: 'H', characterId: 'kcaj' });
  guest.setPick({ name: 'G', characterId: 'tones' });
  await until(() => host.ready && guest.ready);
  return { room, host, guest };
}

/** Step whichever phones are running until `done`. */
async function run(phones: [NetSession, GameState | null][], done: () => boolean, ms = 15_000) {
  const t0 = Date.now();
  while (!done()) {
    for (const [s, st] of phones) {
      if (st) step(st, FIXED_DT);
      s.tick(FIXED_DT);
    }
    await new Promise((r) => setTimeout(r, 1));
    if (Date.now() - t0 > ms) throw new Error('never got there');
  }
}

const same = (A: GameState, B: GameState) => {
  const strip = (s: GameState) => {
    const snap = takeSnapshot(s) as Record<string, unknown>;
    for (const k of ['floaters', 'shimmers', 'ghosts', 'explosions', 'splashes']) delete snap[k];
    return snap;
  };
  expect(strip(B)).toEqual(strip(A));
  expect(B.terrain.solid).toEqual(A.terrain.solid);
};

/** The guest's phone dies (no goodbye) and comes back as a brand new session on the same seat. */
async function guestComesBack(code: string, old: NetSession, whileAway: () => Promise<void> = async () => {}) {
  (old as unknown as { transport: { close(): void } }).transport.close();
  await whileAway();
  const back = new NetSession(await rejoinRoom(db, code, 'guest', 'guest-id', fast), 'guest');
  back.onStart = onStart;
  let resumed: boolean | null = null;
  back.onResumed = (inMatch) => (resumed = inMatch);
  back.rejoin();
  return { back, resumed: () => resumed };
}

describe('rejoining a match', { timeout: 60_000 }, () => {
  it('a phone that drops out mid-match comes back to the same game and plays on', async () => {
    const { room, host, guest } = await match();
    const away: boolean[] = [];
    host.onPeerAway = (a) => away.push(a);
    host.start(99, PLAYERS);
    await until(() => !!guest.game);
    const H = host.game!;
    // The host takes a turn, both in sync.
    setAim(H, 60, 60);
    host.fire();
    await run([[host, H], [guest, guest.game]], () => guest.canAct() && H.phase === 'aiming' && guest.game!.phase === 'aiming');

    // The guest's phone vanishes; the host notices, and waits.
    const { back, resumed } = await guestComesBack(room.code, guest, () => run([[host, H]], () => away.length > 0));
    expect(away).toEqual([true]);
    expect(host.peerAway).toBe(true);
    expect(back.canAct()).toBe(false); // not until it's caught up
    await run([[host, H], [back, back.game]], () => resumed() !== null);
    expect(resumed()).toBe(true);
    expect(away).toEqual([true, false]);
    const G = back.game!;
    same(H, G);
    expect(back.localPick?.name).toBe('G');
    expect(back.remotePick?.name).toBe('H');

    // And it's the guest's turn, so it plays on.
    expect(back.canAct()).toBe(true);
    setAim(G, 120, 55);
    expect(back.fire()).toBe(true);
    await run([[host, H], [back, G]], () => host.canAct() && H.turn === G.turn && H.phase === 'aiming' && G.phase === 'aiming');
    same(H, G);
    host.leave();
  });

  it('dropping out mid-shot: the other phone plays the shot out and its result stands', async () => {
    const { room, host, guest } = await match();
    host.start(99, [PLAYERS[1]!, PLAYERS[0]!].map((p, i) => ({ ...p, name: i ? 'G' : 'H' })));
    await until(() => !!guest.game);
    const H = host.game!;
    // Host's turn first; pass it to the guest.
    setAim(H, 60, 60);
    host.fire();
    const G0 = guest.game!;
    await run([[host, H], [guest, G0]], () => guest.canAct() && G0.phase === 'aiming' && H.phase === 'aiming');
    // The guest fires, and its phone dies before the result goes out.
    setAim(G0, 120, 60);
    guest.fire();
    await new Promise((r) => setTimeout(r, 300));
    const { back, resumed } = await guestComesBack(room.code, guest);
    await run([[host, H], [back, back.game]], () => resumed() !== null);
    expect(resumed()).toBe(true);
    const G = back.game!;
    same(H, G);
    expect(H.phase).toBe('aiming');
    expect(H.turn).toBe(3); // the guest's shot played out on the host
    expect(host.canAct()).toBe(true); // and the host isn't left waiting for a result that'll never come
    host.leave();
  });

  it('dropping out in the lobby comes back to the lobby', async () => {
    const { room, host, guest } = await match();
    const { back, resumed } = await guestComesBack(room.code, guest);
    await run([[host, null], [back, null]], () => resumed() !== null);
    expect(resumed()).toBe(false);
    expect(back.game).toBeNull();
    expect(back.remotePick?.name).toBe('H');
    host.leave();
  });

  it('a room the host has closed can’t be rejoined', async () => {
    const { room, host } = await match();
    host.leave();
    await until(() => !server.tree().rooms, 5000);
    await expect(rejoinRoom(db, room.code, 'guest', 'guest-id')).rejects.toThrow(/has ended/);
  });
});

describe('remembered seat', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };

  it('remembers the room, role and seat id, until cleared or too old', () => {
    const s = mem();
    expect(loadSeat(s)).toBeNull();
    saveSeat({ code: 'FROG', role: 'guest', id: 'abc' }, s, 1000);
    expect(loadSeat(s, 1000 + AUTO_REJOIN_MS)).toEqual({ code: 'FROG', role: 'guest', id: 'abc', ts: 1000 });
    touchSeat(s, 5000);
    expect(loadSeat(s, 5000)?.ts).toBe(5000);
    expect(loadSeat(s, 5000 + SEAT_EXPIRY_MS + 1)).toBeNull();
    clearSeat(s);
    expect(loadSeat(s, 5000)).toBeNull();
  });

  it('ignores junk', () => {
    const s = mem();
    s.setItem('pooket.seat', '{"code":"FROG","role":"boss","id":"x","ts":1}');
    expect(loadSeat(s, 1)).toBeNull();
    s.setItem('pooket.seat', 'not json');
    expect(loadSeat(s, 1)).toBeNull();
  });
});

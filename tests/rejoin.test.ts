import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGame, setAim } from '../src/game/game';
import type { PlayerConfig } from '../src/game/state';
import { RoomChannel } from '../src/net/channel';
import { HostedRoom, joinRoom, rejoinRoom, type RoomRef } from '../src/net/rooms';
import { Rtdb } from '../src/net/rtdb';
import { AUTO_REJOIN_MS, findSeat, forgetSeat, GAMES_KEY, latestSeat, loadSeats, SEAT_EXPIRY_MS, saveSeat, touchSeat, updateSeat } from '../src/net/seat';
import { loadRecord } from '../src/net/record';
import { NetSession } from '../src/net/session';
import { startRtdb, type FakeRtdb } from './support/rtdb';
import { expectSameMatch, runPhones, type Phone } from './support/net';
import { until, untilAsync } from './support/wait';

let server: FakeRtdb;
let db: Rtdb;
beforeEach(async () => {
  server = await startRtdb();
  db = new Rtdb(server.url);
});
afterEach(async () => {
  await server.close();
});
const onStart = (seed: number, players: PlayerConfig[], first: number) => createGame({ seed, players, first });
const PLAYERS: PlayerConfig[] = [
  { name: 'H', characterId: 'kcaj', colour: '#fc0' },
  { name: 'G', characterId: 'tones', colour: '#f55' },
];

/** A session on a seat in a room, through the fake Firebase. */
function session(room: RoomRef, role: 'host' | 'guest'): NetSession {
  const s = new NetSession(new RoomChannel(room, role), role);
  s.onStart = onStart;
  return s;
}

/** The host opens a game; the guest joins it and starts the match; the host, still there, goes into it. */
async function match() {
  const hosted = await HostedRoom.open(db, { host: { name: 'H', characterId: 'kcaj' }, listed: false });
  const started = hosted.waitForMatch();
  const { room, offer } = await joinRoom(db, hosted.code, 'guest-id');
  expect(offer.host.name).toBe('H');
  const guest = session(room, 'guest');
  guest.start(99, PLAYERS);
  const host = session(hosted.ref, 'host');
  host.open((await started).rec);
  return { hosted, host, guest };
}

/** Step whichever phones are running until `done` (in real time: it all goes through the fake Firebase). */
const run = (phones: Phone[], done: () => boolean, ms = 15_000) => runPhones(phones, done, { ms });

describe('a match through Firebase', { timeout: 60_000 }, () => {
  it('the joiner starts it and goes first; the host sees each move play out live, and plays on', async () => {
    const { host, guest } = await match();
    const H = host.game!;
    const G = guest.game!;
    expectSameMatch(H, G);
    expect(guest.canAct()).toBe(true);
    await run([[host, H], [guest, G]], () => !host.peerAway && !guest.peerAway); // (the live dots)
    setAim(G, 120, 60);
    guest.fire();
    await run([[host, H], [guest, G]], () => host.canAct() && H.phase === 'aiming' && G.phase === 'aiming' && H.turn === G.turn);
    expectSameMatch(H, G);
    setAim(H, 60, 55);
    expect(host.fire()).toBe(true);
    await run([[host, H], [guest, G]], () => guest.canAct() && H.turn === G.turn && H.phase === 'aiming' && G.phase === 'aiming');
    expectSameMatch(H, G);
    host.away();
    guest.away();
  });

  it('take your turn and leave; the other comes back later, is shown it, takes theirs, and so on', async () => {
    const { hosted, host, guest } = await match();
    host.away(); // the host goes back to the menu
    const G = guest.game!;
    await run([[guest, G]], () => guest.peerAway);
    setAim(G, 120, 60);
    guest.fire();
    await run([[guest, G]], () => G.turn === 2 && G.phase === 'aiming');
    await untilAsync(async () => (await loadRecord(db, hosted.code))?.rec.snap.turn === 2);
    guest.away();
    await new Promise((r) => setTimeout(r, 300));
    expect(server.tree().rooms).toBeTruthy();

    // The host opens the game: the guest's go again, then its own.
    const room = await rejoinRoom(db, hosted.code, 'host', hosted.id);
    const back = session(room, 'host');
    back.open((await loadRecord(db, hosted.code))!.rec, host.seen);
    expect(back.replaying).toBe(true);
    await run([[back, back.game]], () => back.canAct(), 20_000);
    expectSameMatch(G, back.game!);
    const H = back.game!;
    setAim(H, 60, 55);
    back.fire();
    await run([[back, H]], () => H.turn === 3 && H.phase === 'aiming');
    back.away();

    // The guest comes back to its turn.
    await untilAsync(async () => (await loadRecord(db, hosted.code))?.rec.snap.turn === 3);
    const again = session(await rejoinRoom(db, hosted.code, 'guest', 'guest-id'), 'guest');
    again.open((await loadRecord(db, hosted.code))!.rec, guest.seen);
    await run([[again, again.game]], () => again.canAct(), 20_000);
    expectSameMatch(H, again.game!);
  });

  it('dropping out mid-shot: the other phone plays the shot out and its result stands', async () => {
    const { host, guest } = await match();
    const H = host.game!;
    const G = guest.game!;
    await run([[host, H], [guest, G]], () => !host.peerAway);
    setAim(G, 120, 60);
    guest.fire();
    await new Promise((r) => setTimeout(r, 300));
    guest.away(); // gone mid-shot (it said so: its seat isn't here any more)
    await run([[host, H]], () => host.canAct());
    expect(H.turn).toBe(2); // the guest's shot played out on the host
    await new Promise((r) => setTimeout(r, 300));
  });

  it('a record that isn’t newer than the one there is refused', async () => {
    const { hosted } = await match();
    const path = `${hosted.ref.path}/game`;
    await until(() => (server.at(path) as { n?: number } | null)?.n === 1);
    await expect(db.put(path, { m: 'x', ts: Date.now(), n: 1 })).rejects.toThrow(/denied/i);
    await db.put(path, { m: 'x', ts: Date.now(), n: 2 });
  });

  it('a room the host has cancelled can’t be rejoined', async () => {
    const hosted = await HostedRoom.open(db, { host: { name: 'H', characterId: 'kcaj' }, listed: false });
    hosted.cancel();
    await until(() => !server.tree().rooms, 5000);
    await expect(rejoinRoom(db, hosted.code, 'guest', 'guest-id')).rejects.toThrow(/has ended/);
  });

  it("a room with a match in it isn't taken over by a new host, until the match is four days old", async () => {
    const { hosted, host, guest } = await match();
    host.away();
    guest.away();
    await new Promise((r) => setTimeout(r, 200));
    const path = hosted.ref.path;
    const hourAgo = Date.now() - 2 * 3_600_000;
    await db.put(`${path}/host`, { id: hosted.id, ts: hourAgo });
    await db.put(`${path}/game`, { m: 'x', ts: Date.now() });
    await expect(db.put(`${path}/host`, { id: 'someone-else', ts: Date.now() })).rejects.toThrow(/denied/i);
    await db.put(`${path}/game`, { m: 'x', ts: Date.now() - 5 * 24 * 3_600_000 });
    await db.put(`${path}/host`, { id: 'someone-else', ts: Date.now() });
  });
});

describe('remembered seats (My games)', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };

  it('remembers each match (room, role, seat id), newest first, until forgotten or too old', () => {
    const s = mem();
    expect(latestSeat(s)).toBeNull();
    saveSeat({ code: 'FROG', role: 'guest', id: 'abc' }, s, 1000);
    expect(latestSeat(s, 1000 + AUTO_REJOIN_MS)).toEqual({ code: 'FROG', role: 'guest', id: 'abc', left: false, ts: 1000, at: 1000 });
    saveSeat({ code: 'TOAD', role: 'host', id: 'def' }, s, 2000);
    expect(loadSeats(s, 2000).map((x) => x.code)).toEqual(['TOAD', 'FROG']);
    touchSeat('FROG', s, 5000);
    expect(latestSeat(s, 5000)?.code).toBe('FROG');
    updateSeat('FROG', { left: true, seen: 7 }, s, 5000);
    expect(findSeat('FROG', s, 5000)).toMatchObject({ left: true, seen: 7, ts: 5000 });
    saveSeat({ code: 'FROG', role: 'guest', id: 'abc' }, s, 6000); // back in it
    expect(findSeat('FROG', s, 6000)).toMatchObject({ left: false, seen: 7 });
    expect(findSeat('TOAD', s, 2000 + SEAT_EXPIRY_MS + 1)).toBeNull();
    forgetSeat('FROG', s, 6000);
    expect(loadSeats(s, 6000).map((x) => x.code)).toEqual(['TOAD']);
  });

  it("takes over an older version's single seat", () => {
    const s = mem();
    s.setItem('pooket.seat', JSON.stringify({ code: 'FROG', role: 'host', id: 'x', ts: 1 }));
    expect(latestSeat(s, 1)?.code).toBe('FROG');
    saveSeat({ code: 'TOAD', role: 'guest', id: 'y' }, s, 2);
    expect(s.getItem('pooket.seat')).toBeNull();
    expect(loadSeats(s, 2).map((x) => x.code)).toEqual(['TOAD', 'FROG']);
  });

  it('ignores junk', () => {
    const s = mem();
    s.setItem(GAMES_KEY, '[{"code":"FROG","role":"boss","id":"x","ts":1}]');
    expect(latestSeat(s, 1)).toBeNull();
    s.setItem(GAMES_KEY, 'not json');
    expect(latestSeat(s, 1)).toBeNull();
  });
});

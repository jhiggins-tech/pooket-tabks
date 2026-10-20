import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/game/constants';
import { createGame, setAim, step } from '../src/game/game';
import type { GameState, PlayerConfig } from '../src/game/state';
import { HostedRoom, joinRoom } from '../src/net/rooms';
import { watchRoom } from '../src/net/view';
import { RoomChannel } from '../src/net/channel';
import { Rtdb } from '../src/net/rtdb';
import { NetSession, type ViewMsg } from '../src/net/session';
import { Spectator } from '../src/net/spectate';
import { startRtdb, type FakeRtdb } from './support/rtdb';
import { connectedPair, expectSameMatch } from './support/net';
import { flush, until } from './support/wait';

const players: PlayerConfig[] = [
  { name: 'H', characterId: 'kcaj', colour: '#fc0' },
  { name: 'G', characterId: 'tones', colour: '#f55' },
];
const build = (seed: number, p: PlayerConfig[], first = 0) => createGame({ seed, players: p, first });
/** Two players in a room in memory, with the spectator feed going to `feed`. */
async function match(feed: (v: ViewMsg) => void) {
  const { a, b, A, B } = await connectedPair({ seed: 77, players, onStart: build, onView: feed });
  return { host: a, guest: b, H: A, G: B };
}

/** Fire for whoever's turn it is and play both phones (and the spectator) until the next turn. */
async function turn(host: NetSession, guest: NetSession, H: GameState, G: GameState, extra?: () => void) {
  const [me, S] = H.current === 0 ? [host, H] : [guest, G];
  setAim(S, S.current === 0 ? 55 : 125, 62);
  expect(me.fire()).toBe(true);
  const next = S.current === 0 ? guest : host;
  for (let i = 0; i < 120 * 30; i++) {
    step(H, FIXED_DT);
    step(G, FIXED_DT);
    host.tick(FIXED_DT);
    guest.tick(FIXED_DT);
    extra?.();
    if (i % 8 === 0) await flush();
    if (next.canAct() && H.phase === 'aiming' && G.phase === 'aiming' && H.turn === G.turn && i > 10) break;
  }
  await flush();
}

describe('spectating', { timeout: 60_000 }, () => {
  it('a spectator from the start sees the same match: every shot replayed, every result applied', async () => {
    const sp = new Spectator();
    sp.onStart = build;
    const { host, guest, H, G } = await match((v) => sp.receive(v));
    expect(sp.game).not.toBeNull();
    expectSameMatch(H, sp.game!);
    for (let t = 0; t < 3; t++) {
      await turn(host, guest, H, G, () => {
        step(sp.game!, FIXED_DT);
        sp.tick(FIXED_DT);
      });
      for (let i = 0; i < 120 * 5; i++) {
        step(sp.game!, FIXED_DT);
        sp.tick(FIXED_DT);
      }
      expectSameMatch(H, sp.game!);
    }
  });

  it('joining mid-match from just the latest state catches straight up', async () => {
    let latest: ViewMsg | null = null;
    const { host, guest, H, G } = await match((v) => v.k === 'state' && (latest = v));
    await turn(host, guest, H, G);
    await turn(host, guest, H, G);
    const sp = new Spectator();
    sp.onStart = build;
    sp.receive(latest!);
    expectSameMatch(H, sp.game!);
  });

  it("sees the live aim, but can't be steered by it after a shot", async () => {
    const sp = new Spectator();
    sp.onStart = build;
    const { guest, G } = await match((v) => sp.receive(v));
    setAim(G, 33, 44); // (the guest's go first)
    for (let i = 0; i < 20; i++) guest.tick(FIXED_DT);
    await flush();
    expect([sp.game!.players[1]!.angle, sp.game!.players[1]!.power]).toEqual([33, 44]);
  });
});

describe('spectating through Firebase', () => {
  let server: FakeRtdb;
  let db: Rtdb;
  beforeEach(async () => {
    server = await startRtdb();
    db = new Rtdb(server.url);
  });
  afterEach(async () => {
    await server.close();
  });
  it('players publish, a watcher with the code follows along, and is told when the room closes', { timeout: 30_000 }, async () => {
    const room = await HostedRoom.open(db, { host: { name: 'H', characterId: 'kcaj' }, listed: false });
    const joined = await joinRoom(db, room.code);
    const guest = new NetSession(new RoomChannel(joined.room, 'guest'), 'guest');
    guest.onStart = build;
    guest.start(5, players);
    const stored = await room.waitForMatch();
    const host = new NetSession(new RoomChannel(room.ref, 'host'), 'host');
    host.onStart = build;
    host.open(stored.rec);

    const sp = new Spectator();
    sp.onStart = build;
    let ended = false;
    await watchRoom(db, room.code, (v) => sp.receive(v), () => (ended = true));
    await until(() => !!sp.game);
    expectSameMatch(host.game!, sp.game!);
    // Nothing readable in the database.
    expect(JSON.stringify(server.tree())).not.toContain('kcaj');

    await expect(watchRoom(db, 'ZZZZ', () => {}, () => {})).rejects.toThrow(/No game/);
    host.away();
    guest.away();
    await db.put(room.ref.path, null); // the room closes (Cancel game)
    await until(() => ended);
  });
});

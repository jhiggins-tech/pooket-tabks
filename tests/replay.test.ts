import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/game/constants';
import { createGame, selectTier, setAim, step } from '../src/game/game';
import type { GameState, PlayerConfig } from '../src/game/state';
import { Rtdb } from '../src/net/rtdb';
import { loadReplay, loadReplays, REPLAY_KEEP_MS, ReplayPlayer, ReplayRecorder } from '../src/net/replay';
import { toB64 } from '../src/net/b64';
import { seal, sealerFor } from '../src/net/seal';
import { NetSession } from '../src/net/session';
import { loopback } from '../src/net/transport';
import { OLDEST_RULES, RULES, WIRE } from '../src/net/version';
import { startRtdb, type FakeRtdb } from './support/rtdb';
import { flush, settled } from './support/wait';

let server: FakeRtdb;
let db: Rtdb;
let lobbyN = 0;

beforeAll(async () => {
  server = await startRtdb();
  db = new Rtdb(server.url);
});
afterAll(() => server.close());

const PLAYERS: PlayerConfig[] = [
  { name: 'A', characterId: 'larinovsky', colour: '#f00' },
  { name: 'B', characterId: 'kcaj', colour: '#00f' },
];
const onStart = (seed: number, players: PlayerConfig[]) => createGame({ seed, players, first: 0 });

/** Two phones over a loopback, each recording replays into the fake database (as on the Games list `lobby`). */
async function connected(lobby: string, publicReplay = true) {
  const [ta, tb] = loopback();
  const a = new NetSession(ta, 'host');
  const b = new NetSession(tb, 'guest');
  for (const s of [a, b]) {
    s.onStart = onStart;
    s.store = new ReplayRecorder(db, lobby);
  }
  a.publicReplay = publicReplay;
  a.setPick({ name: 'A', characterId: 'larinovsky' });
  b.setPick({ name: 'B', characterId: 'kcaj' });
  await flush();
  a.start(4321, PLAYERS);
  await flush();
  return { a, b };
}

/** Run both phones (and their games) until `done`. */
async function run(phones: NetSession[], done: () => boolean, seconds = 60) {
  for (let t = 0; t < seconds && !done(); t += FIXED_DT) {
    for (const s of phones) {
      if (s.game) step(s.game, FIXED_DT);
      s.tick(FIXED_DT);
    }
    await flush();
  }
  expect(done()).toBe(true);
}

/** Wait for the database to have caught up (writes are queued). */
async function until(done: () => Promise<boolean>) {
  for (let i = 0; i < 100 && !(await done()); i++) await new Promise((r) => setTimeout(r, 20));
  expect(await done()).toBe(true);
}

describe('replays', () => {
  it("records a public match's shots (bonus moves too) and how it ended, and plays it back", async () => {
    const lobby = `replays-${++lobbyN}`;
    const { a, b } = await connected(lobby);
    const [A, B] = [a.game!, b.game!];
    // Turn 1: larinovsky's bonus move, then a shot. Turn 2: kcaj shoots. Then kcaj resigns.
    selectTier(A, 3);
    expect(a.fire()).toBe(true);
    setAim(A, 60, 40);
    expect(a.fire()).toBe(true);
    await run([a, b], settled(b, 2));
    setAim(B, 120, 40);
    expect(b.fire()).toBe(true);
    await run([a, b], settled(a, 3));
    b.resign();
    await run([a, b], () => A.phase === 'gameover');

    await until(async () => (await loadReplays(db, lobby)).length === 1);
    const [listing] = await loadReplays(db, lobby);
    expect(listing).toMatchObject({ seed: 4321, players: PLAYERS, over: { winner: 0, endReason: 'resigned', turns: 3 } });
    let replay = await loadReplay(db, listing!);
    await until(async () => (replay = await loadReplay(db, listing!)).end !== null);
    expect(replay.shots.map((s) => [s.turn, s.owner])).toEqual([[1, 0], [1, 0], [2, 1]]);
    expect(replay.shots[0]!.snap.players).toMatchObject([{ ammo: [5, 3, 1, 1] }, {}]); // the bonus move first

    // Played back: every shot, then how it ended.
    const player = new ReplayPlayer(replay);
    let g: GameState | null = null;
    player.onStart = (seed, players) => (g = onStart(seed, players));
    let shots = 0;
    let was = '';
    for (let t = 0; t < 120 && !player.finished; t += FIXED_DT) {
      if (g) step(g, FIXED_DT);
      player.tick(FIXED_DT);
      const now = player.game?.phase ?? '';
      if (now === 'flying' && was !== 'flying') shots++;
      was = now;
    }
    expect(player.finished).toBe(true);
    expect(shots).toBe(2); // (the bonus move isn't a flying shot)
    expect(player.game!.phase).toBe('gameover');
    expect(player.game!.winner?.name).toBe('A');
    expect(player.game!.players.map((p) => p.hp)).toEqual(A.players.map((p) => p.hp));

    // Watch again: from the top.
    player.restart();
    player.tick(FIXED_DT);
    expect(player.finished).toBe(false);
    expect(player.game!.turn).toBe(1);
  });

  it("isn't recorded for a private match", async () => {
    const lobby = `replays-${++lobbyN}`;
    const replays = () => Object.keys((server.tree().replays as object | undefined) ?? {}).length;
    const before = replays();
    const { a, b } = await connected(lobby, false);
    setAim(a.game!, 60, 40);
    a.fire();
    await run([a, b], settled(b, 2));
    b.resign();
    await new Promise((r) => setTimeout(r, 100));
    expect(replays()).toBe(before);
    expect(await db.get(`replayList/${(await sealerFor('replays', lobby)).topic}`)).toBeNull();
  });

  it('lists only finished matches, and tidies away old ones', async () => {
    const lobby = `replays-${++lobbyN}`;
    const { a, b } = await connected(lobby);
    await until(async () => !!(await db.get(`replayList/${(await sealerFor('replays', lobby)).topic}`)));
    expect(await loadReplays(db, lobby)).toEqual([]); // under way: not a replay yet
    b.resign();
    await until(async () => (await loadReplays(db, lobby)).length === 1);
    void a;

    // Two weeks on, it's gone (replay and all).
    const [listing] = await loadReplays(db, lobby);
    const topic = (await sealerFor('replay', listing!.id)).topic;
    expect(await db.get(`replays/${topic}/end`)).not.toBeNull();
    expect(await loadReplays(db, lobby, Date.now() + REPLAY_KEEP_MS + 60_000)).toEqual([]);
    await until(async () => (await db.get(`replays/${topic}`)) === null);
    expect(await loadReplays(db, lobby)).toEqual([]);
  });

  it("doesn't list a replay this build can't play (older rules than it carries on, or another wire format)", async () => {
    const lobby = `replays-${++lobbyN}`;
    const sealer = await sealerFor('replays', lobby);
    const put = async (key: string, listing: Record<string, unknown>) =>
      db.put(`replayList/${sealer.topic}/${key}`, { m: toB64(await seal(sealer, listing)), ts: Date.now() });
    const over = { winner: 0, endReason: null, turns: 4 };
    await put('ok', { id: 'ok', v: WIRE, rules: RULES, seed: 1, players: PLAYERS, over });
    await put('old', { id: 'old', v: WIRE, rules: OLDEST_RULES - 1, seed: 1, players: PLAYERS, over });
    await put('newer', { id: 'newer', v: WIRE + 1, rules: RULES, seed: 1, players: PLAYERS, over });
    await put('unversioned', { id: 'unversioned', seed: 1, players: PLAYERS, over });
    expect((await loadReplays(db, lobby)).map((r) => r.id)).toEqual(['ok']);
  });
});

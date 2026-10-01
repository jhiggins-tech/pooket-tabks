import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/game/constants';
import { createGame, currentPlayer, selectTier, setAim, step } from '../src/game/game';
import type { GameState, PlayerConfig } from '../src/game/state';
import { FORFEIT_MS, forfeitDue, gameStatus, opponentName, type GameRecord, type GameStore, type StoredGame } from '../src/net/record';
import { NetSession, RESUME_WAIT } from '../src/net/session';
import { OLDEST_RULES, RULES, WIRE } from '../src/net/version';
import { takeSnapshot } from '../src/net/snapshot';
import { loopback } from '../src/net/transport';
import { decodeMsg, encodeMsg } from '../src/net/wire';
import { flush, settled } from './support/wait';

/** The room's record, in memory (copied through the wire format, like the real thing). */
class MemoryStore implements GameStore {
  rec: GameRecord | null = null;
  saves = 0;
  save(rec: GameRecord): void {
    this.rec = decodeMsg(encodeMsg(rec)) as GameRecord;
    this.saves++;
  }
}

const PLAYERS: PlayerConfig[] = [
  { name: 'A', characterId: 'tones', colour: '#f00' },
  { name: 'B', characterId: 'kcaj', colour: '#00f' },
];
const onStart = (seed: number, players: PlayerConfig[]) => createGame({ seed, players, first: 0 });

async function connected(store: MemoryStore) {
  const [ta, tb] = loopback();
  const a = new NetSession(ta, 'host');
  const b = new NetSession(tb, 'guest');
  for (const s of [a, b]) {
    s.onStart = onStart;
    s.store = store;
  }
  a.setPick({ name: 'A', characterId: 'tones' });
  b.setPick({ name: 'B', characterId: 'kcaj' });
  await flush();
  a.start(4321, PLAYERS);
  await flush();
  return { a, b, A: a.game!, B: b.game! };
}

/** A phone coming back to the match with nobody else there (its pipe leads nowhere). */
function alone(role: 'host' | 'guest'): NetSession {
  const [t] = loopback();
  const s = new NetSession(t, role);
  s.onStart = onStart;
  return s;
}

/** Run the phones (and their games) until `done`. */
async function run(phones: [NetSession, () => GameState | null][], done: () => boolean, seconds = 60) {
  for (let t = 0; t < seconds && !done(); t += FIXED_DT) {
    for (const [s, g] of phones) {
      const st = g();
      if (st) step(st, FIXED_DT);
      s.tick(FIXED_DT);
    }
    await flush();
  }
  expect(done()).toBe(true);
}

const strip = (s: GameState) => {
  const snap = takeSnapshot(s) as Record<string, unknown>;
  for (const k of ['floaters', 'shimmers', 'ghosts', 'explosions', 'splashes', 'sfx']) delete snap[k];
  return snap;
};

describe('the game record', () => {
  it('is written when the match starts, when a shot is fired and when it has played out', async () => {
    const store = new MemoryStore();
    const { a, b, A } = await connected(store);
    expect(store.rec).toMatchObject({ v: WIRE, rules: RULES, setup: { seed: 4321, rules: RULES }, last: null, flying: null });
    expect(store.rec!.snap.turn).toBe(1);
    setAim(A, 60, 40);
    a.fire();
    expect(store.rec!.flying).toMatchObject({ turn: 1, owner: 0 });
    await run([[a, () => a.game], [b, () => b.game]], settled(a, 2));
    expect(store.rec!.flying).toBeNull();
    expect(store.rec!.last).toMatchObject({ turn: 1, owner: 0 });
    expect(store.rec!.snap.turn).toBe(2);
    expect(store.rec!.snap).toMatchObject({ current: 1, phase: 'aiming' });
  });

  it('take your turn and leave; the other player opens the game later, watches it, and takes theirs', async () => {
    const store = new MemoryStore();
    const { a, b, A } = await connected(store);
    b.away(); // the guest leaves for now
    await flush();
    expect(a.peerAway).toBe(true);
    setAim(A, 60, 40);
    a.fire();
    await run([[a, () => a.game]], settled(a, 2));
    const hostSees = strip(a.game!);
    a.away(); // and the host goes too

    // Later: the guest opens the game. Nobody answers, so it goes by the record: their shot again, then its go.
    const back = alone('guest');
    back.store = store;
    let resumed = false;
    back.on('resumed', () => (resumed = true));
    back.rejoin({ rec: store.rec!, replay: true });
    await run([[back, () => back.game]], () => resumed, RESUME_WAIT + 1);
    expect(back.game!.turn).toBe(1); // replaying the host's shot
    expect(back.game!.phase).not.toBe('aiming');
    expect(back.canAct()).toBe(false);
    await run([[back, () => back.game]], () => back.canAct());
    expect(strip(back.game!)).toEqual(hostSees);
    expect(back.remotePick).toEqual({ name: 'A', characterId: 'tones' });
    expect(back.peerAway).toBe(true);

    // Its turn, recorded for the host to find.
    setAim(back.game!, 120, 40);
    expect(back.fire()).toBe(true);
    await run([[back, () => back.game]], settled(back, 3));
    expect(store.rec!.snap.turn).toBe(3);
    expect(store.rec!.last).toMatchObject({ turn: 2, owner: 1 });
  });

  it("a phone that vanished mid-shot doesn't undo it: whoever opens the game next plays it out and records the result", async () => {
    const store = new MemoryStore();
    const { a, b, A } = await connected(store);
    b.away();
    await flush();
    setAim(A, 60, 40);
    a.fire();
    for (let i = 0; i < 20; i++) step(A, FIXED_DT);
    a.away(); // gone mid-shot
    expect(store.rec!.flying).toMatchObject({ turn: 1, owner: 0 });

    const back = alone('guest');
    back.store = store;
    back.rejoin({ rec: store.rec!, replay: true });
    await run([[back, () => back.game]], () => back.canAct());
    expect(back.game!.turn).toBe(2);
    expect(store.rec!.flying).toBeNull();
    expect(store.rec!.snap.turn).toBe(2);
    expect(store.rec!.last).toMatchObject({ turn: 1, owner: 0 });
  });

  it('the shooter coming back to its own shot in flight plays it out and records it too', async () => {
    const store = new MemoryStore();
    const { a, b, A } = await connected(store);
    b.away();
    setAim(A, 60, 40);
    a.fire();
    a.away();
    const back = alone('host');
    back.store = store;
    back.rejoin({ rec: store.rec!, replay: false });
    await run([[back, () => back.game]], settled(back, 2));
    await run([[back, () => back.game]], () => store.rec!.snap.turn === 2, 1);
    expect(back.canAct()).toBe(false); // the guest's turn now
  });

  it('when both open the game at once, both go by the record (nobody half-catches the other up)', async () => {
    const store = new MemoryStore();
    const { a, b, A } = await connected(store);
    setAim(A, 60, 40);
    a.fire();
    await run([[a, () => a.game], [b, () => b.game]], settled(b, 2));
    a.away();
    b.away();
    const [ta, tb] = loopback();
    const a2 = new NetSession(ta, 'host');
    const b2 = new NetSession(tb, 'guest');
    for (const s of [a2, b2]) {
      s.onStart = onStart;
      s.store = store;
      s.rejoin({ rec: store.rec!, replay: false });
    }
    await run([[a2, () => a2.game], [b2, () => b2.game]], () => !!a2.game && !!b2.game && b2.canAct());
    expect(strip(a2.game!)).toEqual(strip(b2.game!));
    expect(a2.peerAway || b2.peerAway).toBe(false); // they've heard from each other since
  });

  it('with the other phone there, it catches us up as before (the record is only the fallback)', async () => {
    const store = new MemoryStore();
    const { a, b } = await connected(store);
    let caughtUp = false;
    // The guest reloads: a fresh session on a fresh pipe to the same host.
    const [ta, tb] = loopback();
    (a as unknown as { transport: unknown }).transport = ta;
    ta.onMessage = (m) => (a as unknown as { receive(m: unknown): void }).receive(m);
    const back = new NetSession(tb, 'guest');
    back.onStart = onStart;
    back.on('resumed', () => (caughtUp = true));
    const saves = store.saves;
    back.rejoin({ rec: store.rec!, replay: true });
    await run([[a, () => a.game], [back, () => back.game]], () => caughtUp, 1);
    expect(back.peerAway).toBe(false);
    expect(store.saves).toBe(saves);
    void b;
  });

  it('the guest can start the match (it joined an open game with the host away); the host takes it up later', async () => {
    const store = new MemoryStore();
    const [ta, tb] = loopback();
    const host = new NetSession(ta, 'host');
    const guest = new NetSession(tb, 'guest');
    for (const s of [host, guest]) {
      s.onStart = onStart;
      s.store = store;
    }
    guest.setPick({ name: 'B', characterId: 'kcaj' });
    guest.remotePick = { name: 'A', characterId: 'tones' }; // from the open offer
    guest.start(99, PLAYERS);
    guest.assumeAway();
    await flush();
    expect(store.rec).toMatchObject({ setup: { seed: 99 } });
    expect(guest.peerAway).toBe(true);
    // The host was there after all (a slow hello): it takes up the guest's match rather than ignoring it.
    expect(host.game).not.toBeNull();
    expect(host.game!.players.map((p) => p.name)).toEqual(['A', 'B']);
    expect(host.game!.seed).toBe(99);
  });

  it('resigning ends it for both, and the record says so', async () => {
    const store = new MemoryStore();
    const { a, b } = await connected(store);
    b.resign();
    await flush();
    for (const s of [a, b]) {
      expect(s.game!.phase).toBe('gameover');
      expect(s.game!.winner?.name).toBe('A');
      expect(s.game!.endReason).toBe('resigned');
    }
    expect(store.rec!.snap).toMatchObject({ phase: 'gameover', winner: 0, endReason: 'resigned' });
  });

  it("three days without a move: whoever's turn it is forfeits", async () => {
    const store = new MemoryStore();
    const { a } = await connected(store);
    a.away();
    const g: StoredGame = { rec: store.rec!, ts: Date.now() - FORFEIT_MS - 1 };
    expect(forfeitDue(g)).toBe(true);
    expect(forfeitDue({ ...g, ts: Date.now() - FORFEIT_MS + 60_000 })).toBe(false);
    const back = alone('guest');
    back.store = store;
    back.rejoin({ rec: g.rec, replay: false });
    await run([[back, () => back.game]], () => !!back.game, RESUME_WAIT + 1);
    back.forfeit();
    expect(back.game!.phase).toBe('gameover');
    expect(back.game!.winner?.name).toBe('B'); // it was A's turn
    expect(back.game!.endReason).toBe('timeout');
    expect(store.rec!.snap).toMatchObject({ phase: 'gameover', winner: 1 });
  });

  it('says how each game stands, for the My games list', async () => {
    const store = new MemoryStore();
    const { a, b, A } = await connected(store);
    const g = (): StoredGame => ({ rec: store.rec!, ts: Date.now() });
    expect(gameStatus(g(), 0)).toBe('your-turn');
    expect(gameStatus(g(), 1)).toBe('their-turn');
    expect(opponentName(g(), 0)).toBe('B');
    expect(opponentName(g(), 1)).toBe('A');
    expect(gameStatus({ ...g(), ts: Date.now() - FORFEIT_MS - 1 }, 0)).toBe('lost');
    expect(gameStatus({ ...g(), ts: Date.now() - FORFEIT_MS - 1 }, 1)).toBe('won');
    selectTier(A, 0);
    void currentPlayer(A);
    a.resign();
    await flush();
    expect(gameStatus(g(), 0)).toBe('lost');
    expect(gameStatus(g(), 1)).toBe('won');
    void b;
  });

  it('a match carries on across rules changes it can survive; one from a newer build needs a reload', async () => {
    const store = new MemoryStore();
    await connected(store);
    const g = (rec: Partial<GameRecord>, setupRules = store.rec!.setup.rules): StoredGame => ({
      rec: { ...store.rec!, ...rec, setup: { ...store.rec!.setup, rules: setupRules } },
      ts: Date.now(),
    });
    expect(gameStatus(g({}), 0)).toBe('your-turn');
    // Started on rules this build still carries on (a balance tweak since): fine.
    expect(gameStatus(g({}, OLDEST_RULES), 0)).toBe('your-turn');
    // Started before the oldest rules this build can carry on, or stored in an older wire format: over.
    expect(gameStatus(g({}, OLDEST_RULES - 1), 0)).toBe('old');
    expect(gameStatus(g({ v: WIRE - 1 }), 0)).toBe('old');
    // Last played on a newer build (or stored in a newer format): this phone should reload first.
    expect(gameStatus(g({ rules: RULES + 1 }), 0)).toBe('newer');
    expect(gameStatus(g({ v: WIRE + 1 }), 0)).toBe('newer');
  });
});

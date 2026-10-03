import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fire, selectTier, setAim } from '../src/game/game';
import type { GameState } from '../src/game/state';
import { Auth } from '../src/net/auth';
import { endOfGame, endOfSnapshot, reportMatch, summarise, useResultsAccount } from '../src/net/results';
import { Rtdb } from '../src/net/rtdb';
import type { MatchSetup } from '../src/net/session';
import { takeSnapshot } from '../src/net/snapshot';
import { canonical, digest, MATCH_ID, parseSummary } from '../src/stats/summary';
import { startRtdb, type FakeRtdb } from './support/rtdb';
import { testGame, untilNextTurn } from './support/game';

const TOPIC = '0123456789abcdef01234567';
const players = [
  { name: 'Ann', colour: '#f0f', characterId: 'kcaj' },
  { name: 'Bo', colour: '#4ea8ff', characterId: 'kie' },
];
const setup = (rules = 15): MatchSetup => ({ seed: 4242, players, rules });

/** A match kcaj wins: Hyperfixate into a nearly-dead kie. */
function finished(): GameState {
  const g = testGame({ players, xs: [200, 500] });
  g.players[1]!.hp = 9;
  selectTier(g, 1);
  setAim(g, 0, 50);
  fire(g);
  untilNextTurn(g);
  expect(g.phase).toBe('gameover');
  return g;
}

const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  Object.assign(globalThis, { localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) } });
});

describe('match summaries', () => {
  it('say who played, how it ended and each tally, in whole numbers; the same from the game or its record', async () => {
    const g = finished();
    const s = summarise(TOPIC, setup(), endOfGame(g))!;
    expect(s.id).toMatch(MATCH_ID);
    expect(s).toMatchObject({ v: 1, rules: 15, winner: 0, endReason: null, players: [{ name: 'Ann', characterId: 'kcaj' }, { name: 'Bo', characterId: 'kie' }] });
    expect(s.players[0]!.tally).toMatchObject({ shots: { hyperfixate: 1 }, hits: { hyperfixate: 1 }, dealt: { hyperfixate: 9 }, kills: 1 });
    // The other phone, from the stored record (and keys in another order, as Firebase hands them back).
    const other = summarise(TOPIC, setup(), endOfSnapshot(JSON.parse(JSON.stringify(takeSnapshot(g)))))!;
    expect(canonical(other)).toBe(canonical(s));
    expect(await digest(other)).toBe(await digest(s));
    const shuffled = JSON.parse(canonical(s)) as typeof s;
    expect(await digest({ ...shuffled, players: shuffled.players.map((p) => ({ tally: p.tally, characterId: p.characterId, name: p.name })) })).toBe(await digest(s));
    expect(parseSummary(JSON.stringify(s))).toEqual(s);
  });

  it('nothing for matches started before tallies were kept', () => {
    expect(summarise(TOPIC, setup(14), endOfGame(finished()))).toBeNull();
  });

  it('a stored summary is checked before it counts', () => {
    const s = summarise(TOPIC, setup(), endOfGame(finished()))!;
    expect(parseSummary('not json')).toBeNull();
    expect(parseSummary(JSON.stringify({ ...s, winner: 7 }))).toBeNull();
    expect(parseSummary(JSON.stringify({ ...s, id: 'FROG' }))).toBeNull();
    expect(parseSummary(JSON.stringify({ ...s, players: [s.players[0]] }))).toBeNull();
    const neg = JSON.parse(JSON.stringify(s)) as typeof s;
    neg.players[0]!.tally.dealt.hyperfixate = -5;
    expect(parseSummary(JSON.stringify(neg))).toBeNull();
  });
});

describe('filing results', () => {
  let server: FakeRtdb;
  beforeEach(async () => {
    server = await startRtdb();
  });
  afterEach(async () => {
    useResultsAccount(() => null);
    await server.close();
  });
  const tree = () => server.tree() as { stats?: { matches?: Record<string, Record<string, { m: string }>> }; users?: Record<string, { results?: Record<string, { seat: number; digest: string }> }> };

  it('files what this phone saw, and a signed-in player vouches for it in their own account, once', async () => {
    const g = finished();
    const db = new Rtdb(server.url);
    await reportMatch(db, TOPIC, 1, setup(), endOfGame(g)); // Bo, not signed in
    const id = summarise(TOPIC, setup(), endOfGame(g))!.id;
    expect(Object.keys(tree().stats!.matches![id]!)).toEqual(['1']);

    const auth = new Auth({ apiKey: 'k', signInUrl: `${server.url}/identitytoolkit/signInWithIdp`, refreshUrl: `${server.url}/securetoken/token`, storage: null });
    const uid = await auth.signInWithGoogle('fake:ann');
    useResultsAccount(() => ({ uid, db: new Rtdb(server.url, () => auth.token()) }));
    await reportMatch(db, TOPIC, 0, setup(), endOfGame(g)); // Ann, signed in
    const filed = parseSummary(tree().stats!.matches![id]!['0']!.m)!;
    expect(tree().users![uid]!.results![id]).toMatchObject({ seat: 0, digest: await digest(filed) });

    const before = server.requests.length;
    await reportMatch(db, TOPIC, 0, setup(), endOfGame(g)); // again: nothing more
    expect(server.requests.length).toBe(before);
  });
});

import { describe, expect, expectTypeOf, it } from 'vitest';
import type { PlayerTally } from '../src/game/state';
import { aggregate, type StatsInput } from '../src/stats/aggregate';
import { encodeStats, parseStats, STATS_PATH } from '../src/stats/store';
import { digest, playerKey, type MatchSummary, type Tally } from '../src/stats/summary';

const tally = (o: Partial<Tally> = {}): Tally => ({ shots: {}, hits: {}, dealt: {}, taken: 0, self: 0, kills: 0, ...o });
let n = 0;
/** A match summary: Ann (kcaj) beats `them` unless told otherwise. */
function match(o: Partial<MatchSummary> & { them?: string } = {}): MatchSummary {
  const id = `${'ab'.repeat(12)}-${(++n).toString(36)}`;
  return {
    v: 1,
    id,
    rules: 15,
    turns: 6,
    endReason: null,
    winner: 0,
    players: [
      { name: 'Ann', characterId: 'kcaj', tally: tally({ shots: { hyperfixate: 3 }, hits: { hyperfixate: 2 }, dealt: { hyperfixate: 80 }, kills: 1, taken: 30 }) },
      { name: o.them ?? 'Bo', characterId: 'kie', tally: tally({ shots: { troll: 4 }, hits: { troll: 1 }, dealt: { troll: 30 }, taken: 80 }) },
    ],
    ...o,
  };
}
const filed = (...seats: MatchSummary[]) => Object.fromEntries(seats.map((s, i) => [String(i), { m: JSON.stringify(s) }]));

describe('adding up the stats', () => {
  it('counts every match in "all", and in "verified" only those both players vouched for, for the same summary, from two accounts', async () => {
    const good = match(); // both vouched
    const half = match({ them: 'Cat' }); // only Ann vouched (Cat wasn't signed in)
    const forged = match(); // Bo's "voucher" doesn't match what was filed
    const sock = match(); // vouched for by two accounts (a second account of Ann's would pass too: a known limit)
    const input: StatsInput = {
      matches: {
        [good.id]: filed(good, good),
        [half.id]: filed(half),
        [forged.id]: filed(forged, forged),
        [sock.id]: filed(sock, sock),
        junk: { '0': { m: 'nope' } },
      },
      results: {
        'uid-ann': {
          [good.id]: { seat: 0, digest: await digest(good) },
          [half.id]: { seat: 0, digest: await digest(half) },
          [forged.id]: { seat: 0, digest: await digest(forged) },
          [sock.id]: { seat: 0, digest: await digest(sock) },
          stale: null,
        },
        'uid-bo': { [good.id]: { seat: 1, digest: await digest(good) }, [forged.id]: { seat: 1, digest: 'f'.repeat(64) } },
        'uid-sock': { [sock.id]: { seat: 1, digest: await digest(sock) } },
      },
      names: { 'uid-ann': 'Annie', 'uid-bo': 'Bo' },
    };
    const out = await aggregate(input, 123);
    expect(out.updatedAt).toBe(123);
    expect(out.all.matches).toBe(4);
    expect(out.verified.matches).toBe(2); // good and sock
    const annKey = await playerKey('uid-ann');
    const ann = out.all.players.find((p) => p.key === annKey)!;
    expect(ann).toMatchObject({ name: 'Annie', verified: true, matches: 4, wins: 4, losses: 0, shots: 12, hits: 8, dealt: 320, kills: 4, characters: { kcaj: 4 } });
    expect(out.all.players.find((p) => p.key === 'n:cat')).toMatchObject({ name: 'Cat', verified: false, matches: 1, losses: 1 });
    expect(out.verified.players.find((p) => p.key === annKey)?.matches).toBe(2);
    expect(out.all.characters.kcaj).toMatchObject({ matches: 4, wins: 4, shots: 12, hits: 8, dealt: 320 });
    expect(out.all.weapons.troll).toEqual({ shots: 16, hits: 4, dealt: 120 });
    expect(out.all.endings).toEqual({ 'played out': 4 });
    expect(JSON.stringify(out)).not.toMatch(/uid-/); // no accounts in what phones read
  });

  it('a seat vouched for by two accounts counts for neither; draws and resignations are told apart', async () => {
    const m = match({ winner: null });
    const r = match({ endReason: 'resigned', winner: 1 });
    const out = await aggregate(
      {
        matches: { [m.id]: filed(m), [r.id]: filed(r) },
        results: { a: { [m.id]: { seat: 0, digest: await digest(m) } }, b: { [m.id]: { seat: 0, digest: await digest(m) } }, c: { [m.id]: { seat: 1, digest: await digest(m) } } },
        names: {},
      },
      1,
    );
    expect(out.verified.matches).toBe(0);
    expect(out.all.endings).toEqual({ draw: 1, resigned: 1 });
    expect(out.all.players.find((p) => p.key === 'n:ann')).toMatchObject({ draws: 1, losses: 1, wins: 0 });
  });
});

it("a summary's tally has the game's PlayerTally shape", () => {
  // summary.ts keeps its own copy (it can't import game/state.ts and stay loadable by the stats sender).
  expectTypeOf<Tally>().toEqualTypeOf<PlayerTally>();
});

describe('the stored totals', () => {
  it('round-trip through stats/summary as the sender writes them', async () => {
    const stats = await aggregate({ matches: {}, results: {}, names: {} }, 123);
    const stored = encodeStats(stats, 456);
    expect(STATS_PATH).toBe('stats/summary');
    expect(stored).toEqual({ m: JSON.stringify(stats), ts: 456 });
    expect(parseStats(stored)).toEqual(stats);
  });

  it("reads nothing from an empty slot or a version it doesn't know", () => {
    expect(parseStats(null)).toBeNull();
    expect(parseStats({})).toBeNull();
    expect(parseStats({ m: 'null' })).toBeNull();
    expect(parseStats({ m: JSON.stringify({ v: 2 }) })).toBeNull();
  });
});

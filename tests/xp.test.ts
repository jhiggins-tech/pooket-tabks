import { describe, expect, it } from 'vitest';
import { aggregate } from '../src/stats/aggregate';
import { digest, playerKey, type MatchSummary, type Tally } from '../src/stats/summary';
import { XP, xpEarned, xpProgress, xpShown } from '../src/stats/xp';

describe('career XP', () => {
  it('a loss earns 1×, a win 2×, a draw 1×; every 6× is an unlock', () => {
    expect(XP).toMatchObject({ loss: 1, win: 2, draw: 1, unlock: 6 });
    expect([xpEarned(0, 9), xpEarned(1, 9), xpEarned(0.5, 9)]).toEqual([1, 2, 1]);
    expect(xpProgress(0)).toEqual({ unlocks: 0, into: 0 });
    expect(xpProgress(5)).toEqual({ unlocks: 0, into: 5 });
    expect(xpProgress(6)).toEqual({ unlocks: 1, into: 0 });
    expect(xpProgress(13)).toEqual({ unlocks: 2, into: 1 });
  });

  it('a match that ended before turn 4 earns nothing (no farming quick resignations)', () => {
    expect(XP.minTurns).toBe(4);
    expect([xpEarned(1, 3), xpEarned(0, 1), xpEarned(1, 4)]).toEqual([0, 0, 2]);
  });

  it('players see it in hundreds', () => {
    expect([xpShown(1), xpShown(2), xpShown(XP.unlock)]).toEqual([100, 200, 600]);
  });
});

const tally = (): Tally => ({ shots: {}, hits: {}, dealt: {}, taken: 0, self: 0, kills: 0 });
let n = 0;
function match(o: Partial<MatchSummary> = {}): MatchSummary {
  return {
    v: 1,
    id: `${'cd'.repeat(12)}-${(++n).toString(36)}`,
    rules: 15,
    turns: 8,
    endReason: null,
    winner: 0,
    players: [
      { name: 'Ann', characterId: 'kcaj', tally: tally() },
      { name: 'Bo', characterId: 'kie', tally: tally() },
    ],
    ...o,
  };
}

describe('XP in the hourly totals', () => {
  it("adds up each verified player's XP from the verified matches: unverified and short ones earn nothing", async () => {
    const won = match(); // Ann wins
    const lost = match({ winner: 1 }); // Bo wins
    const drawn = match({ winner: null });
    const quick = match({ endReason: 'resigned', turns: 2 }); // over too soon
    const half = match(); // only Ann vouched: not verified
    const all = [won, lost, drawn, quick, half];
    const vouch = async (seat: 0 | 1, ms: MatchSummary[]) => Object.fromEntries(await Promise.all(ms.map(async (m) => [m.id, { seat, digest: await digest(m) }] as const)));
    const out = await aggregate(
      {
        matches: Object.fromEntries(all.map((m) => [m.id, { '0': { m: JSON.stringify(m) }, '1': { m: JSON.stringify(m) } }])),
        results: { 'uid-ann': await vouch(0, all), 'uid-bo': await vouch(1, [won, lost, drawn, quick]) },
        names: {},
      },
      1,
    );
    const [ann, bo] = await Promise.all([playerKey('uid-ann'), playerKey('uid-bo')]);
    // Ann: a win (2), a loss (1), a draw (1); Bo: a loss (1), a win (2), a draw (1).
    expect(out.xp).toEqual({ [ann]: 4, [bo]: 4 });
  });
});

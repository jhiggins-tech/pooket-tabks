import { describe, expect, it } from 'vitest';
import { aggregate } from '../src/stats/aggregate';
import { elo, expected, K, newRating, playRated, rankIndex, rankOf, RANKS, START_RATING } from '../src/stats/ranks';
import { digest, playerKey, type MatchSummary } from '../src/stats/summary';

describe('the ranks table', () => {
  it('lowest first, ids unique, every rank with a look and a jingle; Overwatch order', () => {
    expect(RANKS.map((r) => r.name)).toEqual(['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster', 'Champion']);
    for (let i = 1; i < RANKS.length; i++) expect(RANKS[i]!.min).toBeGreaterThan(RANKS[i - 1]!.min);
    expect(new Set(RANKS.map((r) => r.id)).size).toBe(RANKS.length);
    for (const r of RANKS) {
      expect(r.jingle.length).toBeGreaterThan(1);
      expect(r.colours).toHaveLength(2);
    }
    // Higher ranks sparkle at least as much.
    for (let i = 1; i < RANKS.length; i++) expect(RANKS[i]!.sparkle).toBeGreaterThanOrEqual(RANKS[i - 1]!.sparkle);
  });

  it('a rating is the highest rank whose threshold it reaches; everyone starts in Silver', () => {
    expect(rankOf(START_RATING).name).toBe('Silver');
    expect(rankOf(-500).name).toBe('Bronze');
    expect(rankOf(1049.9).name).toBe('Silver');
    expect(rankOf(1050).name).toBe('Gold');
    expect(rankOf(99999).name).toBe('Champion');
    expect(rankIndex(rankOf(1300))).toBe(4); // Diamond
  });
});

describe('Elo', () => {
  it('beating an equal is worth half of K; an upset is worth more; beating someone lower, less', () => {
    expect(elo(1000, 1000, 1)[0] - 1000).toBeCloseTo(K / 2);
    const upset = elo(1000, 1200, 1)[0] - 1000;
    const expectedWin = elo(1200, 1000, 1)[0] - 1200;
    expect(upset).toBeGreaterThan(K / 2);
    expect(expectedWin).toBeLessThan(K / 2);
    expect(upset + expectedWin).toBeCloseTo(K);
    // And the other way round: losing to someone lower costs more.
    expect(1200 - elo(1200, 1000, 0)[0]).toBeCloseTo(upset);
  });

  it('what one gains the other loses; a draw pulls them together', () => {
    const [a, b] = elo(1100, 1000, 0.5);
    expect(a + b).toBeCloseTo(2100);
    expect(a).toBeLessThan(1100);
    expect(b).toBeGreaterThan(1000);
    expect(expected(1000, 1000)).toBe(0.5);
  });

  it('counts the results and keeps the peak', () => {
    const a = newRating();
    const b = newRating();
    playRated(a, b, 1);
    playRated(a, b, 0);
    playRated(a, b, 0.5);
    expect(a).toMatchObject({ matches: 3, wins: 1, losses: 1, draws: 1 });
    expect(a.peak).toBeCloseTo(START_RATING + K / 2);
    expect(b).toMatchObject({ matches: 3, wins: 1, losses: 1, draws: 1 });
  });
});

describe('ratings in the hourly totals', () => {
  const summary = (n: number, winner: 0 | 1 | null): MatchSummary => ({
    v: 1,
    id: `${'ef'.repeat(12)}-${n}`,
    rules: 15,
    turns: 5,
    endReason: null,
    winner,
    players: [
      { name: 'Ann', characterId: 'kcaj', tally: { shots: {}, hits: {}, dealt: {}, taken: 0, self: 0, kills: 0 } },
      { name: 'Bo', characterId: 'kie', tally: { shots: {}, hits: {}, dealt: {}, taken: 0, self: 0, kills: 0 } },
    ],
  });

  it('only verified matches count, in the order they were played', async () => {
    // Played in this order (by when they were filed), whatever their ids: Bo wins, then Ann twice.
    const m = [summary(9, 1), summary(1, 0), summary(5, 0), summary(7, 0)];
    const ts = [100, 200, 300, 400];
    const input = {
      matches: Object.fromEntries(m.map((s, i) => [s.id, { '0': { m: JSON.stringify(s), ts: ts[i] }, '1': { m: JSON.stringify(s), ts: ts[i]! + 5 } }])),
      results: {
        ann: Object.fromEntries(await Promise.all(m.map(async (s) => [s.id, { seat: 0, digest: await digest(s) }]))),
        // Bo didn't vouch for the last one: it doesn't count for anyone's rating.
        bo: Object.fromEntries(await Promise.all(m.slice(0, 3).map(async (s) => [s.id, { seat: 1, digest: await digest(s) }]))),
      },
      names: {},
    };
    const out = await aggregate(input, 1);
    const ann = out.ratings[await playerKey('ann')]!;
    const bo = out.ratings[await playerKey('bo')]!;
    expect(ann).toMatchObject({ matches: 3, wins: 2, losses: 1 });
    expect(bo).toMatchObject({ matches: 3, wins: 1, losses: 2 });
    // Worked by hand, in that order.
    let [a, b] = [START_RATING, START_RATING];
    [b, a] = elo(b, a, 1);
    [a, b] = elo(a, b, 1);
    [a, b] = elo(a, b, 1);
    expect(ann.rating).toBeCloseTo(a, 0);
    expect(bo.rating).toBeCloseTo(b, 0);
    expect(Object.keys(out.ratings)).toHaveLength(2); // nobody unverified is rated
  });
});

describe('rank-up jingles', () => {
  it('every rank has one (built from its notes), and the sparklier ranks get more flourish', async () => {
    const { rankJingle } = await import('../src/audio/sfx');
    const calls = (rank: (typeof RANKS)[number]) => {
      let n = 0;
      const synth = { tone: () => void n++, noise: () => void n++ } as unknown as Parameters<typeof rankJingle>[0];
      rankJingle(synth, rank);
      return n;
    };
    for (const r of RANKS) expect(calls(r)).toBeGreaterThanOrEqual(r.jingle.length + 1);
    expect(calls(RANKS.at(-1)!)).toBeGreaterThan(calls(RANKS[0]!));
    // A rank added later (a meme one) needs nothing but its row.
    expect(calls({ ...RANKS[0]!, id: 'meme', jingle: [40, 41, 40, 41], sparkle: 3 })).toBeGreaterThan(4);
  });
});

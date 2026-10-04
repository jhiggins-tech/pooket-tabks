import { describe, expect, it } from 'vitest';
import { aggregate } from '../src/stats/aggregate';
import { BAND, elo, expected, MIN_GAIN, newRating, playRated, rankIndex, rankOf, RANKS, START_RATING } from '../src/stats/ranks';
import { SHAPES } from '../src/ui/insignia-shapes';
import { digest, playerKey, type MatchSummary } from '../src/stats/summary';

describe('the ranks table', () => {
  it('33 ranks, lowest first, unique ids, everyone with a look and a jingle; sparkle never drops', () => {
    expect(RANKS).toHaveLength(33);
    expect(RANKS.slice(0, 3).map((r) => r.name)).toEqual(['Pototo', 'Rubber Duck', 'Cardboard']);
    expect(RANKS.slice(-4).map((r) => r.name)).toEqual(['Champion', 'Supernova', 'Black Hole', 'Unobtainium']);
    expect(new Set(RANKS.map((r) => r.id)).size).toBe(RANKS.length);
    for (const r of RANKS) {
      expect(r.jingle.length).toBeGreaterThan(1);
      expect(r.colours).toHaveLength(2);
      expect(SHAPES[r.shape]).toBeTruthy();
    }
    for (let i = 1; i < RANKS.length; i++) {
      expect(RANKS[i]!.min).toBeGreaterThan(RANKS[i - 1]!.min);
      expect(RANKS[i]!.sparkle).toBeGreaterThanOrEqual(RANKS[i - 1]!.sparkle);
    }
    expect(RANKS.filter((r) => r.start)).toHaveLength(1);
  });

  it('bands are worked out from the place in the ladder, Silver’s holding the starting rating', () => {
    expect(RANKS[0]!.min).toBe(-Infinity);
    const silver = RANKS.find((r) => r.id === 'silver')!;
    expect(silver.start).toBe(true);
    expect(silver.min).toBeLessThanOrEqual(START_RATING);
    expect(START_RATING).toBeLessThan(silver.min + BAND);
    for (let i = 2; i < RANKS.length; i++) expect(RANKS[i]!.min - RANKS[i - 1]!.min).toBe(BAND);
    expect(rankOf(START_RATING).name).toBe('Silver');
    expect(rankOf(-500).name).toBe('Pototo');
    expect(rankOf(silver.min - 0.1).name).toBe('Bronze');
    expect(rankOf(silver.min).name).toBe('Silver');
    expect(rankOf(RANKS.find((r) => r.id === 'champion')!.min).name).toBe('Champion');
    expect(rankOf(99999).name).toBe('Unobtainium');
    expect(rankIndex(rankOf(START_RATING))).toBe(10);
  });

  it('a few thresholds, as signed off', () => {
    const min = (id: string) => RANKS.find((r) => r.id === id)!.min;
    expect([min('bronze'), min('silver'), min('gold'), min('platinum'), min('diamond'), min('champion'), min('unobtainium')]).toEqual([880, 960, 1040, 1360, 1760, 2480, 2720]);
  });
});

describe('the rating rule', () => {
  it('a win between equals is half a band; an upset is worth more; the loser gives up the same', () => {
    expect(elo(1000, 1000, 1)[0] - 1000).toBeCloseTo(BAND / 2);
    const upset = elo(1000, 1240, 1)[0] - 1000;
    expect(upset).toBeGreaterThan(BAND / 2);
    expect(upset).toBeLessThan(BAND);
    const [a, b] = elo(1000, 1240, 1);
    expect(a + b).toBeCloseTo(2240); // what one gains the other loses
    expect(1240 - b).toBeCloseTo(upset);
    // And from the loser's side: the favourite losing to the underdog is the same move.
    const [fav, dog] = elo(1240, 1000, 0);
    expect(dog - 1000).toBeCloseTo(upset);
    expect(fav).toBeCloseTo(b);
  });

  it('a win never moves less than a third of a band, even a stomp (and a stomped loser pays it too)', () => {
    expect(MIN_GAIN).toBeCloseTo(BAND / 3);
    for (const gap of [150, 300, 800]) {
      const [w, l] = elo(1000 + gap, 1000, 1);
      expect(w - (1000 + gap)).toBeCloseTo(MIN_GAIN);
      expect(1000 - l).toBeCloseTo(MIN_GAIN);
    }
    // A modest favourite: Elo's own number is above the floor, so it's used.
    const modest = elo(1050, 1000, 1)[0] - 1050;
    expect(modest).toBeGreaterThan(MIN_GAIN);
    // A favourite who loses pays far more than the floor: that's the upset.
    expect(1300 - elo(1300, 1000, 0)[0]).toBeGreaterThan(BAND * 0.8);
  });

  it('a draw is plain Elo: it pulls the ratings together, and conserves points', () => {
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
    expect(a.peak).toBeCloseTo(START_RATING + BAND / 2);
    expect(b).toMatchObject({ matches: 3, wins: 1, losses: 1, draws: 1 });
  });

  it('three equal wins in a row is a rank up, then another (rank progression is meant to be quick)', () => {
    const a = newRating();
    const b = newRating();
    for (let i = 0; i < 3; i++) playRated(a, { ...b, rating: START_RATING }, 1);
    expect(rankIndex(rankOf(a.rating))).toBeGreaterThan(rankIndex(rankOf(START_RATING)));
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

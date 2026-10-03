import { beforeEach, describe, expect, it } from 'vitest';
import { elo, START_RATING } from '../src/stats/ranks';
import { Ratings } from '../src/ui/ranks';

const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  Object.assign(globalThis, { localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) } });
});

const totals = (ratings: Record<string, number>, updatedAt: number) => ({
  updatedAt,
  ratings: Object.fromEntries(Object.entries(ratings).map(([k, rating]) => [k, { rating, matches: 1, wins: 1, losses: 0, draws: 0, peak: rating }])),
});

describe('ratings on this phone', () => {
  it("anyone's rank from the totals; nobody's for a player who isn't rated (or isn't signed in)", () => {
    const r = new Ratings(null, () => 'a:me');
    r.take(totals({ 'a:you': 1260 }, 1));
    expect(r.rank('a:you')?.name).toBe('Diamond');
    expect(r.rank('a:nobody')).toBeNull();
    expect(r.rank(undefined)).toBeNull();
  });

  it('after a rated match, this phone’s own rating moves at once; newer totals take over again', () => {
    let me: string | null = 'a:me';
    const r = new Ratings(null, () => me);
    r.take(totals({ 'a:me': 1040, 'a:you': 1200 }, Date.now() - 60_000));
    let heard = 0;
    r.onChange(() => heard++);
    r.played('a:you', 1); // an upset
    const [expected] = elo(1040, 1200, 1);
    expect(r.rating('a:me')).toBeCloseTo(expected, 0);
    expect(r.rank('a:me')?.name).toBe('Gold');
    expect(heard).toBe(1);
    // Someone else's rating isn't touched by it.
    expect(r.rating('a:you')).toBe(1200);
    // The hourly totals come in after the match: theirs it is (whatever they say).
    r.take(totals({ 'a:me': 1050.5, 'a:you': 1180 }, Date.now() + 1000));
    expect(r.rating('a:me')).toBe(1050.5);
    me = null;
    expect(r.rating('a:me')).toBe(1050.5); // signed out: no provisional for anyone
  });

  it('a first rated match starts from the starting rating', () => {
    const r = new Ratings(null, () => 'a:new');
    r.take(totals({}, 1));
    r.played('a:also-new', 0);
    expect(r.rating('a:new')).toBeCloseTo(elo(START_RATING, START_RATING, 0)[0], 0);
  });

  it('celebrates a new rank once: "ranked" the first time, "up" when it climbs, quietly when it drops', () => {
    const r = new Ratings(null, () => 'a:me');
    expect(r.noteSeen()).toBeNull(); // not rated yet
    r.take(totals({ 'a:me': 1000 }, 1));
    expect(r.noteSeen()).toMatchObject({ up: true, first: true, rank: { name: 'Silver' } });
    expect(r.noteSeen()).toMatchObject({ up: false });
    r.take(totals({ 'a:me': 1060 }, 2));
    expect(r.noteSeen()).toMatchObject({ up: true, first: false, rank: { name: 'Gold' } });
    r.take(totals({ 'a:me': 990 }, 3));
    expect(r.noteSeen()).toMatchObject({ up: false, rank: { name: 'Silver' } });
    r.take(totals({ 'a:me': 1060 }, 4));
    expect(r.noteSeen()).toMatchObject({ up: true }); // back up: worth another moment
  });

  it('a player ranked a while on another phone isn’t told "ranked!" on this one: just noted', () => {
    const r = new Ratings(null, () => 'a:me');
    r.take({ updatedAt: 1, ratings: { 'a:me': { rating: 1300, matches: 12, wins: 8, losses: 4, draws: 0, peak: 1310 } } });
    expect(r.noteSeen()).toMatchObject({ up: false, rank: { name: 'Diamond' } });
    // A first rated match played here, though (nothing in the totals yet): that's news.
    const fresh = new Ratings(null, () => 'a:fresh');
    fresh.take({ updatedAt: Date.now() - 1000, ratings: {} });
    fresh.played('a:other', 1);
    expect(fresh.noteSeen()).toMatchObject({ up: true, first: true });
  });
});

import { netLog } from '../net/log';
import { Rtdb } from '../net/rtdb';
import type { StatsSummary } from '../stats/aggregate';
import { elo, rankIndex, rankOf, RANKS, START_RATING, type Rank, type Rating } from '../stats/ranks';

/**
 * Verified players' ratings, as the hourly stats last added them up (`stats/summary`), and this phone's
 * own rating as it stands after its latest rated match (`played`: worked out here at the end of the match,
 * so a rank-up can be celebrated at once; the next totals take over, and if the match didn't count after
 * all, the rating goes back to what they say).
 *
 * Also what this phone last showed its player of their rank (`noteSeen`), so a rank-up is celebrated once,
 * whether it came at the end of a match here or turned up in the totals later.
 */

const PROVISIONAL_KEY = 'pooket.myRating';
const SEEN_KEY = 'pooket.rankSeen';
/** The ranks there were when this phone remembered a rank by its place (`index`), before it remembered the id. */
const FIRST_LADDER = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'grandmaster', 'champion'];

interface Provisional {
  key: string;
  rating: number;
  /** When (ms): it stands until totals newer than this arrive. */
  at: number;
}

export class Ratings {
  private totals: Pick<StatsSummary, 'ratings' | 'updatedAt'> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly dbUrl: string | null,
    /** This phone's player's key (signed in), or null. */
    private readonly me: () => string | null,
  ) {}

  /** Fetch the latest totals. Best effort. */
  async load(): Promise<void> {
    if (!this.dbUrl) return;
    try {
      const raw = await new Rtdb(this.dbUrl).get<{ m?: unknown }>('stats/summary');
      if (typeof raw?.m === 'string') this.take(JSON.parse(raw.m) as StatsSummary);
    } catch (e) {
      netLog(`ranks: couldn't load the ratings (${e instanceof Error ? e.message : e})`);
    }
  }

  /** Totals loaded elsewhere (the stats viewer). */
  take(s: Pick<StatsSummary, 'ratings' | 'updatedAt'>): void {
    this.totals = { ratings: s.ratings ?? {}, updatedAt: s.updatedAt };
    for (const fn of this.listeners) fn();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** A player's rating (null: not rated yet, or not signed in). This phone's own includes its latest match. */
  rating(key: string | null | undefined): number | null {
    if (!key) return null;
    const official = this.totals?.ratings[key]?.rating ?? null;
    if (key === this.me()) {
      const p = provisional();
      if (p && p.key === key && p.at > (this.totals?.updatedAt ?? 0)) return p.rating;
    }
    return official;
  }

  /** The full standing from the totals (for the stats viewer). */
  standing(key: string | null | undefined): Rating | null {
    return key ? (this.totals?.ratings[key] ?? null) : null;
  }

  rank(key: string | null | undefined): Rank | null {
    const r = this.rating(key);
    return r === null ? null : rankOf(r);
  }

  /**
   * This phone's player has just finished a rated match (both players signed in) against `opponent`:
   * their rating as it will be. `score`: 1 won, 0.5 drew, 0 lost.
   */
  played(opponent: string, score: 1 | 0.5 | 0): void {
    const me = this.me();
    if (!me) return;
    const [mine] = elo(this.rating(me) ?? START_RATING, this.rating(opponent) ?? START_RATING, score);
    try {
      localStorage.setItem(PROVISIONAL_KEY, JSON.stringify({ key: me, rating: Math.round(mine * 10) / 10, at: Date.now() } satisfies Provisional));
    } catch {
      /* the totals will have it within the hour */
    }
    for (const fn of this.listeners) fn();
  }

  /**
   * This phone's player's rank now, compared with what they were last shown: `up` if it's higher, and
   * remembered as seen either way. The first look on a phone only counts as `up` (`first`) for a player
   * who's just been ranked (their first rated match), not for one who's been ranked a while elsewhere.
   */
  noteSeen(): { rank: Rank; up: boolean; first: boolean } | null {
    const me = this.me();
    const rank = this.rank(me);
    if (!me || !rank) return null;
    let seen: { key?: string; id?: string; index?: number } = {};
    try {
      seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as typeof seen;
    } catch {
      /* first look */
    }
    // What was last shown, by id (the ladder grows: a place in it moves). An older phone remembered a place
    // in the first eight ranks: that's the id it meant.
    const seenId = seen.key === me ? (seen.id ?? (typeof seen.index === 'number' ? FIRST_LADDER[seen.index] : undefined)) : undefined;
    const before = seenId ? RANKS.findIndex((r) => r.id === seenId) : -1;
    const now = rankIndex(rank);
    const official = this.standing(me);
    const newlyRanked = !official || official.matches <= 1;
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify({ key: me, id: rank.id }));
    } catch {
      /* celebrated again next time: no harm */
    }
    return before < 0 ? { rank, up: newlyRanked, first: true } : { rank, up: now > before, first: false };
  }
}

function provisional(): Provisional | null {
  try {
    const v = JSON.parse(localStorage.getItem(PROVISIONAL_KEY) ?? 'null') as Provisional | null;
    return v && typeof v.key === 'string' && typeof v.rating === 'number' && typeof v.at === 'number' ? v : null;
  } catch {
    return null;
  }
}

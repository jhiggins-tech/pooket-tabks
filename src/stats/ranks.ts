/**
 * Competitive ranks for verified players (signed in with Google, in matches both players vouched for:
 * stats/aggregate.ts). Win/loss only: an Elo rating, starting at START_RATING; beating someone rated above you
 * gains more than beating someone below (and losing to someone below costs more). A rank is just where
 * a rating sits in RANKS. Shared by the phones and the stats sender (plain TypeScript, no imports).
 *
 * **Adding a rank** (a meme one, say): insert a row in RANKS at its place, with the lowest rating it
 * covers (`min`). Ratings are kept as numbers, so nothing stored needs changing: whoever's rating falls in
 * the new band is that rank from then on. Give it an `id` never used before (the insignia's CSS and the
 * rank-up jingle go by it), colours, a shape, a sparkle level and a jingle (MIDI notes, played quickly).
 */

export type InsigniaShape = 'shield' | 'hex' | 'star' | 'crown';

export interface Rank {
  /** Never reused or renamed (CSS and sounds go by it). */
  id: string;
  name: string;
  /** The lowest rating that's this rank (ranks are listed lowest first). */
  min: number;
  /** The insignia's colours: light and dark. */
  colours: [string, string];
  shape: InsigniaShape;
  /** 0 none, 1 a shimmer, 2 twinkles, 3 twinkles and a glow. */
  sparkle: 0 | 1 | 2 | 3;
  /** The rank-up jingle: MIDI notes. */
  jingle: number[];
}

export const RANKS: readonly Rank[] = [
  { id: 'bronze', name: 'Bronze', min: -Infinity, colours: ['#e0a36a', '#8a5426'], shape: 'shield', sparkle: 0, jingle: [60, 64, 67] },
  { id: 'silver', name: 'Silver', min: 950, colours: ['#f2f4f8', '#8b93a6'], shape: 'shield', sparkle: 0, jingle: [62, 66, 69, 74] },
  { id: 'gold', name: 'Gold', min: 1050, colours: ['#ffe27a', '#b8860b'], shape: 'shield', sparkle: 0, jingle: [64, 68, 71, 76] },
  { id: 'platinum', name: 'Platinum', min: 1150, colours: ['#d9fffb', '#3fa7a0'], shape: 'hex', sparkle: 1, jingle: [65, 69, 72, 77, 81] },
  { id: 'diamond', name: 'Diamond', min: 1250, colours: ['#c9ecff', '#3b82f6'], shape: 'hex', sparkle: 2, jingle: [67, 71, 74, 79, 83] },
  { id: 'master', name: 'Master', min: 1350, colours: ['#ffd9a0', '#e2741d'], shape: 'star', sparkle: 2, jingle: [69, 73, 76, 81, 85, 88] },
  { id: 'grandmaster', name: 'Grandmaster', min: 1450, colours: ['#e4d4ff', '#7c3aed'], shape: 'star', sparkle: 3, jingle: [70, 74, 77, 82, 86, 89, 94] },
  { id: 'champion', name: 'Champion', min: 1550, colours: ['#ffd1ec', '#e11d74'], shape: 'crown', sparkle: 3, jingle: [72, 76, 79, 84, 88, 91, 96, 100] },
];

export const START_RATING = 1000;
/** How far one match moves a rating. */
export const K = 32;

/** One verified player's standing. */
export interface Rating {
  rating: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  /** Their highest rating so far. */
  peak: number;
}

export const newRating = (): Rating => ({ rating: START_RATING, matches: 0, wins: 0, losses: 0, draws: 0, peak: START_RATING });

/** The rank a rating is. */
export function rankOf(rating: number): Rank {
  let r = RANKS[0]!;
  for (const rank of RANKS) if (rating >= rank.min) r = rank;
  return r;
}

/** Where a rank sits (higher is better). */
export function rankIndex(rank: Rank): number {
  return RANKS.findIndex((r) => r.id === rank.id);
}

/** The chance a player rated `a` beats one rated `b`, as Elo has it. */
export function expected(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

/** Both players' ratings after a match: `score` is the first player's (1 win, 0.5 draw, 0 loss). */
export function elo(a: number, b: number, score: 1 | 0.5 | 0): [number, number] {
  const delta = K * (score - expected(a, b));
  return [a + delta, b - delta];
}

/** Record a match between `a` and `b` (score from `a`'s side): ratings, counts and peaks. */
export function playRated(a: Rating, b: Rating, score: 1 | 0.5 | 0): void {
  const [ra, rb] = elo(a.rating, b.rating, score);
  for (const [p, r, s] of [[a, ra, score], [b, rb, 1 - score]] as [Rating, number, number][]) {
    p.rating = r;
    p.matches++;
    if (s === 1) p.wins++;
    else if (s === 0) p.losses++;
    else p.draws++;
    p.peak = Math.max(p.peak, r);
  }
}

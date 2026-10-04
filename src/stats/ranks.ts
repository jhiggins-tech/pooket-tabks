/**
 * Competitive ranks for verified players (signed in with Google, in matches both players vouched for:
 * stats/aggregate.ts). Win/loss only: a rating starting at START_RATING that a match moves (below), and a
 * rank is just where a rating sits in the ladder. Shared by the phones and the stats sender (plain
 * TypeScript, no imports).
 *
 * **The rating rule.** A rank is a band of BAND rating points. Elo says how many points a result is worth:
 * K (one band) times how surprising it was, so a win between equals moves half a band and an upset up to
 * nearly a whole one. A win never moves less than MIN_GAIN (a third of a band), even a favourite beating a
 * much lower player, so ranks keep coming. The loser gives up exactly what the winner gains. A draw is
 * plain Elo.
 *
 * Most of the ranks below are meant to be discovered, so don't name them outside this file (docs, changelog,
 * tests): a rank shows in the game only next to a player who holds it.
 *
 * **Adding a rank** (a meme one, say): insert a row in ROWS at its place, with an `id` never used before
 * (the insignia's CSS and everything stored go by it), colours, a shape (ui/insignia-shapes.ts, a new one
 * needs its path there), a sparkle level and jingle notes (MIDI, played quickly). Nothing else: each
 * rank's lowest rating is worked out from its place, with Silver's band holding START_RATING, so ranks
 * above a new row move up by one band. Ratings are plain numbers, so nobody's rating changes, only which
 * rank it counts as.
 */

export type InsigniaShape =
  | 'shield' | 'hex' | 'star' | 'crown'
  | 'potato' | 'log' | 'brick' | 'box' | 'glass' | 'tower' | 'marble' | 'emerald' | 'gem' | 'shard' | 'tile' | 'ring' | 'ingot' | 'claws' | 'orb'
  | 'duck' | 'stone' | 'can' | 'anvil' | 'cheese' | 'crystal' | 'oval' | 'bolt' | 'nova' | 'hole';

export interface RankRow {
  /** Never reused or renamed (CSS, sounds and what a phone has shown go by it). */
  id: string;
  name: string;
  /** The insignia's colours: light and dark. */
  colours: [string, string];
  /** The insignia's outline, where the dark colour would disappear into the screen. */
  stroke?: string;
  shape: InsigniaShape;
  /** 0 none, 1 a shimmer, 2 twinkles, 3 twinkles and a glow (never lower than the rank before it). */
  sparkle: 0 | 1 | 2 | 3;
  /** The rank-up jingle: MIDI notes. */
  jingle: number[];
  /** A line for the rank-up screen. */
  line?: string;
  /** Everyone starts in this rank (exactly one row has it). */
  start?: true;
}

export interface Rank extends RankRow {
  /** The lowest rating that's this rank (-Infinity for the first). */
  min: number;
}

/** The ladder, lowest first. */
const ROWS: readonly RankRow[] = [
  { id: 'pototo', name: 'Pototo', colours: ['#ecd49c', '#9c7a3c'], shape: 'potato', sparkle: 0, jingle: [55, 52], line: 'Technically a rank.' },
  { id: 'duck', name: 'Rubber Duck', colours: ['#ffee70', '#e0a800'], shape: 'duck', sparkle: 0, jingle: [72, 76, 72], line: 'Squeak.' },
  { id: 'cardboard', name: 'Cardboard', colours: ['#ecd0a6', '#a97c50'], shape: 'box', sparkle: 0, jingle: [57, 60, 57], line: 'Fine until it rains.' },
  { id: 'wood', name: 'Wood', colours: ['#d6aa72', '#78502c'], shape: 'log', sparkle: 0, jingle: [60, 60, 64], line: 'Knock knock.' },
  { id: 'stone', name: 'Stone', colours: ['#cfd1d8', '#6b6f7a'], shape: 'stone', sparkle: 0, jingle: [55, 55, 59], line: 'Next up, the crafting table.' },
  { id: 'plastic', name: 'Plastic', colours: ['#ff7b7b', '#b91c1c'], shape: 'brick', sparkle: 0, jingle: [62, 67, 62, 67], line: 'Looks fine until you step on it.' },
  { id: 'glass', name: 'Glass', colours: ['#e4fcff', '#6fb7c9'], shape: 'glass', sparkle: 0, jingle: [72, 76, 79, 76], line: 'Please don’t throw it.' },
  { id: 'tin', name: 'Tin', colours: ['#e2e8ec', '#7d8b96'], shape: 'can', sparkle: 0, jingle: [62, 62, 67], line: 'Rattles when shaken.' },
  { id: 'iron', name: 'Iron', colours: ['#b4bccb', '#3f4756'], shape: 'anvil', sparkle: 0, jingle: [57, 60, 64, 67], line: 'Heavy, honest, a bit rusty.' },
  { id: 'bronze', name: 'Bronze', colours: ['#e0a36a', '#8a5426'], shape: 'shield', sparkle: 0, jingle: [60, 64, 67] },
  { id: 'silver', name: 'Silver', colours: ['#f2f4f8', '#8b93a6'], shape: 'shield', sparkle: 0, jingle: [62, 66, 69, 74], start: true },
  { id: 'gold', name: 'Gold', colours: ['#ffe27a', '#b8860b'], shape: 'shield', sparkle: 0, jingle: [64, 68, 71, 76] },
  { id: 'cheese', name: 'Cheese', colours: ['#ffd36a', '#d98a14'], shape: 'cheese', sparkle: 1, jingle: [64, 67, 64, 72], line: 'Gouda enough.' },
  { id: 'feudal', name: 'Feudal', colours: ['#d3d7c6', '#5f6b52'], shape: 'tower', sparkle: 1, jingle: [60, 67, 72, 67, 72], line: 'Kneel.' },
  { id: 'marble', name: 'Marble', colours: ['#f8f5f1', '#9aa0b4'], shape: 'marble', sparkle: 1, jingle: [67, 71, 74, 79], line: 'Cold, smooth, a bit smug.' },
  { id: 'platinum', name: 'Platinum', colours: ['#d9fffb', '#3fa7a0'], shape: 'hex', sparkle: 1, jingle: [65, 69, 72, 77, 81] },
  { id: 'amethyst', name: 'Amethyst', colours: ['#e6c9ff', '#7e22ce'], shape: 'crystal', sparkle: 1, jingle: [67, 70, 74, 79, 82], line: 'Gem of the month.' },
  { id: 'emerald', name: 'Emerald', colours: ['#8af5b8', '#0f8f5a'], shape: 'emerald', sparkle: 1, jingle: [66, 70, 73, 78, 82], line: 'Greener than it looks.' },
  { id: 'ruby', name: 'Ruby', colours: ['#ff9ab0', '#b3123c'], shape: 'gem', sparkle: 2, jingle: [68, 72, 75, 80, 84], line: 'Red means ranked.' },
  { id: 'sapphire', name: 'Sapphire', colours: ['#86b4ff', '#1e3a8a'], shape: 'oval', sparkle: 2, jingle: [68, 71, 75, 80, 83], line: 'Deep and a little sad.' },
  { id: 'diamond', name: 'Diamond', colours: ['#c9ecff', '#3b82f6'], shape: 'hex', sparkle: 2, jingle: [67, 71, 74, 79, 83] },
  { id: 'obsidian', name: 'Obsidian', colours: ['#a594ff', '#2d1f5e'], stroke: '#8f7bf0', shape: 'shard', sparkle: 2, jingle: [64, 67, 71, 76, 79, 83], line: 'Forged in a bad mood.' },
  { id: 'titanium', name: 'Titanium', colours: ['#d3dcea', '#4b5d78'], shape: 'tile', sparkle: 2, jingle: [66, 70, 73, 78, 82, 85], line: 'Light, strong, insufferable.' },
  { id: 'mithril', name: 'Mithril', colours: ['#f0fbff', '#3d7fd6'], shape: 'ring', sparkle: 2, jingle: [68, 72, 75, 80, 84, 87], line: 'One ring to rule the Game browser.' },
  { id: 'netherite', name: 'Netherite', colours: ['#b09a90', '#2b1f1c'], stroke: '#7a625a', shape: 'ingot', sparkle: 2, jingle: [58, 62, 65, 70, 74, 77, 82], line: 'Diamond, but angrier.' },
  { id: 'adamantium', name: 'Adamantium', colours: ['#c9d0ff', '#4338ca'], shape: 'claws', sparkle: 2, jingle: [69, 73, 76, 81, 85, 88, 93], line: 'Snikt.' },
  { id: 'plasma', name: 'Plasma', colours: ['#d8fbff', '#0ea5e9'], shape: 'bolt', sparkle: 2, jingle: [71, 75, 78, 83, 87, 90], line: 'Do not lick.' },
  { id: 'master', name: 'Master', colours: ['#ffd9a0', '#e2741d'], shape: 'star', sparkle: 2, jingle: [69, 73, 76, 81, 85, 88] },
  { id: 'grandmaster', name: 'Grandmaster', colours: ['#e4d4ff', '#7c3aed'], shape: 'star', sparkle: 3, jingle: [70, 74, 77, 82, 86, 89, 94] },
  { id: 'champion', name: 'Champion', colours: ['#ffd1ec', '#e11d74'], shape: 'crown', sparkle: 3, jingle: [72, 76, 79, 84, 88, 91, 96, 100] },
  { id: 'supernova', name: 'Supernova', colours: ['#fff3b0', '#ff6a00'], shape: 'nova', sparkle: 3, jingle: [73, 77, 80, 85, 89, 92, 97, 101], line: 'Brief, bright, and loud.' },
  { id: 'blackhole', name: 'Black Hole', colours: ['#ffd29a', '#ff5a1f'], shape: 'hole', sparkle: 3, jingle: [48, 55, 60, 67, 72, 79, 84, 96], line: 'Nothing gets out.' },
  { id: 'unobtainium', name: 'Unobtainium', colours: ['#b8ffe3', '#7c3aed'], shape: 'orb', sparkle: 3, jingle: [72, 79, 84, 88, 91, 96, 100, 103], line: 'Mathematically possible.' },
];

export const START_RATING = 1000;
/** A rank is this many rating points wide. */
export const BAND = 80;
/** The lowest rating in the starting rank: its band holds START_RATING. */
const START_MIN = 960;
/** How far one result can move a rating at most: one band. */
export const K = BAND;
/** A win (and so the loss it costs) never moves less than this: a third of a band. */
export const MIN_GAIN = BAND / 3;

const startIndex = ROWS.findIndex((r) => r.start);

export const RANKS: readonly Rank[] = ROWS.map((r, i) => ({ ...r, min: i === 0 ? -Infinity : START_MIN + (i - startIndex) * BAND }));

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

/**
 * Both players' ratings after a match: `score` is the first player's (1 win, 0.5 draw, 0 loss). A win
 * moves K × how surprising it was, never less than MIN_GAIN; the loser gives up the same. A draw is plain Elo.
 */
export function elo(a: number, b: number, score: 1 | 0.5 | 0): [number, number] {
  const e = expected(a, b);
  if (score === 0.5) {
    const d = K * (0.5 - e);
    return [a + d, b - d];
  }
  const winnerExpected = score === 1 ? e : 1 - e;
  const gain = Math.max(MIN_GAIN, K * (1 - winnerExpected));
  return score === 1 ? [a + gain, b - gain] : [a - gain, b + gain];
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

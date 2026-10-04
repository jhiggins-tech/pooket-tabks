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
 * needs its path there), a sparkle level and a jingle (a little score: audio/score.ts has the notation). The
 * ladder builds: the lowest ranks' jingles are a lone tune, then bass joins, then drums, then harmony (keep a
 * new one's parts like its neighbours'), and sparkle adds an echo, a twinkle and a chorus. Nothing else: each
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
  /** The rank-up jingle. */
  jingle: Jingle;
  /** A line for the rank-up screen. */
  line?: string;
  /** Everyone starts in this rank (exactly one row has it). */
  start?: true;
}

/**
 * A rank-up jingle: a short score (audio/score.ts reads the parts, audio/sfx.ts `rankJingle` plays it). Every
 * part lasts as long as the tune.
 */
export interface Jingle {
  /** Quarter notes a minute (a step is a sixteenth). */
  bpm: number;
  /** What plays the tune: pulse waves `square` (50%), `reed` (25%), `thin` (12.5%), or a `flute` (triangle). */
  voice: 'square' | 'reed' | 'thin' | 'flute';
  lead: string;
  bass?: string;
  harmony?: string;
  drums?: string;
  /** It ends on a minor chord (the sparkle's twinkle follows). */
  minor?: true;
}

export interface Rank extends RankRow {
  /** The lowest rating that's this rank (-Infinity for the first). */
  min: number;
}

/** The ladder, lowest first. */
const ROWS: readonly RankRow[] = [
  {
    id: 'pototo', name: 'Pototo', colours: ['#ecd49c', '#9c7a3c'], shape: 'potato', sparkle: 0, line: 'Technically a rank.',
    jingle: { bpm: 120, voice: 'reed', lead: 'g4:2 f#4 f4 e4:6' },
  },
  {
    id: 'duck', name: 'Rubber Duck', colours: ['#ffee70', '#e0a800'], shape: 'duck', sparkle: 0, line: 'Squeak.',
    jingle: { bpm: 160, voice: 'thin', lead: 'e6~:1 a6 r:2 e6~:1 a6 r:2 d6~:2 b6:4' },
  },
  {
    id: 'cardboard', name: 'Cardboard', colours: ['#ecd0a6', '#a97c50'], shape: 'box', sparkle: 0, line: 'Fine until it rains.',
    jingle: { bpm: 150, voice: 'square', lead: 'c5:1 d5 e5 g5:2 e5:1 g5 a5:2 r:1 a4~:2 c4:4' },
  },
  {
    id: 'wood', name: 'Wood', colours: ['#d6aa72', '#78502c'], shape: 'log', sparkle: 0, line: 'Knock knock.',
    jingle: { bpm: 150, voice: 'flute', lead: 'g4:1 r g4 r:2 d5:1 r c5:2 e5 g5:6' },
  },
  {
    id: 'stone', name: 'Stone', colours: ['#cfd1d8', '#6b6f7a'], shape: 'stone', sparkle: 0, line: 'Next up, the crafting table.',
    jingle: { bpm: 140, voice: 'reed', lead: 'a3:2 c4 d4 e4:1 g4 e4:2 d4 a4:6', bass: 'a2:2 a2 f2 f2 g2 g2 a2:6' },
  },
  {
    id: 'plastic', name: 'Plastic', colours: ['#ff7b7b', '#b91c1c'], shape: 'brick', sparkle: 0, line: 'Looks fine until you step on it.',
    jingle: {
      bpm: 170, voice: 'square',
      lead: 'c5:1 c6 r g5 e5 g5 c6:2 d6:1 c6 a5 g5 c6:6',
      bass: 'c3:2 g2 c3 g2 f2 g2 c3:6',
    },
  },
  {
    id: 'glass', name: 'Glass', colours: ['#e4fcff', '#6fb7c9'], shape: 'glass', sparkle: 0, line: 'Please don’t throw it.',
    jingle: {
      bpm: 132, voice: 'flute',
      lead: 'e6:1 b5 g#5 e5 r f#5 a5 d#6 e6:2 b6:6 r:1 e7',
      bass: 'e3:4 b2 a2:2 b2 e3:6',
    },
  },
  {
    id: 'tin', name: 'Tin', colours: ['#e2e8ec', '#7d8b96'], shape: 'can', sparkle: 0, line: 'Rattles when shaken.',
    jingle: {
      bpm: 160, voice: 'thin', minor: true,
      lead: 'e5:1 e5 e5 a4:2 a4:1 c5 e5 d5:2 b4 g#4 a4:4',
      bass: 'a2:2 e2 a2 e2 a2 e2 e2 a2:4',
    },
  },
  {
    id: 'iron', name: 'Iron', colours: ['#b4bccb', '#3f4756'], shape: 'anvil', sparkle: 0, line: 'Heavy, honest, a bit rusty.',
    jingle: {
      bpm: 140, voice: 'square', minor: true,
      lead: 'e4:2 e4:1 g4 a4:2 b4 d5:1 b4 a4:2 g4:1 a4 b4:2 e5:6',
      bass: 'e2:4 a2 b2 a2:2 b2 e2:6',
      drums: 'k:2 s k s k s k s:1 s k:2 c:4',
    },
  },
  {
    id: 'bronze', name: 'Bronze', colours: ['#e0a36a', '#8a5426'], shape: 'shield', sparkle: 0,
    jingle: {
      bpm: 150, voice: 'reed',
      lead: 'c5:1 c5 c5 g4 c5:2 e5 g5:3 e5:1 c5:2 g5:6',
      bass: 'c3:4 c3 g2 g2 c3',
      drums: 'k:2 h k h k h s:1 s s s k:4',
    },
  },
  {
    id: 'silver', name: 'Silver', colours: ['#f2f4f8', '#8b93a6'], shape: 'shield', sparkle: 0, start: true,
    jingle: {
      bpm: 160, voice: 'square',
      lead: 'd5:2 f#5:1 a5:3 g5:1 f#5 e5:2 d5:1 e5 f#5:2 a5 b5 a5:6',
      bass: 'd3:6 a2 g2 d3',
      drums: 'k:2 h h k h h k h h k:6',
    },
  },
  {
    id: 'gold', name: 'Gold', colours: ['#ffe27a', '#b8860b'], shape: 'shield', sparkle: 0,
    jingle: {
      bpm: 160, voice: 'square',
      lead: 'e5:3 e5:1 e5:2 b4 e5 g#5 b5 r:1 a5 g#5:2 f#5 e5:6',
      bass: 'e3:4 b2 e3 b2:2 a2 b2:4 e2:6',
      drums: 'k:3 k:1 s:2 k k s k h:1 h s:2 s c:6',
    },
  },
  {
    id: 'cheese', name: 'Cheese', colours: ['#ffd36a', '#d98a14'], shape: 'cheese', sparkle: 1, line: 'Gouda enough.',
    jingle: {
      bpm: 180, voice: 'reed',
      lead: 'g4:1 c5 e5 g5 c6:2 g5 f5:1 e5 d5 b4 g4:2 b4 d5:1 f5 a5 g5 f5:2 d5 e5:2 g5:1 e5 c5:4',
      bass: 'c3:2 r g2 r g2 r d3 r g2 r b2 r c3 g2 c3:4',
      harmony: 'r:2 e4+g4 r e4+g4 r d4+f4 r d4+f4 r d4+f4 r d4+f4 r e4+g4 e4+g4:4',
      drums: 'k:2 h k h k h k h k h k h s:1 s s s k:4',
    },
  },
  {
    id: 'feudal', name: 'Feudal', colours: ['#d3d7c6', '#5f6b52'], shape: 'tower', sparkle: 1, line: 'Kneel.',
    jingle: {
      bpm: 140, voice: 'reed', minor: true,
      lead: 'd5:2 e5:1 f5 g5:2 a5 c6 a5 g5:1 f5 e5:2 d5 c5 d5:8',
      bass: 'd3:12 c3:4 d3:12',
      harmony: 'a4:12 g4:4 a4:12',
      drums: 'k:2 h:1 h k:2 h k h:1 h k:2 h k h:1 h k:2 s k:4',
    },
  },
  {
    id: 'marble', name: 'Marble', colours: ['#f8f5f1', '#9aa0b4'], shape: 'marble', sparkle: 1, line: 'Cold, smooth, a bit smug.',
    jingle: {
      bpm: 120, voice: 'flute',
      lead: 'e5:2 g#5:1 b5 d#6:3 c#6:1 b5:2 a5 f#5 g#5:1 a5 b5:2 d#5 e5:4',
      bass: 'e3:2 g#3 b3 c#4 a2 b2 c#3 d#3 e3:4 e2',
      harmony: 'g#4+d#5:8 a4+c#5:4 a4+d#5 g#4+d#5:8',
      drums: 'k:2 h:1 h s:2 h:1 h k:2 h:1 h s:2 h:1 h k:2 r c:4',
    },
  },
  {
    id: 'platinum', name: 'Platinum', colours: ['#d9fffb', '#3fa7a0'], shape: 'hex', sparkle: 1,
    jingle: {
      bpm: 150, voice: 'square',
      lead: 'f5:2 c6 bb5:1 a5 g5:2 f5 g5:1 a5 c6:2 d6 c6 a5 bb5:1 a5 g5:2 f5:6',
      bass: 'f2:2 f3 f2 f3 d2 d3 d2 d3 bb1 bb2 c2 c3 f2:6',
      harmony: 'c5+f5:8 a4+d5 bb4+d5:4 bb4+c5 a4+c5:6',
      drums: 'k:2 h s h k h s h k h s h s:1 s c:4',
    },
  },
  {
    id: 'amethyst', name: 'Amethyst', colours: ['#e6c9ff', '#7e22ce'], shape: 'crystal', sparkle: 1, line: 'Gem of the month.',
    jingle: {
      bpm: 132, voice: 'flute',
      lead: 'c5:2 e5 f#5 g5 b5:3 a5:1 f#5:2 e5 d5 e5 f#5 c6 b5:6',
      bass: 'c3:8 d3 e3:4 d3 c3:6',
      harmony: 'e4+g4:8 f#4+a4 g4+b4 e4+b4:6',
      drums: 'k:2 h h h k h h h k h h h c:6',
    },
  },
  {
    id: 'emerald', name: 'Emerald', colours: ['#8af5b8', '#0f8f5a'], shape: 'emerald', sparkle: 1, line: 'Greener than it looks.',
    jingle: {
      bpm: 165, voice: 'reed',
      lead: 'd5:1 b4 g4 b4 d5 g5 e5:2 c5:1 a4:2 c5:1 b4 d5 g5 a5 b5 a5 g5:2 e5:1 d5:2 b4:1 c5 e5 a5 b4 d5 g5 a5 f#5 d5 g5:3',
      bass: 'g2:3 d3 c3 a2 g2 d3 e2 b2 a2 g2 d3 g2',
      harmony: 'g4+b4:6 a4+c5 g4+b4 g4+b4 a4+c5 f#4+a4:3 g4+b4',
      drums: 'k:1 h h s h h k h h s h h k h h s h h k h h s h h k h h s h h k h h c:3',
    },
  },
  {
    id: 'ruby', name: 'Ruby', colours: ['#ff9ab0', '#b3123c'], shape: 'gem', sparkle: 2, line: 'Red means ranked.',
    jingle: {
      bpm: 160, voice: 'square',
      lead: 'e5:1 g5 a5:2 a5:1 g5 e5:2 c#5:1 e5 a5:2 c6:1 b5 a5:2 d5:1 f#5 a5 d6:2 c6:1 a5:2 b5:1 g#5 e5 b5:2 d6:1 c#6 b5 a5:2 e5:1 c#5 a5:4',
      bass: 'a2:1 a2 c#3 c#3 e3 e3 f#3 e3 a2 a2 c#3 c#3 e3 e3 f#3 e3 d3 d3 f#3 f#3 a3 a3 b3 a3 e3 e3 g#3 g#3 b3 b3 c#4 b3 a2:2 e2 a2:4',
      harmony: 'r:2 a4+c#5 r a4+c#5 r a4+e5 r a4+e5 r a4+d5 r a4+d5 r g#4+d5 r g#4+b4 a4+c#5:8',
      drums: 'k:2 s k s k s k s k s k s k s k s s:1 s s s c:4',
    },
  },
  {
    id: 'sapphire', name: 'Sapphire', colours: ['#86b4ff', '#1e3a8a'], shape: 'oval', sparkle: 2, line: 'Deep and a little sad.',
    jingle: {
      bpm: 110, voice: 'reed', minor: true,
      lead: 'a4:2 c5 d5:3 f5:1 e5:2 d5 c5:1 a4 c5:2 d5 r:1 f5 g5 ab5 a5:2 d5:6',
      bass: 'd2:8 bb1 g2:4 a2 d2:6',
      harmony: 'f4+a4:8 f4+bb4 g4+bb4:4 g4+c#5 f4+a4:6',
      drums: 'k:4 s k s k s k:2 c:4',
    },
  },
  {
    id: 'diamond', name: 'Diamond', colours: ['#c9ecff', '#3b82f6'], shape: 'hex', sparkle: 2,
    jingle: {
      bpm: 150, voice: 'square',
      lead: 'd5:1 f#5 a5 d6 a5 f#5 a5 d6 e6:2 d6:1 c#6 b5:2 a5 b5:1 g5 d5 g5 b5 d6 g6:2 f#6 e6:1 d6 c#6:2 e6 d6:8',
      bass: 'd3:4 a2 a2 a2 g2 g2 a2 a2 d2:8',
      harmony: 'f#4+a4:8 e4+a4 g4+b4 e4+a4:4 e4+g4 f#4+a4:8',
      drums: 'k:2 h s h k h s h k h s h s:1 s s s s s s s c:8',
    },
  },
  {
    id: 'obsidian', name: 'Obsidian', colours: ['#a594ff', '#2d1f5e'], stroke: '#8f7bf0', shape: 'shard', sparkle: 2, line: 'Forged in a bad mood.',
    jingle: {
      bpm: 150, voice: 'square', minor: true,
      lead: 'e5:1 e5 f5:2 e5:1 e5 g5:2 e5:1 e5 f5:2 e5:1 e5 bb5:2 a5 g5:1 f5 g5:2 f5:1 e5 f5:2 e5:1 d5 e5:4 b4:1 c5 d5 f5 e5:4',
      bass: 'e2:1 e2 e2 e2 f2:2 e2 e2:1 e2 e2 e2 bb1:2 e2 d2:1 d2 d2 d2 c2:2 d2 c2:1 c2 c2 c2 f2:2 e2 e2:1 e2 e2 e2 e2:4',
      harmony: 'b3+e4:4 c4+f4 b3+e4 bb3+e4 d4+a4 d4+g4 c4+f4 b3+e4 b3+e4:8',
      drums: 'k:1 k s:2 k:1 k s:2 k:1 k s:2 k:1 k s:2 k:1 k s:2 k:1 k s:2 k:1 k s:2 k:1 k s:2 s:1 s s s c:4',
    },
  },
  {
    id: 'titanium', name: 'Titanium', colours: ['#d3dcea', '#4b5d78'], shape: 'tile', sparkle: 2, line: 'Light, strong, insufferable.',
    jingle: {
      bpm: 160, voice: 'thin', minor: true,
      lead: 'a4:1 a5 e5 a4 c5 a5 e5 c5 a4 a5 e5 a4 d5 a5 f5 d5 g4 g5 d5 g4 b4 g5 d5 b4 e4 e5 b4 e4 g#4 e5 b4 g#4 a4 c5 e5 a5 c6 e6 a6:6',
      bass: 'a2:2 a2 a2 a2 f2 f2 f2 f2 g2 g2 g2 g2 e2 e2 e2 e2 a2:12',
      harmony: 'c5+e5:8 c5+f5 b4+d5 b4+e5 c5+e5:12',
      drums: 'k:2 h k h k h k h k h k h k h k h k:1 k k k s s s s c:4',
    },
  },
  {
    id: 'mithril', name: 'Mithril', colours: ['#f0fbff', '#3d7fd6'], shape: 'ring', sparkle: 2, line: 'One ring to rule the Game browser.',
    jingle: {
      bpm: 135, voice: 'flute',
      lead: 'd5:1 e5 f#5 a5:3 b5:1 a5 f#5 e5:3 d5:1 e5 f#5 a5 b5 d6 e6:3 c#6 b5:1 a5 g5 f#5 e5 c#5 d5:6',
      bass: 'd3:3 a3 g2 d3 b2 f#3 a2 e3 g2 a2 d2:6',
      harmony: 'f#4:1 a4 d5 a4 f#4 a4 g4 b4 d5 b4 g4 b4 f#4 b4 d5 b4 f#4 b4 e4 a4 c#5 a4 e4 a4 e4 g4 b4 c#5 b4 a4 f#4+a4+d5:6',
      drums: 'k:3 h h h k h h h k h c:6',
    },
  },
  {
    id: 'netherite', name: 'Netherite', colours: ['#b09a90', '#2b1f1c'], stroke: '#7a625a', shape: 'ingot', sparkle: 2, line: 'Diamond, but angrier.',
    jingle: {
      bpm: 160, voice: 'square', minor: true,
      lead: 'd5:1 f5 a5 d6 a5 f5 a5 d6 e6:2 d6:1 c6 bb5:2 a5 bb5:1 g5 d5 g5 bb5 d6 g6:2 f6 e6:1 d6 c#6:2 e6 d6:1 r d5 r d6:8',
      bass: 'd2:1 d2 d2 d2 d2 d2 d2 d2 c2 c2 c2 c2 c2 c2 c2 c2 g2 g2 g2 g2 g2 g2 g2 g2 a2 a2 a2 a2 a2 a2 a2 a2 d2:2 r d2:8',
      harmony: 'd4+a4:8 c4+g4 bb3+g4 a3+e4 d4+a4:2 r d4+a4:8',
      drums: 'k:1 k s:2 k:1 k s:2 k:1 k s:2 k:1 k s:2 k:1 k s:2 k:1 k s:2 k:1 k s:2 k:1 k s:2 c:2 r c:8',
    },
  },
  {
    id: 'adamantium', name: 'Adamantium', colours: ['#c9d0ff', '#4338ca'], shape: 'claws', sparkle: 2, line: 'Snikt.',
    jingle: {
      bpm: 168, voice: 'square', minor: true,
      lead: 'e5~:1 e6 r e5~ e6 r:3 e5:2 e5:1 g5 b5:2 a5:1 g5 a5:2 a5:1 c6 e6:2 d6:1 c6 b5:2 a5:1 g5 f#5:2 d#5 e5:1 g5 b5 e6 g6:4 e6:8',
      bass: 'e2:1 r:3 e2:1 r:3 e2:1 e2 e3 e2 e2 e2 e3 e2 a2 a2 a3 a2 a2 a2 a3 a2 b2 b2 b3 b2 b2:2 b1 e2:1 e2 e3 e2 e2:4 e2:8',
      harmony: 'r:8 g4+b4 a4+c5 a4+b4:4 f#4+b4 g4+b4:8 g4+b4+e5',
      drums: 's:1 r:3 s:1 r:3 k:2 s k s k s k s k s k s s:1 s s s s s s s c:8',
    },
  },
  {
    id: 'plasma', name: 'Plasma', colours: ['#d8fbff', '#0ea5e9'], shape: 'bolt', sparkle: 2, line: 'Do not lick.',
    jingle: {
      bpm: 176, voice: 'thin',
      lead: 'c5~:2 c6:1 bb5 ab5~:2 e6 d6:1 c6 bb5 ab5 f#5 e5 f#5 ab5 bb5~:2 e6 d6:1 c6 d6:2 e6:1 d6 c6 bb5 c6 d6 e6 f#6 g6:2 d6:1 b5 g5:2 b5 d6~:1 g6:7',
      bass: 'c3:4 d3 e3 f#3 ab2 bb2 c3 d3 g2 d2 g2:8',
      harmony: 'e4+bb4:8 f#4+c5 ab4+d5 e4+bb4:4 f#4+c5 b4+d5:8 b4+d5+g5',
      drums: 'k:2 h:1 h s:2 h:1 h k:2 h:1 h s:2 h:1 h k:2 h:1 h s:2 h:1 h k:2 h:1 h s:2 h:1 h k:2 h:1 h s:2 s:1 s c:8',
    },
  },
  {
    id: 'master', name: 'Master', colours: ['#ffd9a0', '#e2741d'], shape: 'star', sparkle: 2,
    jingle: {
      bpm: 140, voice: 'reed',
      lead: 'a4:3 d5:1 d5:2 e5 f#5:3 g5:1 a5:4 c6:3 b5:1 a5:2 g5 f#5 g5:1 a5 b5:2 c#6 d6:8',
      bass: 'd3:4 d3 d3 d3 c3 c3 g2 a2 d3:8',
      harmony: 'f#4+a4:8 a4+d5 g4+c5:4 e4+g4 d4+b4 e4+a4 f#4+a4+d5:8',
      drums: 'k:2 s:1 s k:2 s k:2 s:1 s k:2 s k:2 s:1 s k:2 s s:1 s s s s s s s c:8',
    },
  },
  {
    id: 'grandmaster', name: 'Grandmaster', colours: ['#e4d4ff', '#7c3aed'], shape: 'star', sparkle: 3,
    jingle: {
      bpm: 132, voice: 'square',
      lead: 'g4:2 c5 e5 g5 f5:3 e5:1 d5:2 g5 ab5:3 g5:1 f5:2 eb5 f5 bb5 d6 f6 g6:3 f6:1 d6:2 b5 c6:8',
      bass: 'c3:4 e3 f3 g3 ab2 c3 bb2 d3 g2 g2 c2:8',
      harmony: 'e4+g4:8 f4+a4:4 f4+b4 ab4+c5 eb4+ab4 f4+bb4 d4+f4 f4+b4 d4+g4 e4+g4+c5:8',
      drums: 'k:2 h s h k h s h k h s h k:1 k s:2 k:1 k s:2 s:1 s s s s s s s c:8',
    },
  },
  {
    id: 'champion', name: 'Champion', colours: ['#ffd1ec', '#e11d74'], shape: 'crown', sparkle: 3,
    jingle: {
      bpm: 140, voice: 'square',
      lead: 'c5:1 c5 c5 c5 e5:2 g5 a5:3 g5:1 e5:2 c5 d5:1 d5 d5 d5 f5:2 a5 b5:3 a5:1 g5:4 c6:2 b5:1 a5 g5:2 e6 c6:1 e6 g6:2 c7:8',
      bass: 'c3:2 c3 g2 c3 f2 f2 c3 f2 d3 d3 a2 d3 g2 g2 d3 g2 f2:4 g2 c3:2 c3 c2:8',
      harmony: 'e4+g4:8 f4+a4 f4+a4 f4+b4:4 d4+b4 a4+c5 b4+d5 e4+g4+c5:12',
      drums: 'k:2 h s h k h s h k h s h k h s s:1 s s s s s s s s s c:12',
    },
  },
  {
    id: 'supernova', name: 'Supernova', colours: ['#fff3b0', '#ff6a00'], shape: 'nova', sparkle: 3, line: 'Brief, bright, and loud.',
    jingle: {
      bpm: 150, voice: 'square',
      lead: 'c5:1 d5 e5 g5 c5 d5 e5 g5 d5 e5 f#5 a5 d5 e5 f#5 a5 e5 f#5 g#5 b5 e5 f#5 g#5 b5 f5 g5 a5 c6 g5 a5 b5 d6 e6~:2 c7:6 g6:2 e6 c7:8',
      bass: 'c3:2 c3 c3 c3 d3 d3 d3 d3 e3 e3 e3 e3 f3 f3 g3 g3 c2:8 c3:4 c2:8',
      harmony: 'e4+g4:8 f#4+a4 g#4+b4 a4+c5:4 b4+d5 c5+e5+g5:8 e4+g4:4 e4+g4+c5:8',
      drums: 'k:4 k k:2 k k k k:1 s k s k s k s s s s s s s s s c:8 k:2 s c:8',
    },
  },
  {
    id: 'blackhole', name: 'Black Hole', colours: ['#ffd29a', '#ff5a1f'], shape: 'hole', sparkle: 3, line: 'Nothing gets out.',
    jingle: {
      bpm: 100, voice: 'reed', minor: true,
      lead: 'e5:3 f5:1 e5:2 d#5 c5:3 b4:1 c5:2 a4 f4:3 e4:1 d#4:2 b3 e4~:4 e2:8',
      bass: 'a2:8 f2 b1 e2:12',
      harmony: 'c4+e4:8 a3+c4 a3+d#4 g3+b3:12',
      drums: 'k:2 k:1 r:5 k:2 k:1 r:5 k:2 k:1 r:5 k:2 k:1 r:1 c:8',
    },
  },
  {
    id: 'unobtainium', name: 'Unobtainium', colours: ['#b8ffe3', '#7c3aed'], shape: 'orb', sparkle: 3, line: 'Mathematically possible.',
    jingle: {
      bpm: 132, voice: 'square',
      lead: 'c6:2 a5:1 c6 e6:2 b5 d6 c6:1 a5 g5:4 a5:1 b5 c6 d6 e6:2 g6 f#6:3 e6:1 d6:2 b5 c6:1 e6 g6 c7 b6:2 g6 c7:12',
      bass: 'f2:4 f2 g2 g2 a2 e2 d3 g2 c3 g2 c2:12',
      harmony: 'a4+e5:8 b4+d5 c5+e5 a4+d5:4 b4+d5 c5+e5 b4+d5 e5+g5+c6:12',
      drums: 'h:2 h h h k h s h k h s h k:1 k s:2 k:1 k s:2 s:1 s s s s s s s c:12',
    },
  },
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

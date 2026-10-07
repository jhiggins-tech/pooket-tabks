/**
 * Characters on the way: shown in the character pickers (hotseat, Choose your tank) and the info screen
 * with a "Coming soon" banner, never playable. Deliberately not in ROSTER, so nothing in the game, saved
 * settings or online play can pick one up. When one is ready it moves to its own kit file (kits/).
 */
export interface Upcoming {
  id: string;
  name: string;
  colour: string;
  /** A first look at what they'll have (work in progress: names and slots may change). */
  teasers?: Teaser[];
}

export interface Teaser {
  slot: 'Tier 1' | 'Tier 2' | 'Tier 3' | 'Bonus action' | 'Movement' | 'Passive';
  name: string;
}

export const UPCOMING: readonly Upcoming[] = [
  {
    id: 'shotdownboyz',
    name: 'shotdownboyz',
    colour: '#f87171',
    teasers: [
      { slot: 'Tier 2', name: 'summon digger' },
      { slot: 'Tier 3', name: 'neurodiverge' },
      { slot: 'Passive', name: 'tank build' },
    ],
  },
  { id: 'odsey', name: 'odsey', colour: '#c084fc' },
  {
    id: 'lankcity',
    name: 'lankcity',
    colour: '#38bdf8',
    teasers: [
      { slot: 'Tier 2', name: 'HARD disk drive' },
      { slot: 'Movement', name: 'lizard walk' },
    ],
  },
  { id: 'doctorfox', name: 'doctorfox', colour: '#fb923c' },
];

const byId = new Map(UPCOMING.map((u) => [u.id, u]));

/** The upcoming character with this id, if it's one. */
export function upcoming(id: string): Upcoming | undefined {
  return byId.get(id);
}

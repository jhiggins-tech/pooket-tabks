/**
 * Characters on the way: shown in the character pickers (hotseat, Choose your tank) and the info screen
 * with a "Coming soon" banner, never playable. Deliberately not in ROSTER, so nothing in the game, saved
 * settings or online play can pick one up. When one is ready it moves to its own kit file (kits/).
 */
export interface Upcoming {
  id: string;
  name: string;
  colour: string;
}

export const UPCOMING: readonly Upcoming[] = [
  { id: 'garyoldmancorp', name: 'garyoldmancorp', colour: '#cbd5e1' },
  { id: 'shotdownboyz', name: 'shotdownboyz', colour: '#f87171' },
  { id: 'kiwicore', name: 'kiwicore', colour: '#84cc16' },
  { id: 'odsey', name: 'odsey', colour: '#c084fc' },
  { id: 'lankcity', name: 'lankcity', colour: '#38bdf8' },
  { id: 'doctorfox', name: 'doctorfox', colour: '#fb923c' },
];

const byId = new Map(UPCOMING.map((u) => [u.id, u]));

/** The upcoming character with this id, if it's one. */
export function upcoming(id: string): Upcoming | undefined {
  return byId.get(id);
}

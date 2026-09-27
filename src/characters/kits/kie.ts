import type { WeaponDef } from '../../weapons/types';
import { kit } from '../kit';

/**
 * kie's tier 1: three weasels tumble out of the barrel at aim −4° / 0° / +4°. Each one that lands
 * scurries along the ground towards the nearest enemy and pops right under it (or as close as it can get
 * within blast range), or when it runs out of steam.
 */
export const weaselPop: WeaponDef = {
  id: 'weasel-pop',
  name: 'Weasel Pop',
  shortName: 'Weasel Pop',
  info:
    '3 tumbling weasels at your aim and ±4°. Where they land they scurry towards the nearest enemy, right up under it, and pop for up to 20 each. Stopped short but in range, they pop there; otherwise after 2.5s.',
  blastRadius: 20,
  damage: 20,
  volley: { count: 3, spreadDeg: 4 },
  sprite: 'weasel',
  spin: 12,
  trail: false,
  walk: { speed: 40, duration: 2.5, climb: 6, fuse: 3 },
  tune: 'pop-goes-the-weasel',
};

/**
 * kie's tier 2: two more hologram copies of kie's tank appear across the battlefield each use. On later turns
 * kie can tap one to secretly swap places with it once his shot has landed. Anyone who hits a
 * hologram takes half the damage they would have dealt, and the hologram vanishes at turn end.
 */
export const trollogram: WeaponDef = {
  id: 'trollogram',
  name: 'Trollogram',
  shortName: 'Trollogram',
  info:
    'No aiming. 2 hologram copies of kie’s tank appear, and every use adds 2 more. Tap one to secretly swap places with it: right after casting (then DONE), or on a later turn before you fire. Whoever hits a hologram takes half the damage themselves.',
  kind: 'decoy',
  decoys: 2,
  blastRadius: 0,
  damage: 0,
  colour: '#7cf7d4',
};

/**
 * kie's tier 3: a roulette spins over a random enemy's weapons and lands on one; kie takes a round of it
 * (they lose it) and it replaces Steal in his slot, ready to fire. Stealing doesn't use up the turn.
 */
export const steal: WeaponDef = {
  id: 'steal',
  name: 'Steal',
  shortName: 'Steal',
  info:
    'No aiming. A roulette spins over the enemy’s weapons and lands on one at random: kie pinches a round of it (they lose it), and it takes Steal’s place, ready to fire this turn.',
  kind: 'steal',
  blastRadius: 0,
  damage: 0,
  colour: '#4ea8ff',
};

export const kie = kit(
  {
    id: 'kie',
    name: 'kie',
    blurb: 'Weasel Pop, Trollogram decoys he can secretly swap with, and he steals.',
    colours: ['#4ea8ff', '#46d27a', '#2dd4bf'],
  },
  [weaselPop, trollogram, steal],
);

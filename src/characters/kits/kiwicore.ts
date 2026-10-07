import type { WeaponDef } from '../../weapons/types';
import { kit } from '../kit';

/**
 * kiwicore, in beta: the berètta M2 is his real tier 1 (his flat cap, thrown like a boomerang:
 * game/boomerang.ts; he wears it when it isn't flying); tiers 2 and 3 are stand-ins (plain ballistic
 * shells) until his own moves are ready (throwdown is to be tier 2).
 */

/** Tier 1: the flat cap off his head, out along the aim and round and home, through hills. */
export const berettaM2 = {
  id: 'beretta-m2',
  name: 'berètta M2',
  shortName: 'berètta M2',
  info:
    'Throw your flat cap like a boomerang: it flies through hills, out along your aim (power sets how far) and curls round and back to you. 20 damage to each enemy it passes through, on the way out and again on the way back: up to 40 if both passes catch them. You catch it, no harm done.',
  kind: 'boomerang',
  boomerang: { minRange: 100, maxRange: 900, curl: 0.3, flight: 0.3, damage: 20 },
  colour: '#8a7a5c',
} satisfies WeaponDef;

/** Tier 2 stand-in: a medium shell (throwdown to come). */
export const kiwiMortar = {
  id: 'kiwi-mortar',
  name: 'Beta Mortar',
  shortName: 'Beta Mortar',
  info: 'A stand-in while kiwicore is in beta: a medium shell, up to 45 damage.',
  blastRadius: 26,
  damage: 45,
} satisfies WeaponDef;

/** Tier 3 stand-in: a big shell. */
export const kiwiBomb = {
  id: 'kiwi-bomb',
  name: 'Beta Bomb',
  shortName: 'Beta Bomb',
  info: 'A stand-in while kiwicore is in beta: one big shell, up to 70 damage and a big crater.',
  blastRadius: 40,
  damage: 70,
} satisfies WeaponDef;

export const kiwicore = kit(
  {
    id: 'kiwicore',
    name: 'kiwicore',
    blurb: 'Beta: the berètta M2, a flat cap thrown like a boomerang, and stand-in shots for now.',
    colours: ['#84cc16', '#a3e635', '#65a30d'],
    hat: 'flat-cap',
    beta: true,
  },
  [berettaM2, kiwiMortar, kiwiBomb],
);

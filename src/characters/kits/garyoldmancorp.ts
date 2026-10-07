import type { WeaponDef } from '../../weapons/types';
import { kit } from '../kit';

/**
 * garyoldmancorp, in beta: Diced Coffee is his real bonus move; the three shots are stand-ins (plain
 * ballistic shells, small, medium and big) until his own moves are ready.
 */

/** Tier 1 stand-in: a small shell. */
export const betaShot = {
  id: 'beta-shot',
  name: 'Beta Shot',
  shortName: 'Beta Shot',
  info: 'A stand-in while garyoldmancorp is in beta: a small shell, up to 30 damage.',
  blastRadius: 18,
  damage: 30,
} satisfies WeaponDef;

/** Tier 2 stand-in: a medium shell. */
export const betaMortar = {
  id: 'beta-mortar',
  name: 'Beta Mortar',
  shortName: 'Beta Mortar',
  info: 'A stand-in while garyoldmancorp is in beta: a medium shell, up to 45 damage.',
  blastRadius: 26,
  damage: 45,
} satisfies WeaponDef;

/** Tier 3 stand-in: a big shell. */
export const betaBomb = {
  id: 'beta-bomb',
  name: 'Beta Bomb',
  shortName: 'Beta Bomb',
  info: 'A stand-in while garyoldmancorp is in beta: one big shell, up to 70 damage and a big crater.',
  blastRadius: 40,
  damage: 70,
} satisfies WeaponDef;

/**
 * garyoldmancorp's bonus move: a spinner (game/coffee.ts). Lactose free (90% the first time): he drinks
 * it and goes again after this turn. Full cream: a little ten-2 straight up, and it's gone for good. Each
 * win makes the next spin 10% riskier. Once a turn.
 */
export const dicedCoffee = {
  id: 'diced-coffee',
  name: 'Diced Coffee',
  shortName: 'Diced Coffee',
  info:
    'Bonus move: doesn’t use your turn (aim and fire as usual after it), once a turn. Spin the wheel: lactose free and you drink it, and the enemy’s next turn is skipped (you go twice in a row); full cream and you’re jetpacked straight up, and Diced Coffee is gone for the match. It starts at a 10% chance of full cream, 10% more after every win.',
  kind: 'coffee',
  coffee: { failChance: 0.1, failStep: 0.1 },
  // A small ten-2, straight up (game/coffee.ts launches it at 90°, full power).
  jetpack: {
    chargeTime: 1.2,
    thrust: 0.4,
    burnTime: 0.3,
    particlesPerSecond: 90,
    exhaustSpeed: 230,
    exhaustSpeedRange: [0.5, 1.3],
    exhaustSpreadDeg: 70,
  },
  // Its exhaust is harmless: a splash of spilt cream.
  gunk: { dosePerParticle: 0, dosePerSecond: 0, deposit: [236, 226, 200], depositRadius: 1.2, look: 'mud' },
  friendlyFire: false,
  colour: '#c99a6b',
} satisfies WeaponDef;

export const garyoldmancorp = kit(
  {
    id: 'garyoldmancorp',
    name: 'garyoldmancorp',
    blurb: 'Beta: Diced Coffee for two turns in a row, and stand-in shots for now.',
    colours: ['#cbd5e1', '#a5b4fc', '#fcd34d'],
    beta: true,
  },
  [betaShot, betaMortar, betaBomb, dicedCoffee],
);

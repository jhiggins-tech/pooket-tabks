import type { WeaponDef } from '../../weapons/types';
import { kit } from '../kit';

/**
 * garyoldmancorp, in beta: Hoop Dreamz (tier 2), 007 (tier 3) and Diced Coffee (the bonus move) are his
 * real moves; tier 1 is a stand-in (a plain ballistic shell) until his own is ready.
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

/**
 * Tier 2: a basketball hoop hangs over the enemy (game/hoop.ts). Through the middle of the rim it's a slam
 * dunk, straight down onto them for the blast (70, from the middle of the tank); off the rim it's a loose
 * ball, bouncing about, 15 to the first enemy it lands on.
 */
export const hoopDreamz = {
  id: 'hoop-dreamz',
  name: 'Hoop Dreamz',
  shortName: 'Hoop Dreamz',
  info:
    'A basketball hoop appears above the enemy. Shoot the ball through it (aim and power as usual): through the middle of the rim it’s a slam dunk, smashed straight down onto them for 70 damage and a crater. Off the rim, the backboard or the ground it just bounces about, and if it bounces onto an enemy it does 15.',
  kind: 'hoop',
  hoop: { height: 110, rimHalf: 13, swish: 8, looseDamage: 15, restitution: 0.62 },
  blastRadius: 24,
  damage: 70,
  colour: '#f97316',
} satisfies WeaponDef;

/**
 * Tier 3: Bond trivia (game/bond.ts, the questions in weapons/trivia.ts). Name the right Bond actor and the
 * gun barrel opens on the enemy nearest him, a little spy sting plays, and they lose 77% of the health they
 * have left. Wrong (or no answer in 20 s): nothing.
 */
export const doubleOSeven = {
  id: 'double-o-seven',
  name: '007',
  shortName: '007',
  info:
    'A James Bond trivia question pops up, and the answer is always one of the Bond actors, Sean Connery to Daniel Craig. You have 20 seconds. Get it right and the gun barrel opens on the nearest enemy, a little spy sting plays, and they lose 77% of the health they have left. Get it wrong and nothing happens.',
  kind: 'bond',
  bond: { time: 20, share: 0.77 },
  colour: '#fde047',
} satisfies WeaponDef;

/**
 * garyoldmancorp's bonus move: a spinner (game/coffee.ts). Lactose free (90% the first time): he drinks
 * it and goes again after this turn. Full cream: a little ten-2 straight up, his turn ends there, and it's
 * gone for good. Each win makes the next spin 10% riskier. Once a turn.
 */
export const dicedCoffee = {
  id: 'diced-coffee',
  name: 'Diced Coffee',
  shortName: 'Diced Coffee',
  info:
    'Bonus move, once a turn: spin the wheel before you fire. Lactose free: you drink it, aim and fire as usual, and the enemy’s next turn is skipped (you go twice in a row). Full cream: you’re jetpacked straight up, your turn is over, and Diced Coffee is gone for the match. It starts at a 10% chance of full cream, 10% more after every win.',
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
    blurb: 'Beta: Hoop Dreamz, a slam dunk onto the enemy; 007, Bond trivia that takes 77% of their health; Diced Coffee for two turns in a row; and a stand-in shot for now.',
    colours: ['#cbd5e1', '#a5b4fc', '#fcd34d'],
    movement: 'scooter',
    beta: true,
  },
  [betaShot, hoopDreamz, doubleOSeven, dicedCoffee],
);

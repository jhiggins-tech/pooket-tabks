import type { WeaponDef } from '../../weapons/types';
import { kit } from '../kit';

/** garyoldmancorp: Mr Bean (tier 1), Hoop Dreamz (tier 2), 007 (tier 3) and Diced Coffee (the bonus move); he rides a scooter. */

/**
 * Tier 1: ten coffee beans rapid-fired along the aim (a burst, lobbed like any shell, a few degrees of
 * spread), 2 each. They home in hard once they're near an enemy: further out and tighter turning than the
 * Rizzler (radius 100, 720°/s), so most of a close miss still lands. `flat`, so a bean that hits does its
 * 2 (falloff would round a 2 down to 1).
 */
export const mrBean = {
  id: 'mr-bean',
  name: 'Mr Bean',
  shortName: 'Mr Bean',
  info:
    'Rapid fire: 10 coffee beans lobbed along your aim, spreading a little. Get them within about 170px of an enemy and they home straight in, hard. 2 damage each.',
  blastRadius: 5,
  damage: 2,
  flat: true,
  burst: { count: 10, interval: 0.07, powerJitter: 0.06, aimJitterDeg: 4 },
  homing: { radius: 170, turnRate: 1440, minSpeed: 320 },
  sprite: 'coffee-bean',
  spin: 9,
  trail: false,
  colour: '#7c4a24',
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
    blurb: 'Mr Bean, a burst of homing coffee beans; Hoop Dreamz, a slam dunk onto the enemy; 007, Bond trivia that takes 77% of their health; and Diced Coffee for two turns in a row.',
    colours: ['#cbd5e1', '#a5b4fc', '#fcd34d'],
    movement: 'scooter',
  },
  [mrBean, hoopDreamz, doubleOSeven, dicedCoffee],
);

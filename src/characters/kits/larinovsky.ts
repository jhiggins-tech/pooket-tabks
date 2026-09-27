import type { WeaponDef } from '../../weapons/types';
import { kit } from '../kit';

/** larinovsky's tier 1: indirect fire, a series of four pills lobbed along the aim that walk across the target. */
export const pillPusher: WeaponDef = {
  id: 'pill-pusher',
  name: 'Pill Pusher',
  shortName: 'Pill Pusher',
  info:
    'Indirect fire: 4 pills lobbed one after another along your aim, walking the blasts across the target. Up to 12 each.',
  blastRadius: 14,
  damage: 12,
  burst: { count: 4, interval: 0.15, powerJitter: 0.05 },
  sprite: 'pill',
  // A mixed handful: a red and white capsule, a round mint tablet, a blue and yellow capsule, a lilac caplet.
  spriteVariants: ['pill-red', 'pill-round', 'pill-blue', 'pill-oval'],
  trail: false,
};

/**
 * larinovsky's tier 2: a spinning heart in shades. Its blast "cooks" any enemy it catches: on their
 * next turn everything they fire does half damage.
 */
export const theRizzler: WeaponDef = {
  id: 'the-rizzler',
  name: 'the Rizzler',
  shortName: 'the Rizzler',
  info:
    'A spinning heart in shades that can’t resist a tank: get it within about 100px of an enemy and it homes straight in. Up to 18 damage, and enemies in the blast are cooked: everything they fire on their next turn does half damage.',
  blastRadius: 26,
  damage: 18,
  debuff: { offenceMultiplier: 0.5 },
  homing: { radius: 100, turnRate: 720, minSpeed: 240 },
  sprite: 'rizz',
  spin: 5,
  colour: '#ff6fb5',
};

/** larinovsky's tier 3: a quick nap, waking at full health. Takes the turn; no aiming. */
export const takeANap: WeaponDef = {
  id: 'take-a-nap',
  name: 'Take a Nap',
  shortName: 'Take a Nap',
  info:
    'No aiming. larinovsky dozes off for 2 seconds and wakes up at full health. Uses the turn.',
  kind: 'heal',
  blastRadius: 0,
  damage: 0,
  heal: { napTime: 2 },
  colour: '#7ee7a8',
};

export const larinovsky = kit(
  {
    id: 'larinovsky',
    name: 'larinovsky',
    blurb: 'Pill Pusher, the Rizzler, and a well-earned nap.',
    colours: ['#34d399', '#a3e635', '#22d3ee'],
  },
  [pillPusher, theRizzler, takeANap],
);

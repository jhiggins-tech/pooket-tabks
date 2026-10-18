import type { WeaponDef } from '../../weapons/types';
import { kit } from '../kit';

/**
 * doctorfox, in beta: Sly (tier 2), Air Strike (tier 3) and his movement, an Arwing (game/movement.ts), are
 * his own; tier 1 is a stand-in (a plain ballistic shell) until his own is ready.
 */

/** Tier 1 stand-in: a small shell. */
export const foxShot = {
  id: 'fox-shot',
  name: 'Beta Shot',
  shortName: 'Beta Shot',
  info: 'A stand-in while doctorfox is in beta: a small shell, up to 30 damage.',
  blastRadius: 18,
  damage: 30,
} satisfies WeaponDef;

/**
 * Tier 2: a smokescreen, and he's gone (game/sly.ts). A full tank of fuel and 10 s to drive off out of
 * sight; hidden from the others until his next turn, unless something hits him.
 */
export const sly = {
  id: 'sly',
  name: 'Sly',
  shortName: 'Sly',
  info:
    'A smokescreen goes up round you and you vanish. Your fuel is filled right up and you have 10 seconds to drive off (FIRE to finish sooner); that’s your turn. You stay out of the enemy’s sight until your next turn, but you can still be hit, and a hit gives you away. Weapons that seek out the nearest enemy can’t find you.',
  kind: 'sly',
  sly: { time: 10 },
  colour: '#9ca3af',
} satisfies WeaponDef;

/**
 * Tier 3: three Arwings come in from the horizon and strafe the enemy nearest him with lasers, then bomb
 * them (game/airstrike.ts), while one of the Star Fox team comes over the comm (weapons/comms.ts). Up to
 * 8 × 4 from the lasers (about a third of them land on the tank) and 40 from the bomb: about 50 a strike,
 * in line with the Marathon's 50 (a sure thing, but it takes no skill).
 */
export const airStrike = {
  id: 'air-strike',
  name: 'Air Strike',
  shortName: 'Air Strike',
  info: 'No aiming. A ping of light on the horizon, and three Arwings come in over the nearest enemy you can see and strafe them with lasers: 8 bolts across them, 4 damage for each that hits. Then the bomb, right on them: up to 40 and a crater. Someone from the Star Fox team has something to say about it.',
  kind: 'airstrike',
  airstrike: { lasers: 8, laserDamage: 4, laserRadius: 6, spread: 30 },
  blastRadius: 34,
  damage: 40,
  colour: '#60a5fa',
} satisfies WeaponDef;

export const doctorfox = kit(
  {
    id: 'doctorfox',
    name: 'doctorfox',
    blurb: 'Beta: flies an Arwing over anything; Sly, a smokescreen to fly off unseen on a full tank; Air Strike, three Arwings to strafe and bomb the enemy; and a stand-in shot for now.',
    colours: ['#fb923c', '#fdba74', '#ea580c'],
    movement: 'arwing',
    beta: true,
  },
  [foxShot, sly, airStrike],
);

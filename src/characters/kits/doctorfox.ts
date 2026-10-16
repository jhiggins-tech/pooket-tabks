import type { WeaponDef } from '../../weapons/types';
import { kit } from '../kit';

/**
 * doctorfox, in beta: Sly (tier 2) is his real move; tiers 1 and 3 are stand-ins (plain ballistic
 * shells, small and big) until his own are ready.
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

/** Tier 3 stand-in: a big shell. */
export const foxBomb = {
  id: 'fox-bomb',
  name: 'Beta Bomb',
  shortName: 'Beta Bomb',
  info: 'A stand-in while doctorfox is in beta: one big shell, up to 70 damage and a big crater.',
  blastRadius: 40,
  damage: 70,
} satisfies WeaponDef;

export const doctorfox = kit(
  {
    id: 'doctorfox',
    name: 'doctorfox',
    blurb: 'Beta: Sly, a smokescreen to sneak off unseen on a full tank; and stand-in shots for now.',
    colours: ['#fb923c', '#fdba74', '#ea580c'],
    beta: true,
  },
  [foxShot, sly, foxBomb],
);

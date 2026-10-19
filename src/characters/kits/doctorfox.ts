import type { WeaponDef } from '../../weapons/types';
import { kit } from '../kit';

/**
 * doctorfox, in beta (until the owner says he's ready): Calculated (tier 1), Sly (tier 2), Air Strike
 * (tier 3), Who's That Pokémon? (a bonus move) and his movement, an Arwing (game/movement.ts).
 */

/**
 * Tier 1: a lobbed ball of plasma, up to 30 (as the stand-in it replaces), with three harmless tracers
 * either side, 10° apart: where each lands it shows how far off his aim it was ("+20°"), until he fires
 * again (game/projectiles.ts), so he can work out the next one.
 */
export const calculated = {
  id: 'calculated',
  name: 'Calculated',
  shortName: 'Calculated',
  info: 'A lobbed ball of plasma, up to 30 damage, with three tracer rounds fanned out either side of it, 10° apart. The tracers do no damage: where each one lands it shows how many degrees off your aim it was (+10°, −20°…), and the numbers stay up until you fire again.',
  blastRadius: 18,
  damage: 30,
  tracers: { count: 3, stepDeg: 10 },
  plasma: true,
  colour: '#22d3ee',
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

/**
 * Bonus move, once a turn: Who's That Pokémon? (game/pokemon.ts). A silhouette, four names, 10 s. Right:
 * a round of Calculated back (up to full); wrong, or out of time: gone for the match. His sixth go is always
 * MissingNo., and that glitches it out for good. It can't be stolen (no bonus move can).
 */
export const whosThatPokemon = {
  id: 'whos-that-pokemon',
  name: 'Who’s That Pokémon?',
  shortName: 'Who’s That?',
  info: 'Bonus move, once a turn, before you fire: a Pokémon’s silhouette and four names, 10 seconds to pick. Right, and you get a round of Calculated back (up to full). Wrong, or out of time, and it’s gone for the match. Any of all 1025 Pokémon. And if you ever get to a sixth go… something glitches. It can’t be stolen.',
  kind: 'pokemon',
  pokemon: { time: 10, options: 4, refill: 0, missingNo: 6 },
  colour: '#facc15',
} satisfies WeaponDef;

export const doctorfox = kit(
  {
    id: 'doctorfox',
    name: 'doctorfox',
    blurb: 'Beta: flies an Arwing over anything; Calculated, plasma with tracers that show how far off they were; Sly, a smokescreen to fly off unseen on a full tank; Air Strike, three Arwings to strafe and bomb the enemy; and Who’s That Pokémon?, a bonus move.',
    colours: ['#fb923c', '#fdba74', '#ea580c'],
    movement: 'arwing',
    beta: 'testing',
  },
  [calculated, sly, airStrike, whosThatPokemon],
);

import type { WeaponDef } from '../../weapons/types';
import { kit } from '../kit';

/** Beta stand-in shots while ShotDownBoyz's own weapons are being designed. */
export const betaShot = {
  id: 'digger-shot',
  name: 'Beta Shot',
  shortName: 'Beta Shot',
  info: 'A stand-in while ShotDownBoyz is in beta: a shell for 30 damage.',
  blastRadius: 20,
  damage: 30,
} satisfies WeaponDef;

/** Beta stand-in shots while ShotDownBoyz's own weapons are being designed. */
export const betaBomb = {
  id: 'digger-bomb',
  name: 'Beta Bomb',
  shortName: 'Beta Bomb',
  info: 'A stand-in while ShotDownBoyz is in beta: a bomb for 50 damage.',
  blastRadius: 30,
  damage: 50,
} satisfies WeaponDef;

/**
 * Prepper: he drills into the ground and a brick bunker builds round him, open only in a 35° slit along
 * his aim (game/bunker.ts). The bricks are terrain: shells hit them and blasts knock them out.
 */
export const prepper = {
  id: 'prepper',
  name: 'Prepper',
  shortName: 'Prepper',
  info:
    'He drills into the ground and a brick bunker builds round him, open only in a 35° slit where he’s aiming. Shells stop at the walls and blasts knock bricks out; a shot aimed outside the slit hits his own wall. He can’t drive until it’s knocked down (most of its bricks gone).',
  kind: 'bunker',
  bunker: { sink: 8, drillTime: 1.2, buildTime: 2.3, inner: 22, courses: 3, course: 3, brick: 7, slit: 35, standing: 0.4 },
} satisfies WeaponDef;

/** Bonus move: enter bulldozer mode for this turn. */
export const activateDigger = {
  id: 'activate-digger',
  name: 'Activate Digger',
  shortName: 'Digger',
  info:
    'Bonus move, once each turn: activate the bulldozer. ◀ ▶ then drive horizontally through any terrain, leaving a tunnel. The digger lasts until your turn ends and uses fuel as you move, but never uses up its bonus slot.',
  kind: 'digger',
} satisfies WeaponDef;

export const shotdownboyz = kit(
  {
    id: 'shotdownboyz',
    name: 'shotdownboyz',
    blurb: 'Beta: two stand-in shots, the Prepper bunker, a front-mounted bulldozer, and the Digger bonus move. When his fuel runs out, a second diesel tank refills it next turn.',
    colours: ['#f87171', '#fb7185', '#ef4444'],
    beta: true,
  },
  [betaShot, betaBomb, prepper, activateDigger],
);

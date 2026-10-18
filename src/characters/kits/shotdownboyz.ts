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

/** Beta stand-in shots while ShotDownBoyz's own weapons are being designed. */
export const betaBlast = {
  id: 'digger-blast',
  name: 'Beta Blast',
  shortName: 'Beta Blast',
  info: 'A stand-in while ShotDownBoyz is in beta: a big shell for 70 damage and a wide crater.',
  blastRadius: 40,
  damage: 70,
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
    blurb: 'Beta: three stand-in shots, a front-mounted bulldozer, and the Digger bonus move. When his fuel runs out, a second diesel tank refills it next turn.',
    colours: ['#f87171', '#fb7185', '#ef4444'],
    beta: true,
  },
  [betaShot, betaBomb, betaBlast, activateDigger],
);

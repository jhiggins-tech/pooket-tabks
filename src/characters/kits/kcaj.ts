import type { WeaponDef } from '../../weapons/types';
import { kit } from '../kit';

/** kcaj's tier 1: two ice cream cones fanned ±2° either side of the aim. */
export const doublePark: WeaponDef = {
  id: 'double-park',
  name: 'Double Park',
  shortName: 'Double Park',
  info:
    'Two ice cream cones fired together, 2° either side of your aim. Small blasts of up to 25 each; land both for a double scoop.',
  blastRadius: 16,
  damage: 25,
  volley: { count: 2, spreadDeg: 2 },
  sprite: 'ice-cream-cone',
};

/** kcaj's tier 2: a straight laser from the barrel; a direct hit keeps burning for 3 turns. */
export const hyperfixate: WeaponDef = {
  id: 'hyperfixate',
  name: 'Hyperfixate',
  shortName: 'Hyperfixate',
  info:
    'A laser straight out of the barrel: no arc, and power doesn’t matter. It stops at the first ground in its way (no shooting through hills), so you need a clear line. A direct hit does 15, then burns for 8 at the start of the victim’s next 3 turns.',
  kind: 'beam',
  blastRadius: 7,
  damage: 15,
  dot: { damagePerTurn: 8, turns: 3 },
  colour: '#ff3df2',
};

/** kcaj's tier 3: pills rain over the whole stage, bounce twice, then pop. Never hurts kcaj. */
export const unmedicated: WeaponDef = {
  id: 'unmedicated',
  name: 'Unmedicated',
  shortName: 'Unmedicated',
  info:
    'No aiming. 120 pills rain across the whole stage, bounce twice and pop. Each is tiny (up to 7), but the sheer volume adds up. Never hurts kcaj.',
  kind: 'rain',
  rainCount: 120,
  blastRadius: 11,
  damage: 7, // ~33 total on average across random maps (5–70 range): the volume does the work
  bounces: 2,
  restitution: 0.55,
  friendlyFire: false,
  sprite: 'pill',
  trail: false,
};

export const kcaj = kit(
  {
    id: 'kcaj',
    name: 'kcaj',
    blurb: 'Ice cream volleys, a fixating laser and a pill storm.',
    colours: ['#ffc53d', '#c77dff', '#e2e8f0'],
  },
  [doublePark, hyperfixate, unmedicated],
);

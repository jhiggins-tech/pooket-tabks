import type { WeaponDef } from '../../weapons/types';
import { kit } from '../kit';

/**
 * ciarra's tier 1: a buzzing stream of ink needles. Each is a tiny hit, and any tank it catches is
 * tattooed: +25% damage from everything until it has had two more turns.
 */
export const tattooGun: WeaponDef = {
  id: 'tattoo-gun',
  name: 'Tattoo Gun',
  shortName: 'Tattoo Gun',
  info:
    'A burst of 12 ink needles (up to 3 each). Any enemy hit is tattooed: they take +25% damage from everything until they’ve had 2 more turns.',
  blastRadius: 5,
  damage: 3,
  burst: { count: 12, interval: 0.05, powerJitter: 0.02 },
  tattoo: { multiplier: 1.25, turns: 2 },
  sprite: 'ink-needle',
  trail: false,
  colour: '#1e2a4a',
};

/** ciarra's tier 2: needle and thread zig-zag through anything; stitched enemies are pinned for a turn. */
export const sew: WeaponDef = {
  id: 'sew',
  name: 'Sew',
  shortName: 'Sew',
  info:
    'A needle and thread stitch straight along your aim, through terrain without digging; power sets how far. Enemies stitched take 20 and are pinned: they can’t move on their next turn.',
  kind: 'sew',
  blastRadius: 0,
  damage: 0,
  sew: { speed: 520, minRange: 200, maxRange: 700, amplitude: 7, wavelength: 56, damage: 20 },
  pin: true,
  colour: '#f472b6',
};

/** ciarra's tier 3: a marathon runner who jogs a leg every time anyone fires, and hits hard on arrival. */
export const marathon: WeaponDef = {
  id: 'marathon',
  name: 'Marathon',
  shortName: 'Marathon',
  info:
    'No aiming. A runner sets off towards the nearest enemy and runs a leg every time anyone fires, over any hill. A leg is 150px, about a seventh of the stage’s width, so a far-off enemy is several shots away. At the finish: a 50 damage blast. A blast near the runner means a DNF.',
  kind: 'runner',
  blastRadius: 0,
  damage: 0,
  runner: { speed: 85, leg: 150, damage: 50, radius: 30 },
  colour: '#f472b6',
};

export const ciarra = kit(
  {
    id: 'ciarra',
    name: 'ciarra',
    blurb: 'Tattoo Gun, Sew and Marathon, and she hops like a frog.',
    colours: ['#f472b6', '#fb7185', '#fda4af'],
    movement: 'hop',
  },
  [tattooGun, sew, marathon],
);

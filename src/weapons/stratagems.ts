/**
 * ShotDownBoyz's stratagems (game/stratagems.ts): what each one is, its Helldivers 2 combo (U D L R, the
 * game's own inputs; the Grenade Pistol and SMG are sidearms there, so they borrow the GL-21 Grenade
 * Launcher's and MG-43 Machine Gun's), and how many of his turns it re-arms for once used. No combo is the
 * start of another, so a combo is done the moment its last arrow goes in (tests/stratagems.test.ts).
 *
 * - `ordnance`: it comes down where the beacon lands (`strike`: the orbital laser or the railcannon).
 * - `turret`: a sentry drops where the beacon lands and fires every turn, anyone's, for `shots` rounds.
 * - `weapon`: a pod drops; when he drives into it, its weapon takes his tier 1's place (the rounds stay).
 * - `supply`: Resupply: a pod drops; driving into it gives him a diesel can, tier 1 and tier 2 rounds.
 */

export type Arrow = 'U' | 'D' | 'L' | 'R';

export type StratagemDef = {
  id: string;
  name: string;
  /** For the cards round the d-pad. */
  shortName: string;
  combo: string;
  /** His turns it's re-arming for, once used. */
  cooldown: number;
  /** What it does, in a line, for the info screen. */
  blurb: string;
} & (
  | { category: 'ordnance'; strike: 'laser' | 'railcannon' }
  | { category: 'turret'; sentry: 'rocket' | 'tesla' | 'autocannon'; shots: number }
  | { category: 'weapon'; weaponId: string }
  | { category: 'supply' }
);

export const STRATAGEMS: readonly StratagemDef[] = [
  { id: 'orbital-laser', name: 'Orbital Laser', shortName: 'Laser', combo: 'RDURD', cooldown: 5, category: 'ordnance', strike: 'laser', blurb: 'A beam from orbit burns down on the beacon and drifts toward any enemy close by, cutting a trench.' },
  { id: 'railcannon', name: 'Railcannon Strike', shortName: 'Railcannon', combo: 'RUDDR', cooldown: 5, category: 'ordnance', strike: 'railcannon', blurb: 'One railgun round straight down on the beacon: huge damage in a tiny blast.' },
  { id: 'rocket-sentry', name: 'Rocket Sentry', shortName: 'Rockets', combo: 'DURRL', cooldown: 4, category: 'turret', sentry: 'rocket', shots: 3, blurb: 'A sentry that fires a homing rocket at the enemy every turn, three times.' },
  { id: 'tesla-tower', name: 'Tesla Tower', shortName: 'Tesla', combo: 'DURULR', cooldown: 4, category: 'turret', sentry: 'tesla', shots: 3, blurb: 'Zaps every tank close by every turn, three times: him too.' },
  { id: 'autocannon-sentry', name: 'Autocannon Sentry', shortName: 'Autocannon', combo: 'DURULU', cooldown: 4, category: 'turret', sentry: 'autocannon', shots: 3, blurb: 'A sentry that lobs a shell right at the nearest enemy every turn, three times.' },
  { id: 'wasp', name: 'W.A.S.P. Launcher', shortName: 'W.A.S.P.', combo: 'DDUDR', cooldown: 3, category: 'weapon', weaponId: 'wasp', blurb: 'Drive into the pod: a salvo of little homing missiles replaces the Pistol.' },
  { id: 'spear', name: 'Spear', shortName: 'Spear', combo: 'DDUDD', cooldown: 3, category: 'weapon', weaponId: 'spear', blurb: 'Drive into the pod: a heavy missile that curves toward the enemy replaces the Pistol.' },
  { id: 'quasar', name: 'Quasar Cannon', shortName: 'Quasar', combo: 'DDULR', cooldown: 3, category: 'weapon', weaponId: 'quasar', blurb: 'Drive into the pod: a laser bolt that flies dead straight replaces the Pistol.' },
  { id: 'grenade-pistol', name: 'Grenade Pistol', shortName: 'Gren. Pistol', combo: 'DLULD', cooldown: 3, category: 'weapon', weaponId: 'grenade-pistol', blurb: 'Drive into the pod: a grenade that bounces once replaces the Pistol.' },
  { id: 'smg', name: 'Submachine Gun', shortName: 'SMG', combo: 'DLDUR', cooldown: 3, category: 'weapon', weaponId: 'smg', blurb: 'Drive into the pod: a spray of weak bullets replaces the Pistol.' },
  { id: 'resupply', name: 'Resupply', shortName: 'Resupply', combo: 'DDUR', cooldown: 4, category: 'supply', blurb: 'Drive into the pod: a diesel can in reserve, 3 Pistol rounds and 1 Stratagem round (not past full).' },
];

/** A stratagem by id (an unknown id is a bug: it throws). */
export function stratagemOf(id: string): StratagemDef {
  const s = STRATAGEMS.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown stratagem: ${id}`);
  return s;
}

/** The arrow for each input, as drawn on the cards. */
export const ARROW_GLYPH: Record<Arrow, string> = { U: '▲', D: '▼', L: '◀', R: '▶' };

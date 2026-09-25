import type { WeaponDef } from './types';

export const shell: WeaponDef = {
  id: 'shell',
  name: 'Shell',
  shortName: 'Shell',
  blastRadius: 24,
  damage: 45,
};

export const heavyShell: WeaponDef = {
  id: 'heavy-shell',
  name: 'Heavy Shell',
  shortName: 'Heavy',
  blastRadius: 36,
  damage: 45,
};

export const megaShell: WeaponDef = {
  id: 'mega-shell',
  name: 'Mega Shell',
  shortName: 'Mega',
  blastRadius: 54,
  damage: 45,
};

/** kcaj's tier 1: two ice cream cones fanned ±2° either side of the aim. */
export const doublePark: WeaponDef = {
  id: 'double-park',
  name: 'Double Park',
  shortName: 'Double Park',
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

/**
 * tones' tier 1: a pressurised water jet. Builds from a dribble to the full aimed arc over 2s,
 * holds briefly, then eases off. Water doesn't dig; it trickles damage onto whatever it soaks.
 */
export const ten1: WeaponDef = {
  id: 'ten-1',
  name: 'ten-1',
  shortName: 'ten-1',
  kind: 'stream',
  blastRadius: 0,
  damage: 0,
  stream: { rampUp: 2, hold: 0.7, rampDown: 1.2, dropsPerSecond: 110, damagePerDrop: 0.35 },
  friendlyFire: false,
  colour: '#3fb6ff',
};

const weapons: WeaponDef[] = [shell, heavyShell, megaShell, doublePark, hyperfixate, unmedicated, ten1];

const byId = new Map(weapons.map((w) => [w.id, w]));

export function getWeapon(id: string): WeaponDef {
  const w = byId.get(id);
  if (!w) throw new Error(`Unknown weapon: ${id}`);
  return w;
}

export function allWeapons(): readonly WeaponDef[] {
  return weapons;
}

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

const weapons: WeaponDef[] = [shell, heavyShell, megaShell, doublePark];

const byId = new Map(weapons.map((w) => [w.id, w]));

export function getWeapon(id: string): WeaponDef {
  const w = byId.get(id);
  if (!w) throw new Error(`Unknown weapon: ${id}`);
  return w;
}

export function allWeapons(): readonly WeaponDef[] {
  return weapons;
}

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

const weapons: WeaponDef[] = [shell, heavyShell, megaShell];

const byId = new Map(weapons.map((w) => [w.id, w]));

export function getWeapon(id: string): WeaponDef {
  const w = byId.get(id);
  if (!w) throw new Error(`Unknown weapon: ${id}`);
  return w;
}

export function allWeapons(): readonly WeaponDef[] {
  return weapons;
}

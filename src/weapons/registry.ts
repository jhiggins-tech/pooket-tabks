import type { WeaponDef } from './types';

export const basicShell: WeaponDef = {
  id: 'shell',
  name: 'Shell',
  blastRadius: 32,
  damage: 45,
};

const weapons: WeaponDef[] = [basicShell];

const byId = new Map(weapons.map((w) => [w.id, w]));

export function getWeapon(id: string): WeaponDef {
  const w = byId.get(id);
  if (!w) throw new Error(`Unknown weapon: ${id}`);
  return w;
}

export function allWeapons(): readonly WeaponDef[] {
  return weapons;
}

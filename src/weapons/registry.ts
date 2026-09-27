import { KITS } from '../characters/kits';
import type { WeaponDef } from './types';

export const shell: WeaponDef = {
  id: 'shell',
  name: 'Shell',
  shortName: 'Shell',
  info:
    'A classic artillery shell. Lob it over the hills: a big crater and 45 damage on a direct hit, less towards the edge of the blast.',
  blastRadius: 24,
  damage: 45,
};

/** Every weapon: the plain shell, and each character's three (their definitions live with the character, in characters/kits/). */
const weapons: WeaponDef[] = [shell, ...KITS.flatMap((k) => k.weapons)];

const byId = new Map(weapons.map((w) => [w.id, w]));

export function getWeapon(id: string): WeaponDef {
  const w = byId.get(id);
  if (!w) throw new Error(`Unknown weapon: ${id}`);
  return w;
}

/** Weapons that don't use the aim at all: just press FIRE. */
export function ignoresAim(w: WeaponDef): boolean {
  const kind = w.kind ?? 'ballistic';
  return kind === 'rain' || kind === 'decoy' || kind === 'heal' || kind === 'twin' || kind === 'runner' || kind === 'steal';
}

export function allWeapons(): readonly WeaponDef[] {
  return weapons;
}

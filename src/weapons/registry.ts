import { KITS } from '../characters/kits';
import { KINDS, type WeaponKind } from './kinds';
import type { WeaponDef, WeaponOf } from './types';

export const shell = {
  id: 'shell',
  name: 'Shell',
  shortName: 'Shell',
  info:
    'A classic artillery shell. Lob it over the hills: a big crater and 45 damage on a direct hit, less towards the edge of the blast.',
  blastRadius: 24,
  damage: 45,
} satisfies WeaponDef;

/** Every weapon: the plain shell, and each character's three (their definitions live with the character, in characters/kits/). */
const weapons: WeaponDef[] = [shell, ...KITS.flatMap((k) => k.weapons)];

const byId = new Map(weapons.map((w) => [w.id, w]));

/** A weapon by id (an unknown id is a bug in the game: it throws). */
export function getWeapon(id: string): WeaponDef {
  const w = byId.get(id);
  if (!w) throw new Error(`Unknown weapon: ${id}`);
  return w;
}

/** A weapon by id, if there is one: for presentation (sounds, pictures), which can do without. */
export function findWeapon(id: string): WeaponDef | undefined {
  return byId.get(id);
}

/** A weapon of a particular kind, with its kind's spec (an id of another kind is a bug: it throws). */
export function weaponOf<K extends WeaponKind>(id: string, kind: K): WeaponOf<K> {
  const w = getWeapon(id);
  if (kindOf(w) !== kind) throw new Error(`${id} isn't a ${kind} weapon`);
  return w as WeaponOf<K>;
}

/** The weapon a projectile was fired with (ballistic or rain). */
export function projectileWeapon(id: string): WeaponOf<'ballistic' | 'rain'> {
  const w = getWeapon(id);
  if (!isProjectileWeapon(w)) throw new Error(`${id} doesn't fire projectiles`);
  return w;
}

export function isProjectileWeapon(w: WeaponDef): w is WeaponOf<'ballistic' | 'rain'> {
  const k = kindOf(w);
  return k === 'ballistic' || k === 'rain';
}

/** A weapon that throws gunk (jetpack propellant, spew chunks). */
export function gunkWeapon(id: string): WeaponOf<'jetpack' | 'spew'> {
  const w = getWeapon(id);
  if (!('gunk' in w)) throw new Error(`${id} doesn't throw gunk`);
  return w;
}

/** How big a weapon's blast is (nothing, for kinds that don't blow up). */
export function blastOf(w: WeaponDef): { radius: number; damage: number } {
  return 'blastRadius' in w ? { radius: w.blastRadius, damage: w.damage } : { radius: 0, damage: 0 };
}

/** A weapon's kind (ballistic unless it says). */
export function kindOf(w: WeaponDef): WeaponKind {
  return w.kind ?? 'ballistic';
}

/** Weapons that don't use the aim at all: just press FIRE. */
export function ignoresAim(w: WeaponDef): boolean {
  return !KINDS[kindOf(w)].aims;
}

/** Once-a-match bonus moves (they don't spend the turn, and Take a Nap's restock skips them). */
export function isBonus(w: WeaponDef): boolean {
  return KINDS[kindOf(w)].turn === 'bonus';
}

export function allWeapons(): readonly WeaponDef[] {
  return weapons;
}

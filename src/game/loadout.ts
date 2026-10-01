import { getWeapon } from '../weapons/registry';
import type { WeaponDef } from '../weapons/types';
import type { Player } from './state';

/** A player's weapons and rounds: which weapon is in a tier, and keeping a loaded tier selected. */

export function weaponForTier(p: Player, tier: number): WeaponDef {
  return getWeapon(p.loadout[tier]!);
}

/**
 * The selected tier has run out: select the lowest tier that still has rounds. Returns whether any tier
 * does (a player with none sits out, game.ts).
 */
export function reselect(p: Player): boolean {
  if ((p.ammo[p.selectedTier] ?? 0) > 0) return true;
  const next = p.ammo.findIndex((n) => n > 0);
  if (next < 0) return false;
  p.selectedTier = next;
  return true;
}

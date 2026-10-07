import type { WeaponDef } from '../weapons/types';

/** Weapon ids: tiers 1, 2 and 3, then optionally a bonus move. */
export type Loadout = readonly [tier1: string, tier2: string, tier3: string] | readonly [tier1: string, tier2: string, tier3: string, bonus: string];

export interface CharacterDef {
  id: string;
  name: string;
  blurb: string;
  /** Signature colour first; alternates are used when several players pick the same character. */
  colours: readonly string[];
  /** Weapon ids by tier. */
  loadout: Loadout;
  /** How the ◀ ▶ buttons move this character: roll along the ground, frog hops, or a fast scooter that crashes. Default drive. */
  movement?: 'drive' | 'hop' | 'scooter';
  /** Something worn on the tank's dome (kiwicore's flat cap, which his berètta M2 throws). */
  hat?: 'flat-cap';
  /** Starting (and full) health, if not the usual MAX_HP. */
  maxHp?: number;
  /** Playable but unfinished (stand-in moves): marked Beta in the pickers and the info screen. */
  beta?: true;
}

/** A character and the weapons of their loadout (tiers 1, 2 and 3, and optionally a bonus move), defined together in one file. */
export interface Kit {
  character: CharacterDef;
  weapons: readonly [WeaponDef, WeaponDef, WeaponDef] | readonly [WeaponDef, WeaponDef, WeaponDef, WeaponDef];
}

/** A character whose loadout is these weapons, by tier. */
export function kit(character: Omit<CharacterDef, 'loadout'>, weapons: Kit['weapons']): Kit {
  return { character: { ...character, loadout: weapons.map((w) => w.id) as unknown as Loadout }, weapons };
}

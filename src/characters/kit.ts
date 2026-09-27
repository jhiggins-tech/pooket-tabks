import type { WeaponDef } from '../weapons/types';

export type Loadout = readonly [tier1: string, tier2: string, tier3: string];

export interface CharacterDef {
  id: string;
  name: string;
  blurb: string;
  /** Signature colour first; alternates are used when several players pick the same character. */
  colours: readonly string[];
  /** Weapon ids by tier. */
  loadout: Loadout;
  /** How the ◀ ▶ buttons move this character: roll along the ground, or frog hops. Default drive. */
  movement?: 'drive' | 'hop';
}

/** A character and the three weapons of their loadout (tiers 1, 2 and 3), defined together in one file. */
export interface Kit {
  character: CharacterDef;
  weapons: readonly [WeaponDef, WeaponDef, WeaponDef];
}

/** A character whose loadout is these three weapons, by tier. */
export function kit(character: Omit<CharacterDef, 'loadout'>, weapons: Kit['weapons']): Kit {
  return { character: { ...character, loadout: [weapons[0].id, weapons[1].id, weapons[2].id] }, weapons };
}

import { getWeapon } from '../weapons/registry';
import type { CharacterDef } from './kit';
import { KITS } from './kits';

/** Rounds per tier at the start of a match: tier 1, tier 2, tier 3 (and a bonus move, for those who have one). */
export const AMMO_PER_TIER = [5, 3, 1, 1] as const;

export type { CharacterDef, Loadout } from './kit';

/** The selectable characters, in setup-screen order (each defined with their weapons in ./kits/). */
export const ROSTER: readonly CharacterDef[] = KITS.map((k) => k.character);

const byId = new Map(ROSTER.map((c) => [c.id, c]));

export function getCharacter(id: string): CharacterDef {
  const c = byId.get(id);
  if (!c) throw new Error(`Unknown character: ${id}`);
  return c;
}

export function isCharacterId(id: string): boolean {
  return byId.has(id);
}

/**
 * One colour per player: each gets their character's signature colour, or the next
 * alternate if an earlier player already has it, so tanks always look distinct.
 */
export function assignColours(characterIds: readonly string[]): string[] {
  const used = new Set<string>();
  const fallback = ROSTER.flatMap((c) => c.colours);
  return characterIds.map((id) => {
    const options = [...getCharacter(id).colours, ...fallback];
    const colour = options.find((c) => !used.has(c)) ?? options[0]!;
    used.add(colour);
    return colour;
  });
}

export function loadoutSummary(c: CharacterDef): string {
  return c.loadout.map((id, tier) => `${getWeapon(id).shortName} ×${AMMO_PER_TIER[tier]}`).join(' · ');
}

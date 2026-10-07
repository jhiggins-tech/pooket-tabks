import type { PlayerConfig } from '../game/state';
import { PLAYER_KEY } from '../stats/summary';
import { getWeapon } from '../weapons/registry';
import type { CharacterDef } from './kit';
import { KITS } from './kits';

/** Rounds per tier at the start of a match: tier 1, tier 2, tier 3 (and a bonus move, for those who have one). */
export const AMMO_PER_TIER = [5, 3, 1, 1] as const;

/** A full stock of tier `tier` (a match's start, Take a Nap's restock). Every kit has 3 or 4 tiers (roster tests). */
export function fullAmmo(tier: number): number {
  return AMMO_PER_TIER[tier] ?? 1;
}

export type { CharacterDef, Loadout } from './kit';

/** The selectable characters, in setup-screen order (each defined with their weapons in ./kits/). */
export const ROSTER: readonly CharacterDef[] = KITS.map((k) => k.character);

const byId = new Map(ROSTER.map((c) => [c.id, c]));

export function getCharacter(id: string): CharacterDef {
  const c = byId.get(id);
  if (!c) throw new Error(`Unknown character: ${id}`);
  return c;
}

/** A character's name (or its id, for one this version doesn't have: a match from a newer version). */
export function characterName(id: string): string {
  return byId.get(id)?.name ?? id;
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

/**
 * A match's players from their picks, in seat order: each in their colour (assignColours) and, signed in,
 * with their stats key (if it looks like one).
 */
export function matchPlayers(picks: readonly { name: string; characterId: string; key?: string }[]): PlayerConfig[] {
  const colours = assignColours(picks.map((p) => p.characterId));
  return picks.map((p, i) => ({ name: p.name, characterId: p.characterId, colour: colours[i]!, ...(p.key && PLAYER_KEY.test(p.key) ? { key: p.key } : {}) }));
}

export function loadoutSummary(c: CharacterDef): string {
  return c.loadout.map((id, tier) => `${getWeapon(id).shortName} ×${AMMO_PER_TIER[tier]}`).join(' · ');
}

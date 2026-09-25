import { getWeapon } from '../weapons/registry';

/** Rounds per tier at the start of a match: tier 1, tier 2, tier 3. */
export const AMMO_PER_TIER = [5, 3, 1] as const;
export const TIER_COUNT = AMMO_PER_TIER.length;

export type Loadout = readonly [tier1: string, tier2: string, tier3: string];

export interface CharacterDef {
  id: string;
  name: string;
  blurb: string;
  /** Signature colour first; alternates are used when several players pick the same character. */
  colours: readonly string[];
  /** Weapon ids by tier. */
  loadout: Loadout;
}

/** Proof-of-concept loadout for characters that don't have their own weapons yet. */
const DEFAULT_LOADOUT: Loadout = ['shell', 'heavy-shell', 'mega-shell'];

export const ROSTER: readonly CharacterDef[] = [
  {
    id: 'tones',
    name: 'tones',
    blurb: 'ten-1: a pressurised water jet.',
    colours: ['#ff5a5f', '#ff8c42', '#ff7eb6'],
    loadout: ['ten-1', 'heavy-shell', 'mega-shell'],
  },
  {
    id: 'kie',
    name: 'kie',
    blurb: 'Standard-issue shells in three sizes.',
    colours: ['#4ea8ff', '#46d27a', '#2dd4bf'],
    loadout: DEFAULT_LOADOUT,
  },
  {
    id: 'kcaj',
    name: 'kcaj',
    blurb: 'Ice cream volleys, a fixating laser and a pill storm.',
    colours: ['#ffc53d', '#c77dff', '#e2e8f0'],
    loadout: ['double-park', 'hyperfixate', 'unmedicated'],
  },
];

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

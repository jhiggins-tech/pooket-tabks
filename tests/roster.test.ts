import { describe, expect, it } from 'vitest';
import { AMMO_PER_TIER, assignColours, getCharacter, loadoutSummary, ROSTER } from '../src/characters/roster';
import { getWeapon } from '../src/weapons/registry';

describe('roster', () => {
  it('uses 5 / 3 / 1 rounds for tiers 1-3', () => {
    expect(AMMO_PER_TIER).toEqual([5, 3, 1]);
  });

  it('every character has a valid three-tier loadout', () => {
    for (const c of ROSTER) {
      expect(c.loadout).toHaveLength(3);
      for (const id of c.loadout) expect(() => getWeapon(id)).not.toThrow();
    }
  });

  it("the Rookie's tiers are the same shell with a growing blast radius", () => {
    const radii = getCharacter('rookie').loadout.map((id) => getWeapon(id).blastRadius);
    expect(radii[0]!).toBeLessThan(radii[1]!);
    expect(radii[1]!).toBeLessThan(radii[2]!);
  });

  it('gives players who pick the same character distinct colours', () => {
    const colours = assignColours(['rookie', 'rookie', 'rookie', 'rookie']);
    expect(new Set(colours).size).toBe(4);
    expect(colours[0]).toBe(getCharacter('rookie').colours[0]);
  });

  it('summarises a loadout for the setup screen', () => {
    expect(loadoutSummary(getCharacter('rookie'))).toBe('Shell ×5 · Heavy ×3 · Mega ×1');
  });
});

import { describe, expect, it } from 'vitest';
import { AMMO_PER_TIER, assignColours, getCharacter, loadoutSummary, ROSTER } from '../src/characters/roster';
import { getWeapon } from '../src/weapons/registry';

describe('roster', () => {
  it('has the three selectable characters', () => {
    expect(ROSTER.map((c) => c.name)).toEqual(['tones', 'kie', 'kcaj']);
  });

  it('uses 5 / 3 / 1 rounds for tiers 1-3', () => {
    expect(AMMO_PER_TIER).toEqual([5, 3, 1]);
  });

  it('every character has a valid three-tier loadout of growing blast radius', () => {
    for (const c of ROSTER) {
      expect(c.loadout).toEqual(['shell', 'heavy-shell', 'mega-shell']);
      const radii = c.loadout.map((id) => getWeapon(id).blastRadius);
      expect(radii[0]!).toBeLessThan(radii[1]!);
      expect(radii[1]!).toBeLessThan(radii[2]!);
    }
  });

  it('each character has its own signature colour', () => {
    const signatures = ROSTER.map((c) => c.colours[0]);
    expect(new Set(signatures).size).toBe(ROSTER.length);
    expect(assignColours(['tones', 'kie'])).toEqual([getCharacter('tones').colours[0], getCharacter('kie').colours[0]]);
  });

  it('gives players who pick the same character distinct colours', () => {
    const colours = assignColours(['kcaj', 'kcaj']);
    expect(colours[0]).toBe(getCharacter('kcaj').colours[0]);
    expect(colours[1]).not.toBe(colours[0]);
  });

  it('summarises a loadout for the setup screen', () => {
    expect(loadoutSummary(getCharacter('tones'))).toBe('Shell ×5 · Heavy ×3 · Mega ×1');
  });
});

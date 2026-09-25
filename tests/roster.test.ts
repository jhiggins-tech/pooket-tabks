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

  it('every character has a valid three-tier loadout', () => {
    for (const c of ROSTER) {
      expect(c.loadout).toHaveLength(3);
      for (const id of c.loadout) expect(() => getWeapon(id)).not.toThrow();
    }
  });

  it("kie's loadout is Shell, Heavy Shell, Trollogram", () => {
    expect(getCharacter('kie').loadout).toEqual(['shell', 'heavy-shell', 'trollogram']);
  });

  it('the shell tiers grow in blast radius', () => {
    const radii = ['shell', 'heavy-shell', 'mega-shell'].map((w) => getWeapon(w).blastRadius);
    expect(radii[0]!).toBeLessThan(radii[1]!);
    expect(radii[1]!).toBeLessThan(radii[2]!);
  });

  it("tones' base weapon is ten-1", () => {
    expect(getCharacter('tones').loadout).toEqual(['ten-1', 'heavy-shell', 'mega-shell']);
  });

  it("kcaj's loadout is Double Park, Hyperfixate, Unmedicated", () => {
    expect(getCharacter('kcaj').loadout).toEqual(['double-park', 'hyperfixate', 'unmedicated']);
    expect(loadoutSummary(getCharacter('kcaj'))).toBe('Double Park ×5 · Hyperfixate ×3 · Unmedicated ×1');
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
    expect(loadoutSummary(getCharacter('kie'))).toBe('Shell ×5 · Heavy ×3 · Trollogram ×1');
    expect(loadoutSummary(getCharacter('tones'))).toBe('ten-1 ×5 · Heavy ×3 · Mega ×1');
  });
});

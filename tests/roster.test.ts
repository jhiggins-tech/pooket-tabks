import { describe, expect, it } from 'vitest';
import { AMMO_PER_TIER, assignColours, getCharacter, loadoutSummary, ROSTER } from '../src/characters/roster';
import { getWeapon } from '../src/weapons/registry';

describe('roster', () => {
  it('has the six selectable characters', () => {
    expect(ROSTER.map((c) => c.name)).toEqual(['tones', 'kie', 'kcaj', 'torikloud', 'ciarra', 'larinovsky']);
  });

  it('torikloud, larinovsky and ciarra have their own kits', () => {
    expect(getCharacter('torikloud').loadout).toEqual(['debate', 'sonic-boom', 'twins']);
    expect(getCharacter('ciarra').loadout).toEqual(['tattoo-gun', 'sew', 'marathon']);
    expect(getCharacter('ciarra').movement).toBe('hop');
    expect(getCharacter('larinovsky').loadout).toEqual(['pill-pusher', 'the-rizzler', 'take-a-nap']);
    expect(loadoutSummary(getCharacter('larinovsky'))).toBe('Pill Pusher ×5 · the Rizzler ×3 · Take a Nap ×1');
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

  it("kie's loadout is Shell, Weasel Pop, Trollogram", () => {
    expect(getCharacter('kie').loadout).toEqual(['shell', 'weasel-pop', 'trollogram']);
  });

  it("tones' loadout is ten-1, ten-2, ten-3", () => {
    expect(getCharacter('tones').loadout).toEqual(['ten-1', 'ten-2', 'ten-3']);
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
    expect(loadoutSummary(getCharacter('kie'))).toBe('Shell ×5 · Weasel Pop ×3 · Trollogram ×1');
    expect(loadoutSummary(getCharacter('tones'))).toBe('ten-1 ×5 · ten-2 ×3 · ten-3 ×1');
  });
});

import { describe, expect, it } from 'vitest';
import { AMMO_PER_TIER, assignColours, getCharacter, loadoutSummary, ROSTER } from '../src/characters/roster';
import { getWeapon } from '../src/weapons/registry';
import { isCharacterId } from '../src/characters/roster';
import { upcoming, UPCOMING } from '../src/characters/upcoming';

describe('roster', () => {
  it('has the six selectable characters', () => {
    expect(ROSTER.map((c) => c.name)).toEqual(['tones', 'kie', 'kcaj', 'torikloud', 'ciarra', 'larinovsky']);
  });

  it('torikloud, larinovsky and ciarra have their own kits', () => {
    expect(getCharacter('torikloud').loadout).toEqual(['debate', 'sonic-boom', 'twins']);
    expect(getCharacter('ciarra').loadout).toEqual(['tattoo-gun', 'sew', 'marathon']);
    expect(getCharacter('ciarra').movement).toBe('hop');
    expect(getCharacter('larinovsky').loadout).toEqual(['pill-pusher', 'the-rizzler', 'take-a-nap', 'women-in-scam']);
    expect(loadoutSummary(getCharacter('larinovsky'))).toBe('Pill Pusher ×5 · the Rizzler ×3 · Take a Nap ×1 · Women in Scam ×1');
  });

  it('upcoming characters are shown but never playable (not in the roster, nor a valid pick anywhere)', () => {
    expect(UPCOMING.map((u) => u.name)).toEqual(['garyoldmancorp', 'shotdownboyz', 'kiwicore', 'odsey', 'lankcity', 'doctorfox']);
    for (const u of UPCOMING) {
      expect(isCharacterId(u.id)).toBe(false);
      expect(() => getCharacter(u.id)).toThrow();
      expect(upcoming(u.id)).toBe(u);
    }
    expect(upcoming('tones')).toBeUndefined();
  });

  it('uses 5 / 3 / 1 rounds for tiers 1-3, and 1 for a bonus move', () => {
    expect(AMMO_PER_TIER).toEqual([5, 3, 1, 1]);
  });

  it('every character has a valid three-tier loadout; a fourth slot is only ever a bonus move', () => {
    for (const c of ROSTER) {
      expect([3, 4]).toContain(c.loadout.length);
      for (const id of c.loadout) expect(() => getWeapon(id)).not.toThrow();
      c.loadout.forEach((id, tier) => expect(getWeapon(id).kind === 'scam').toBe(tier === 3));
    }
  });

  it("kie's loadout is Weasel Pop, Trollogram, Steal", () => {
    expect(getCharacter('kie').loadout).toEqual(['weasel-pop', 'trollogram', 'steal']);
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
    expect(loadoutSummary(getCharacter('kie'))).toBe('Weasel Pop ×5 · Trollogram ×3 · Steal ×1');
    expect(loadoutSummary(getCharacter('tones'))).toBe('ten-1 ×5 · ten-2 ×3 · ten-3 ×1');
  });
});

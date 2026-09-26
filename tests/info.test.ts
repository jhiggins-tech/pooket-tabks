import { describe, expect, it } from 'vitest';
import { getCharacter, ROSTER } from '../src/characters/roster';
import { movementInfo, weaponTags } from '../src/ui/info';
import { allWeapons, getWeapon } from '../src/weapons/registry';

describe('info screen content', () => {
  it('every weapon explains itself', () => {
    for (const w of allWeapons()) expect(w.info.length, w.id).toBeGreaterThan(40);
  });

  it("every character's loadout is covered", () => {
    for (const c of ROSTER) for (const id of c.loadout) expect(getWeapon(id).info).toBeTruthy();
  });

  it('tags show the tier, rounds and whether it needs aiming', () => {
    expect(weaponTags(getWeapon('shell'), 0)).toEqual(['Tier 1', '5 rounds', 'Aimed']);
    expect(weaponTags(getWeapon('marathon'), 2)).toEqual(['Tier 3', '1 round', 'No aiming']);
    expect(weaponTags(getWeapon('trollogram'), 2)).toContain('No aiming');
  });

  it('describes how each character moves', () => {
    expect(movementInfo(getCharacter('ciarra')).label).toBe('Frog hops');
    expect(movementInfo(getCharacter('tones')).label).toBe('Drives');
  });
});

import { describe, expect, it } from 'vitest';
import { AMMO_PER_TIER, assignColours, getCharacter, loadoutSummary, ROSTER } from '../src/characters/roster';
import { getWeapon, isBonus } from '../src/weapons/registry';
import { isCharacterId } from '../src/characters/roster';
import { upcoming, UPCOMING } from '../src/characters/upcoming';

describe('roster', () => {
  it('has the ten selectable characters (kiwicore and ShotDownBoyz in beta)', () => {
    expect(ROSTER.map((c) => c.name)).toEqual(['tones2', 'kie', 'kcaj', 'torikloud', 'ciarra', 'larinovsky', 'garyoldmancorp', 'kiwicore', 'doctorfox', 'shotdownboyz']);
    expect(ROSTER.filter((c) => c.beta).map((c) => c.id)).toEqual(['kiwicore', 'shotdownboyz']);
  });

  it("kiwicore's beta loadout: the béretta M2, Band Aid and a stand-in shot; he wears a flat cap", () => {
    expect(getCharacter('kiwicore').loadout).toEqual(['beretta-m2', 'band-aid', 'kiwi-bomb']);
    expect(getWeapon('beretta-m2').kind).toBe('boomerang');
    expect(getWeapon('band-aid').kind).toBe('drum');
    expect(getWeapon('kiwi-bomb').kind ?? 'ballistic').toBe('ballistic');
    expect(getCharacter('kiwicore').hat).toBe('flat-cap');
  });

  it("doctorfox's loadout: Calculated, Sly, Air Strike and Who's That Pokémon?", () => {
    expect(getCharacter('doctorfox').loadout).toEqual(['calculated', 'sly', 'air-strike', 'whos-that-pokemon']);
    expect(['calculated', 'sly', 'air-strike', 'whos-that-pokemon'].map((id) => getWeapon(id).kind ?? 'ballistic')).toEqual(['ballistic', 'sly', 'airstrike', 'pokemon']);
    expect(getCharacter('doctorfox').movement).toBe('arwing');
  });

  it("ShotDownBoyz's beta loadout has two stand-in shots, Prepper and an unlimited once-a-turn digger bonus", () => {
    const boyz = getCharacter('shotdownboyz');
    expect(boyz.loadout).toEqual(['digger-shot', 'digger-bomb', 'prepper', 'activate-digger']);
    expect(boyz.beta).toBe(true);
    expect(getWeapon('activate-digger').kind).toBe('digger');
  });

  it("garyoldmancorp's loadout (out of beta): Mr Bean, Hoop Dreamz, 007 and Diced Coffee", () => {
    expect(getCharacter('garyoldmancorp').loadout).toEqual(['mr-bean', 'hoop-dreamz', 'double-o-seven', 'diced-coffee']);
    expect(['mr-bean', 'hoop-dreamz', 'double-o-seven'].map((id) => getWeapon(id).kind ?? 'ballistic')).toEqual(['ballistic', 'hoop', 'bond']);
  });

  it('torikloud, larinovsky and ciarra have their own kits', () => {
    expect(getCharacter('torikloud').loadout).toEqual(['debate', 'sonic-boom', 'twins']);
    expect(getCharacter('ciarra').loadout).toEqual(['tattoo-gun', 'sew', 'marathon']);
    expect(getCharacter('ciarra').movement).toBe('hop');
    expect(getCharacter('larinovsky').loadout).toEqual(['pill-pusher', 'the-rizzler', 'take-a-nap', 'women-in-scam']);
    expect(loadoutSummary(getCharacter('larinovsky'))).toBe('Pill Pusher ×5 · the Rizzler ×3 · Take a Nap ×1 · Women in Scam ×1');
  });

  it('upcoming characters are shown but never playable (not in the roster, nor a valid pick anywhere)', () => {
    expect(UPCOMING.map((u) => u.name)).toEqual(['odsey', 'lankcity']);
    for (const u of UPCOMING) {
      expect(isCharacterId(u.id)).toBe(false);
      expect(() => getCharacter(u.id)).toThrow();
      expect(upcoming(u.id)).toBe(u);
    }
    expect(upcoming('tones')).toBeUndefined();
    // Teased moves (work in progress), by slot.
    expect(upcoming('garyoldmancorp')).toBeUndefined(); // playable now
    expect(upcoming('kiwicore')).toBeUndefined(); // playable in beta
    expect(upcoming('doctorfox')).toBeUndefined(); // playable
    expect(upcoming('shotdownboyz')).toBeUndefined(); // playable in beta
    expect(upcoming('lankcity')!.teasers!.map((t) => t.name)).toEqual(['HARD disk drive', 'lizard walk']);
    expect(upcoming('odsey')!.teasers).toBeUndefined();
  });

  it('uses 5 / 3 / 1 rounds for tiers 1-3, and 1 for a bonus move', () => {
    expect(AMMO_PER_TIER).toEqual([5, 3, 1, 1]);
  });

  it('every character has a valid three-tier loadout; a fourth slot is only ever a bonus move', () => {
    for (const c of ROSTER) {
      expect([3, 4]).toContain(c.loadout.length);
      for (const id of c.loadout) expect(() => getWeapon(id)).not.toThrow();
      c.loadout.forEach((id, tier) => expect(isBonus(getWeapon(id))).toBe(tier === 3));
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

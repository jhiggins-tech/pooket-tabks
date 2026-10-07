import { describe, expect, it } from 'vitest';
import { canFire, canUseSlot, currentPlayer, drive, fire, hasAmmo, selectTier, slotAt } from '../src/game/game';
import { FIXED_DT } from '../src/game/constants';
import { testGame } from './support/game';

/** The slot rules (game/loadout.ts): what each slot is, and that selectTier and fire follow them. */
describe('slots', () => {
  const match = (a: string, b: string) =>
    testGame({ players: [{ name: 'A', colour: '#fff', characterId: a }, { name: 'B', colour: '#000', characterId: b }], xs: [300, 700] });

  it('says what each slot is: shots, Steal (free), bonus moves, and a spent Twins with its twin out (Yolk Sucker)', () => {
    expect([0, 1, 2].map((t) => slotAt(match('kie', 'kcaj').players[0]!, t))).toEqual(['shot', 'shot', 'free']);
    expect(slotAt(match('larinovsky', 'kcaj').players[0]!, 3)).toBe('bonus');
    expect(slotAt(match('garyoldmancorp', 'kcaj').players[0]!, 3)).toBe('bonus');
    expect(slotAt(match('kie', 'kcaj').players[0]!, 9)).toBeNull();
    const g = match('torikloud', 'kcaj');
    const tori = currentPlayer(g);
    expect(selectTier(g, 2)).toBe(true);
    expect(fire(g)).toBe(true); // Twins
    expect(slotAt(tori, 2)).toBe('yolk');
  });

  it('selectTier takes exactly the slots canUseSlot allows', () => {
    const g = match('garyoldmancorp', 'kcaj');
    const p = currentPlayer(g);
    p.ammo[1] = 0;
    for (let tier = -1; tier <= p.loadout.length; tier++) {
      const usable = canUseSlot(g, p, tier);
      expect(selectTier(g, tier)).toBe(usable);
    }
  });

  it("canFire is false mid-hop, and fire then refuses; Diced Coffee alone doesn't keep a player in", () => {
    const g = match('ciarra', 'kcaj');
    const c = currentPlayer(g);
    expect(canFire(g)).toBe(true);
    drive(g, 1, FIXED_DT);
    expect(c.hop).not.toBeNull();
    expect(canFire(g)).toBe(false);
    expect(fire(g)).toBe(false);
    const gary = match('garyoldmancorp', 'kcaj').players[0]!;
    gary.ammo = gary.ammo.map((_, tier) => (tier === 3 ? 1 : 0));
    expect(hasAmmo(gary)).toBe(false);
  });
});

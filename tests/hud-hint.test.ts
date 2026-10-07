import { describe, expect, it } from 'vitest';
import { currentPlayer, DECOY_PICK_TIME, fire, hologramsOf, selectTier, toggleSwapTarget } from '../src/game/game';
import type { GameState } from '../src/game/state';
import { hintText } from '../src/render/hud/hint';
import { passTurn, testGame, untilNextTurn, whileFlying, untilAiming } from './support/game';

/** A hotseat match between `a` and `b` (character ids, also their names), `a` to play. */
function match(a: string, b = 'kcaj'): GameState {
  return testGame({ players: [a, b].map((id, i) => ({ name: id, colour: ['#ff5a5f', '#4ea8ff'][i]!, characterId: id })), xs: [200, 800] });
}

const local = { remote: false, syncing: false };
const hint = (g: GameState, view = local) => hintText(g, view);

describe('the hint line', () => {
  it('online, waiting for the result: syncing', () => {
    expect(hint(match('kcaj'), { remote: true, syncing: true })).toBe('Syncing…');
  });

  it("online, the other phone's turn: they're aiming, then firing", () => {
    const g = match('kcaj');
    expect(hint(g, { remote: true, syncing: false })).toBe('kcaj is aiming…');
    g.phase = 'flying';
    expect(hint(g, { remote: true, syncing: false })).toBe('kcaj is firing…');
  });

  it("online, once it's over: the usual hint", () => {
    const g = match('kcaj');
    g.phase = 'gameover';
    expect(hint(g, { remote: true, syncing: false })).toBe('Drag & pull back to aim');
  });

  it('nothing during the steal roulette or the coffee spinner', () => {
    const g = match('garyoldmancorp');
    selectTier(g, 3);
    g.phase = 'stealing';
    expect(hint(g)).toBe('');
    g.phase = 'coffee';
    expect(hint(g)).toBe('');
  });

  it('Diced Coffee selected: the odds', () => {
    const g = match('garyoldmancorp');
    selectTier(g, 3);
    expect(hint(g)).toBe('Diced Coffee: 10% full cream (ends your turn) · FIRE to spin');
  });

  it('just cast Trollogram: pick a decoy, then DONE', () => {
    const g = match('kie');
    selectTier(g, 1);
    fire(g);
    expect(hint(g)).toBe(`Tap a decoy to swap into it · DONE when ready (${Math.ceil(DECOY_PICK_TIME)})`);
    expect(toggleSwapTarget(g, hologramsOf(g, 0)[0]!.id)).toBe(true);
    expect(hint(g)).toBe(`Swapping into that decoy · DONE when ready (${Math.ceil(DECOY_PICK_TIME)})`);
  });

  it('ten-2 charging: the countdown', () => {
    const g = match('tones');
    selectTier(g, 1);
    fire(g);
    expect(hint(g)).toBe('ten-2 charging… 10');
  });

  it('a bonus move selected', () => {
    const g = match('larinovsky');
    selectTier(g, 3);
    expect(hint(g)).toBe('Bonus move: FIRE it, then take your turn');
  });

  it('Yolk Sucker selected: a bonus move too', () => {
    const g = match('torikloud');
    selectTier(g, 2);
    fire(g);
    whileFlying(g);
    untilAiming(g, 3);
    passTurn(g); // kcaj
    expect(currentPlayer(g).name).toBe('torikloud');
    g.players[0]!.twin!.hp -= 10; // health to even out
    selectTier(g, 2);
    expect(g.players[0]!.selectedTier).toBe(2);
    expect(hint(g)).toBe('Bonus move: FIRE it, then take your turn');
  });

  it('Twins selected: place the twin', () => {
    const g = match('torikloud');
    selectTier(g, 2);
    expect(hint(g)).toBe('Tap the ground to place your twin, then FIRE');
  });

  it('a weapon that needs no aiming', () => {
    const g = match('kie');
    selectTier(g, 2);
    expect(hint(g)).toBe('No aiming needed. Just FIRE');
  });

  it('with a twin out: either tank aims', () => {
    const g = match('torikloud');
    selectTier(g, 2);
    fire(g);
    whileFlying(g);
    untilAiming(g, 3);
    passTurn(g); // kcaj
    selectTier(g, 0);
    expect(hint(g)).toBe('Drag from a tank to aim it · 🎯 switches tank');
  });

  it('with decoys out: tap one to swap after firing', () => {
    const g = match('kie');
    selectTier(g, 1);
    fire(g);
    untilNextTurn(g);
    passTurn(g); // kcaj
    selectTier(g, 0);
    expect(hint(g)).toBe('Drag to aim · tap a decoy to swap after firing');
    toggleSwapTarget(g, hologramsOf(g, 0)[0]!.id);
    expect(hint(g)).toBe('Swapping to that decoy after you fire');
  });

  it('otherwise: drag to aim', () => {
    expect(hint(match('kcaj'))).toBe('Drag & pull back to aim');
  });
});

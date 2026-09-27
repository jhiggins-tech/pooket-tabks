import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/game/constants';
import { currentPlayer, drive, fire, heistIndex, isAimless, selectTier, STEAL_HOLD, STEAL_SPIN, step } from '../src/game/game';
import type { GameState } from '../src/game/state';
import { testGame } from './support/game';

function game(seed = 7, enemy = 'tones'): GameState {
  return testGame({
    seed,
    players: [
      { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
      { name: enemy, colour: '#ff5a5f', characterId: enemy },
    ],
  });
}

function run(g: GameState, seconds: number): void {
  for (let t = 0; t < seconds; t += FIXED_DT) step(g, FIXED_DT);
}

function steal(g: GameState): void {
  selectTier(g, 2);
  expect(fire(g)).toBe(true);
}

describe('Steal', () => {
  it("is kie's tier 3 and needs no aiming", () => {
    const g = game();
    expect(g.players[0]!.loadout[2]).toBe('steal');
    selectTier(g, 2);
    expect(isAimless(g)).toBe(true);
  });

  it('spins a roulette over the enemy weapons, quick at first and slowing down, before landing', () => {
    const g = game();
    steal(g);
    expect(g.phase).toBe('stealing');
    const h = g.heist!;
    expect(h.options).toEqual(['ten-1', 'ten-2', 'ten-3']);
    expect(h.sequence.at(-1)).toBe(h.victimTier);
    expect(new Set(h.sequence).size).toBe(3); // it goes all the way round
    const gaps = h.times.slice(1).map((t, i) => t - h.times[i]!);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeGreaterThan(gaps[i - 1]!);
    expect(h.times.at(-1)).toBeCloseTo(STEAL_SPIN);
    // The lit weapon changes as it spins.
    const lit = new Set<number>();
    for (let t = 0; t < STEAL_SPIN; t += FIXED_DT) {
      step(g, FIXED_DT);
      if (g.heist && !g.heist.locked) lit.add(heistIndex(g.heist));
    }
    expect(lit.size).toBe(3);
  });

  it('takes a round from the enemy; it replaces Steal and kie fires it the same turn', () => {
    const g = game();
    const [kie, tones] = g.players as [(typeof g.players)[0], (typeof g.players)[0]];
    steal(g);
    const { victimTier } = g.heist!;
    const stolen = tones.loadout[victimTier]!;
    const before = tones.ammo[victimTier]!;
    // Nobody can do anything while it spins.
    expect(fire(g)).toBe(false);
    expect(drive(g, 1, 0.5)).toBe(0);
    run(g, STEAL_SPIN + 0.05);
    expect(tones.ammo[victimTier]).toBe(before - 1);
    expect(kie.loadout[2]).toBe(stolen);
    expect(kie.ammo[2]).toBe(1);
    expect(kie.selectedTier).toBe(2);
    expect(g.phase).toBe('stealing'); // the result stays up for a moment
    run(g, STEAL_HOLD);
    expect(g.phase).toBe('aiming');
    expect(g.heist).toBeNull();
    expect(currentPlayer(g)).toBe(kie); // still kie's turn
    expect(fire(g)).toBe(true);
    expect(kie.ammo[2]).toBe(0);
    expect(kie.loadout[2]).toBe(stolen);
  });

  it('picks at random, reproducibly per seed', () => {
    const tiers = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      const a = game(seed);
      const b = game(seed);
      steal(a);
      steal(b);
      expect(a.heist!.victimTier).toBe(b.heist!.victimTier);
      tiers.add(a.heist!.victimTier);
    }
    expect(tiers.size).toBe(3);
  });

  it('only steals weapons with rounds left, and never a Steal', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const g = game(seed, 'kie');
      g.players[1]!.ammo = [0, 2, 1];
      steal(g);
      expect(g.heist!.victimTier).toBe(1);
    }
  });

  it("does nothing if there's nothing to steal", () => {
    const g = game();
    g.players[1]!.ammo = [0, 0, 0];
    selectTier(g, 2);
    expect(fire(g)).toBe(false);
    expect(g.phase).toBe('aiming');
    expect(g.players[0]!.ammo[2]).toBe(1);
  });

  it('a stolen weapon works for kie (ten-2 jetpacks kie away)', () => {
    const g = game();
    const kie = g.players[0]!;
    g.players[1]!.ammo = [0, 3, 0];
    steal(g);
    run(g, STEAL_SPIN + STEAL_HOLD + 0.05);
    expect(kie.loadout[2]).toBe('ten-2');
    fire(g);
    expect(g.jets[0]!.playerId).toBe(kie.id);
  });
});

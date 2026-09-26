import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { Terrain } from '../src/core/terrain';
import { FIXED_DT, MAX_HP, TANK_BODY_HEIGHT } from '../src/game/constants';
import { createGame, currentPlayer, fire, isSpewing, selectTier, setAim, step } from '../src/game/game';
import type { GameState } from '../src/game/state';
import { ten3 } from '../src/weapons/registry';

const players = [
  { name: 'tones', colour: '#ff5a5f', characterId: 'tones' },
  { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
];

/** tones on flat ground at x = 300, kie `gap` px to the right. */
function game(gap: number): GameState {
  const g = createGame({ seed: 30, players });
  const w = g.terrain.width;
  g.terrain = Terrain.fromHeights(new Float32Array(w).fill(400), w, g.terrain.height, createRng(1));
  const [tones, kie] = g.players as [(typeof g.players)[0], (typeof g.players)[0]];
  tones.x = 300;
  kie.x = 300 + gap;
  for (const p of g.players) p.y = 400;
  return g;
}

function spew(g: GameState, angle: number, power: number): void {
  selectTier(g, 2);
  setAim(g, angle, power);
  fire(g);
}

describe('ten-3', () => {
  it("is tones' tier 3, a one-shot gush", () => {
    const g = game(100);
    expect(g.players[0]!.loadout[2]).toBe('ten-3');
    spew(g, 20, 80);
    expect(isSpewing(g, 0)).toBe(true);
    expect(g.players[0]!.ammo[2]).toBe(0);
  });

  it('is short range: even at full power, nothing lands much beyond ~200px', () => {
    const g = game(900); // kie far away
    spew(g, 45, 100);
    let furthest = 0;
    for (let t = 0; t < 10 && g.phase === 'flying'; t += FIXED_DT) {
      step(g, FIXED_DT);
      for (const s of g.sludge) furthest = Math.max(furthest, s.x - 300);
    }
    expect(furthest).toBeGreaterThan(80);
    expect(furthest).toBeLessThan(230);
    expect(g.players[1]!.hp).toBe(MAX_HP);
  });

  it('point blank it does intense damage over time, all within the one turn, and never hurts tones', () => {
    const g = game(70);
    const [tones, kie] = g.players as [(typeof g.players)[0], (typeof g.players)[0]];
    spew(g, 25, 45);
    const hp: number[] = [];
    let spewEnded = -1;
    let t = 0;
    for (; t < 15 && g.phase === 'flying'; t += FIXED_DT) {
      step(g, FIXED_DT);
      if (spewEnded < 0 && !isSpewing(g, 0)) spewEnded = t;
      hp.push(kie.hp);
    }
    const dealt = MAX_HP - kie.hp;
    expect(dealt).toBeGreaterThan(35);
    expect(tones.hp).toBe(MAX_HP);
    // Over time: many separate hits, still landing after the gush has stopped.
    expect(new Set(hp).size).toBeGreaterThan(8);
    expect(hp.at(-1)!).toBeLessThan(hp[Math.round(spewEnded / FIXED_DT)]!);
    // ...and it's all over by the end of the turn.
    expect(kie.toxin).toBe(0);
    for (let s = 0; s < 3 && g.phase !== 'aiming'; s += FIXED_DT) step(g, FIXED_DT);
    expect(currentPlayer(g).name).toBe('kie');
    expect(kie.hp).toBe(100 - dealt);
  });

  it('chunks that miss pile up on the ground', () => {
    const g = game(900);
    const before = g.terrain.solid.reduce((n, v) => n + v, 0);
    spew(g, 30, 60);
    for (let t = 0; t < 10 && g.phase === 'flying'; t += FIXED_DT) step(g, FIXED_DT);
    expect(g.terrain.solid.reduce((n, v) => n + v, 0)).toBeGreaterThan(before + 100);
  });

  it('fans out around the aim', () => {
    const g = game(900);
    spew(g, 30, 60);
    for (let t = 0; t < 0.6; t += FIXED_DT) step(g, FIXED_DT);
    const angles = g.sludge.map((s) => (Math.atan2(-s.vy, s.vx) * 180) / Math.PI);
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(ten3.spew!.spreadDeg);
    expect(g.sludge.every((s) => s.y < 400 - TANK_BODY_HEIGHT + 20)).toBe(true);
  });
});

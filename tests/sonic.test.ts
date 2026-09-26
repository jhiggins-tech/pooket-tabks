import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { Terrain } from '../src/core/terrain';
import { FIXED_DT, MAX_HP } from '../src/game/constants';
import { createGame, currentPlayer, fire, selectTier, setAim, step } from '../src/game/game';
import type { GameState } from '../src/game/state';
import { sonicBoom } from '../src/weapons/registry';

const spec = sonicBoom.sonic!;
const players = [
  { name: 'torikloud', colour: '#a78bfa', characterId: 'torikloud' },
  { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
];

/** torikloud at x = 300 on flat ground; kie `gap` px to the right (negative = left). */
function game(gap: number, heights?: (x: number) => number): GameState {
  const g = createGame({ seed: 40, players });
  const w = g.terrain.width;
  g.terrain = Terrain.fromHeights(Float32Array.from({ length: w }, (_, x) => heights?.(x) ?? 400), w, g.terrain.height, createRng(1));
  const [tori, kie] = g.players as [(typeof g.players)[0], (typeof g.players)[0]];
  tori.x = 300;
  kie.x = 300 + gap;
  for (const p of g.players) p.y = 400;
  return g;
}

/** Fire Sonic Boom level along the ground at the given power; return kie's damage and hit count. */
function boom(g: GameState, angle = 0, power = 100): { dealt: number; hits: number } {
  selectTier(g, 1);
  setAim(g, angle, power);
  fire(g);
  let hits = 0;
  let last = g.players[1]!.hp;
  for (let t = 0; t < 10 && g.phase === 'flying'; t += FIXED_DT) {
    step(g, FIXED_DT);
    if (g.players[1]!.hp < last) hits++;
    last = g.players[1]!.hp;
  }
  return { dealt: MAX_HP - g.players[1]!.hp, hits };
}

describe('Sonic Boom', () => {
  it("is torikloud's tier 2", () => {
    expect(game(100).players[0]!.loadout[1]).toBe('sonic-boom');
  });

  it('hits in several waves', () => {
    const { dealt, hits } = boom(game(100));
    expect(hits).toBe(spec.waves);
    expect(dealt).toBeGreaterThan(0);
  });

  it('the further away the target, the less of the arc reaches them', () => {
    const near = boom(game(80)).dealt;
    const mid = boom(game(200)).dealt;
    const far = boom(game(420)).dealt;
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
  });

  it('travels through terrain, and leaves it untouched', () => {
    const wall = (x: number) => (x > 340 && x < 380 ? 150 : 400); // a tall ridge between them
    const g = game(160, wall);
    const before = g.terrain.solid.reduce((n, v) => n + v, 0);
    const { dealt } = boom(g);
    expect(dealt).toBeGreaterThan(0);
    expect(g.terrain.solid.reduce((n, v) => n + v, 0)).toBe(before);
  });

  it('only reaches along the barrel: nothing behind, nothing outside the arc', () => {
    expect(boom(game(-150), 0).dealt).toBe(0); // kie behind
    expect(boom(game(150), 90).dealt).toBe(0); // fired straight up
  });

  it('power sets the reach', () => {
    expect(boom(game(400), 0, 100).dealt).toBeGreaterThan(0);
    expect(boom(game(400), 0, 20).dealt).toBe(0);
  });

  it('never hurts torikloud, and the turn passes', () => {
    const g = game(100);
    boom(g);
    expect(g.players[0]!.hp).toBe(MAX_HP);
    for (let t = 0; t < 3 && g.phase !== 'aiming'; t += FIXED_DT) step(g, FIXED_DT);
    expect(currentPlayer(g).name).toBe('kie');
  });

  it('a kookaburra appears in the sky above the tank when it fires', () => {
    const g = game(100);
    selectTier(g, 1);
    fire(g);
    expect(g.apparitions).toHaveLength(1);
    expect(g.apparitions[0]!.kind).toBe('kookaburra');
    expect(g.apparitions[0]!.y).toBeLessThan(g.players[0]!.y - 60);
    expect(Math.abs(g.apparitions[0]!.x - g.players[0]!.x)).toBeLessThan(2);
  });
});

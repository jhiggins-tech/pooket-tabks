import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { Terrain } from '../src/core/terrain';
import { FIXED_DT, MAX_HP, TANK_BODY_HEIGHT } from '../src/game/constants';
import {
  createGame,
  currentPlayer,
  explode,
  fire,
  hologramAt,
  hologramsOf,
  isAimless,
  selectTier,
  setAim,
  step,
  targetAt,
  toggleSwapTarget,
} from '../src/game/game';
import type { GameState } from '../src/game/state';
import { hyperfixate, shell, trollogram } from '../src/weapons/registry';

const players = [
  { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
  { name: 'kcaj', colour: '#ffc53d', characterId: 'kcaj' },
];

function flatGame(seed = 3): GameState {
  const g = createGame({ seed, players });
  const w = g.terrain.width;
  g.terrain = Terrain.fromHeights(new Float32Array(w).fill(400), w, g.terrain.height, createRng(1));
  for (const p of g.players) p.y = 400;
  return g;
}

/** Resolve whatever is in flight and move to the next turn. */
function finishTurn(g: GameState): void {
  const turn = g.turn;
  for (let t = 0; t < 30 && g.turn === turn && g.phase !== 'gameover'; t += FIXED_DT) step(g, FIXED_DT);
}

/** End the current turn without firing. */
function passTurn(g: GameState): void {
  g.phase = 'settling';
  g.settleTimer = 0;
  step(g, FIXED_DT);
}

/** kie fires Trollogram, kcaj passes, and it's kie's turn again with two decoys out. */
function withDecoys(): GameState {
  const g = flatGame();
  selectTier(g, 2);
  fire(g);
  finishTurn(g);
  passTurn(g); // kcaj
  expect(currentPlayer(g).name).toBe('kie');
  return g;
}

describe('Trollogram', () => {
  it("is kie's tier 3 and needs no aiming", () => {
    const g = flatGame();
    expect(g.players[0]!.loadout[2]).toBe(trollogram.id);
    selectTier(g, 2);
    expect(isAimless(g)).toBe(true);
  });

  it('spawns two holograms on the ground, spread out from every tank', () => {
    const g = flatGame();
    selectTier(g, 2);
    fire(g);
    const holos = hologramsOf(g, 0);
    expect(holos).toHaveLength(2);
    const xs = [...g.players.map((p) => p.x), ...holos.map((h) => h.x)];
    for (let i = 0; i < xs.length; i++) {
      for (let j = i + 1; j < xs.length; j++) expect(Math.abs(xs[i]! - xs[j]!)).toBeGreaterThanOrEqual(70);
    }
    for (const h of holos) expect(h.y).toBe(g.terrain.surfaceY(h.x));
    finishTurn(g);
    expect(currentPlayer(g).name).toBe('kcaj');
  });

  it('holograms are hit like real tanks', () => {
    const g = withDecoys();
    const h = hologramsOf(g, 0)[0]!;
    expect(targetAt(g, h.x, h.y - TANK_BODY_HEIGHT)).toEqual({ kind: 'hologram', holo: h });
  });

  it('unhit holograms stay out turn after turn', () => {
    const g = withDecoys();
    passTurn(g); // kie
    passTurn(g); // kcaj
    passTurn(g); // kie
    expect(hologramsOf(g, 0)).toHaveLength(2);
  });

  it('kie can pick a hologram on his turn; the swap happens only once his shot has landed', () => {
    const g = withDecoys();
    const kie = g.players[0]!;
    const h = hologramsOf(g, 0)[1]!;
    const before = { tank: { x: kie.x, y: kie.y }, holo: { x: h.x, y: h.y } };

    expect(hologramAt(g, h.x + 5, h.y - 10, 20)).toBe(h);
    expect(toggleSwapTarget(g, h.id)).toBe(true);
    expect(g.swapTargetId).toBe(h.id);

    selectTier(g, 0);
    setAim(g, 180, 100); // straight off the left edge of the flat map
    fire(g);
    // Mid-turn: nothing has moved yet, and the pick can't be changed any more.
    step(g, FIXED_DT);
    expect({ x: kie.x, y: kie.y }).toEqual(before.tank);
    expect(toggleSwapTarget(g, h.id)).toBe(false);

    finishTurn(g);
    expect({ x: kie.x, y: kie.y }).toEqual(before.holo);
    expect({ x: h.x, y: h.y }).toEqual(before.tank);
    expect(g.swapTargetId).toBeNull();
  });

  it('tapping the chosen hologram again cancels the swap', () => {
    const g = withDecoys();
    const kie = g.players[0]!;
    const x0 = kie.x;
    const h = hologramsOf(g, 0)[0]!;
    toggleSwapTarget(g, h.id);
    toggleSwapTarget(g, h.id);
    expect(g.swapTargetId).toBeNull();
    passTurn(g);
    expect(kie.x).toBe(x0);
  });

  it("the opponent can't pick kie's holograms", () => {
    const g = flatGame();
    selectTier(g, 2);
    fire(g);
    finishTurn(g);
    expect(currentPlayer(g).name).toBe('kcaj');
    const h = hologramsOf(g, 0)[0]!;
    expect(hologramAt(g, h.x, h.y - 8, 20)).toBeUndefined();
    expect(toggleSwapTarget(g, h.id)).toBe(false);
  });

  it('hitting a hologram shows the damage, then costs the shooter half of it and exposes the hologram at turn end', () => {
    const g = withDecoys();
    passTurn(g); // kie
    const [kie, kcaj] = g.players as [(typeof g.players)[0], (typeof g.players)[0]];
    const h = hologramsOf(g, 0)[0]!;

    // kcaj lands a direct Heavy-style hit on the hologram.
    fire(g);
    g.projectiles = [];
    explode(g, h.x, h.y - TANK_BODY_HEIGHT, shell, kcaj.id);
    expect(g.floaters.at(-1)!.text).toBe(`-${shell.damage}`); // looks like a real hit
    expect(kcaj.hp).toBe(MAX_HP); // nothing is revealed mid-turn
    expect(hologramsOf(g, 0)).toContain(h);

    finishTurn(g);
    expect(kcaj.hp).toBe(MAX_HP - Math.round(shell.damage * 0.5));
    expect(kie.hp).toBe(MAX_HP);
    expect(hologramsOf(g, 0)).not.toContain(h);
    expect(hologramsOf(g, 0)).toHaveLength(1);
  });

  it('a blast that catches the real tank and a hologram hurts the tank and still penalises the shooter', () => {
    const g = withDecoys();
    passTurn(g); // kie
    const [kie, kcaj] = g.players as [(typeof g.players)[0], (typeof g.players)[0]];
    const h = hologramsOf(g, 0)[0]!;
    h.x = kie.x + 30; // park a hologram right next to kie
    fire(g);
    g.projectiles = [];
    explode(g, kie.x + 15, kie.y - TANK_BODY_HEIGHT, shell, kcaj.id);
    finishTurn(g);
    expect(kie.hp).toBeLessThan(MAX_HP);
    expect(kcaj.hp).toBeLessThan(MAX_HP);
  });

  it('a Hyperfixate beam into a hologram: half the impact as a penalty, and nobody burns', () => {
    const g = withDecoys();
    passTurn(g); // kie
    const [kie, kcaj] = g.players as [(typeof g.players)[0], (typeof g.players)[0]];
    // Line kcaj up level with a hologram and zap it.
    const h = hologramsOf(g, 0)[0]!;
    h.x = kcaj.x - 150;
    h.y = kcaj.y;
    kie.x = 20;
    selectTier(g, 1);
    setAim(g, 180, 50);
    fire(g);
    expect(g.beams[0]!.hitTank).toBe(true);
    finishTurn(g);
    expect(kcaj.hp).toBe(MAX_HP - Math.round(hyperfixate.damage * 0.5));
    expect(kcaj.burn).toBeNull();
    expect(kie.burn).toBeNull();
    expect(kie.hp).toBe(MAX_HP);
  });

  it("a swap to a hologram that got hit this turn doesn't happen", () => {
    const g = withDecoys();
    const kie = g.players[0]!;
    const x0 = kie.x;
    const h = hologramsOf(g, 0)[0]!;
    toggleSwapTarget(g, h.id);
    fire(g);
    g.projectiles = [];
    explode(g, h.x, h.y - TANK_BODY_HEIGHT, shell, kie.id); // kie shoots his own decoy
    finishTurn(g);
    expect(kie.x).toBe(x0);
    expect(kie.hp).toBe(MAX_HP - Math.round(shell.damage * 0.5)); // same penalty applies to kie
  });
});

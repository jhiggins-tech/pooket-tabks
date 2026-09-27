/** Shared scaffolding for game tests: matches on made-to-order ground, and ways to move a turn along. */
import { createRng } from '../../src/core/rng';
import { Terrain } from '../../src/core/terrain';
import { FIXED_DT } from '../../src/game/constants';
import { createGame, drive, step } from '../../src/game/game';
import type { GameState, PlayerConfig } from '../../src/game/state';

/** The ground level of a flat test map. */
export const FLAT_Y = 400;

/**
 * A match on made-to-order ground: `heights(x)` is the surface (flat at FLAT_Y by default), tanks at `xs`
 * (by index; default: where they spawned), resting on the ground.
 */
export function testGame(opts: { players: PlayerConfig[]; seed?: number; heights?: (x: number) => number; xs?: number[] }): GameState {
  const g = createGame({ seed: opts.seed ?? 1, players: opts.players });
  const w = g.terrain.width;
  g.terrain = Terrain.fromHeights(Float32Array.from({ length: w }, (_, x) => opts.heights?.(x) ?? FLAT_Y), w, g.terrain.height, createRng(1));
  g.players.forEach((p, i) => {
    p.x = opts.xs?.[i] ?? p.x;
    p.y = g.terrain.surfaceY(p.x);
  });
  return g;
}

/** Step until the shot in flight has played out (the turn then settles). */
export function whileFlying(g: GameState, onTick?: (g: GameState) => void): void {
  for (let t = 0; t < 20 && g.phase === 'flying'; t += FIXED_DT) {
    step(g, FIXED_DT);
    onTick?.(g);
  }
}

/** Step until it's someone's turn to aim again (or the game is over). */
export function untilAiming(g: GameState, onTick?: (g: GameState) => void): void {
  for (let t = 0; t < 30 && g.phase !== 'aiming' && g.phase !== 'gameover'; t += FIXED_DT) {
    step(g, FIXED_DT);
    onTick?.(g);
  }
}

/** Step until the turn has moved on (or the game is over). */
export function untilNextTurn(g: GameState): void {
  const turn = g.turn;
  for (let t = 0; t < 30 && g.turn === turn && g.phase !== 'gameover'; t += FIXED_DT) step(g, FIXED_DT);
}

/** Step for a while. */
export function run(g: GameState, seconds: number): void {
  for (let t = 0; t < seconds; t += FIXED_DT) step(g, FIXED_DT);
}

/** End the current turn without firing. */
export function passTurn(g: GameState): void {
  g.phase = 'settling';
  g.settleTimer = 0;
  step(g, FIXED_DT);
}

/** Hold ◀ (−1) or ▶ (+1) for a while. */
export function hold(g: GameState, dir: number, seconds: number): void {
  for (let t = 0; t < seconds; t += FIXED_DT) drive(g, dir, FIXED_DT);
}

import { describe, expect, it } from 'vitest';
import { createRng, randRange } from '../src/core/rng';
import { Terrain } from '../src/core/terrain';
import { FIXED_DT, TANK_BODY_HEIGHT } from '../src/game/constants';
import { createGame, drive, explode } from '../src/game/game';
import type { GameState } from '../src/game/state';
import { getWeapon, marathon, shell } from '../src/weapons/registry';

function cratered(characterId: string, radius: number, depthAbove: number): GameState {
  const g = createGame({
    seed: 50,
    players: [
      { name: 'a', colour: '#f00', characterId },
      { name: 'b', colour: '#00f', characterId: 'kie' },
    ],
  });
  const w = g.terrain.width;
  g.terrain = Terrain.fromHeights(new Float32Array(w).fill(400), w, g.terrain.height, createRng(1));
  const [a, b] = g.players;
  a!.x = 400;
  b!.x = 900;
  b!.y = 400;
  g.terrain.carveCircle(400, 400 - depthAbove, radius);
  a!.y = g.terrain.surfaceY(400);
  return g;
}

function escapes(g: GameState, dir: number): boolean {
  const a = g.players[0]!;
  for (let t = 0; t < 12 && (a.hop || a.y > 400); t += FIXED_DT) drive(g, dir, FIXED_DT);
  return !a.hop && a.y <= 400;
}

describe('driving out of craters', () => {
  it('still stops at a tall steep hill', () => {
    const g = cratered('tones', 0, 0);
    const w = g.terrain.width;
    g.terrain = Terrain.fromHeights(Float32Array.from({ length: w }, (_, x) => (x >= 420 ? Math.max(300, 400 - (x - 420) * 1.8) : 400)), w, g.terrain.height, createRng(1));
    const a = g.players[0]!;
    a.y = 400;
    for (let t = 0; t < 4; t += FIXED_DT) drive(g, 1, FIXED_DT);
    expect(a.y).toBeGreaterThan(395);
  });

  it('scrambles up a short steep bank', () => {
    const g = cratered('tones', 0, 0);
    const w = g.terrain.width;
    g.terrain = Terrain.fromHeights(Float32Array.from({ length: w }, (_, x) => (x >= 420 ? Math.max(380, 400 - (x - 420) * 2.5) : 400)), w, g.terrain.height, createRng(1));
    const a = g.players[0]!;
    a.y = 400;
    for (let t = 0; t < 4; t += FIXED_DT) drive(g, 1, FIXED_DT);
    expect(a.y).toBe(380);
  });

  // The Marathon finish goes off at the tank's centre: a 30px bowl dug ~22px deep with steep upper walls.
  const finish = { radius: marathon.runner!.radius, above: TANK_BODY_HEIGHT };

  it('drives away from a crater wall its hull is overlapping (sunk against a steep side)', () => {
    for (const dir of [1, -1]) {
      const g = cratered('tones', 0, 0);
      const w = g.terrain.width;
      // A tall steep wall whose foot is under the tank's left (or right) edge.
      const wallSide = -dir;
      g.terrain = Terrain.fromHeights(Float32Array.from({ length: w }, (_, x) => ((x - 400) * wallSide > 8 ? 330 : 400)), w, g.terrain.height, createRng(1));
      const a = g.players[0]!;
      a.x = 400;
      a.y = 400;
      for (let t = 0; t < 1.5; t += FIXED_DT) drive(g, dir, FIXED_DT);
      expect(Math.abs(a.x - 400), `dir ${dir}`).toBeGreaterThan(30);
      expect(a.y).toBe(400);
    }
  });

  it('can drive under an overhang that clears the hull', () => {
    const g = cratered('tones', 0, 0);
    // Carve a tunnel-ish scoop: an overhanging lip above the tank's path.
    for (let x = 420; x < 470; x += 2) g.terrain.carveCircle(x, 392, 9);
    const w = g.terrain.width;
    const solid = g.terrain.solid;
    for (let x = 430; x < 460; x++) for (let y = 370; y < 378; y++) solid[y * w + x] = 1; // a ledge overhead
    const a = g.players[0]!;
    a.y = 400;
    for (let t = 0; t < 1; t += FIXED_DT) drive(g, 1, FIXED_DT);
    expect(a.x).toBeGreaterThan(420);
  });

  for (const who of ['tones', 'ciarra']) {
    it(`${who} can get out of a Marathon crater either way`, () => {
      for (const dir of [1, -1]) {
        const g = cratered(who, finish.radius, finish.above);
        expect(g.players[0]!.y).toBeGreaterThan(415);
        expect(escapes(g, dir), `dir ${dir}`).toBe(true);
      }
    });

    it(`${who} can get out of a shell crater`, () => {
      const g = cratered(who, shell.blastRadius, 0);
      expect(escapes(g, 1)).toBe(true);
    });
  }

  it('never leaves a tank stuck in a pile of overlapping craters on real maps', { timeout: 60_000 }, () => {
    for (const who of ['tones', 'ciarra']) {
      for (let seed = 1; seed <= 30; seed++) {
        const moved = [1, -1].map((dir) => {
          const g = createGame({ seed, players: [{ name: 'a', colour: '#f00', characterId: who }, { name: 'b', colour: '#00f', characterId: 'kie' }] });
          const a = g.players[0]!;
          const rng = createRng(seed * 7);
          for (let k = 0; k < 6; k++) explode(g, a.x + randRange(rng, -40, 40), a.y + randRange(rng, -20, 10), getWeapon(k % 2 ? 'shell' : 'marathon'));
          Object.assign(a, { hp: 100, alive: true });
          g.phase = 'aiming';
          const x0 = a.x;
          for (let t = 0; t < 3; t += FIXED_DT) drive(g, dir, FIXED_DT);
          return Math.abs(a.x - x0);
        });
        expect(Math.max(...moved), `${who} seed ${seed}`).toBeGreaterThan(12);
      }
    }
  });
});

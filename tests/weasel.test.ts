import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { Terrain } from '../src/core/terrain';
import { FIXED_DT, MAX_HP } from '../src/game/constants';
import { createGame, fire, selectTier, setAim, step } from '../src/game/game';
import type { GameState, Projectile } from '../src/game/state';
import { weaselPop } from '../src/weapons/registry';

const walk = weaselPop.walk!;
const players = [
  { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
  { name: 'tones', colour: '#ff5a5f', characterId: 'tones' },
];

/** kie vs tones over custom ground (default: flat at y = 400). */
function game(heights?: (x: number) => number): GameState {
  const g = createGame({ seed: 21, players });
  const w = g.terrain.width;
  g.terrain = Terrain.fromHeights(Float32Array.from({ length: w }, (_, x) => heights?.(x) ?? 400), w, g.terrain.height, createRng(1));
  for (const p of g.players) p.y = g.terrain.surfaceY(p.x);
  return g;
}

/** Drop a single weasel owned by kie at x, just above the ground. */
function dropWeasel(g: GameState, x: number, y = 380): Projectile {
  selectTier(g, 1);
  fire(g);
  const w = g.projectiles[0]!;
  Object.assign(w, { x, y, vx: 0, vy: 0 });
  g.projectiles = [w];
  return w;
}

function tick(g: GameState, seconds: number, each?: () => void): void {
  for (let t = 0; t < seconds && g.phase === 'flying'; t += FIXED_DT) {
    step(g, FIXED_DT);
    each?.();
  }
}

describe('Weasel Pop', () => {
  it("is kie's tier 2", () => {
    expect(game().players[0]!.loadout[1]).toBe('weasel-pop');
  });

  it('launches three spinning weasels at aim −4° / 0° / +4°', () => {
    const g = game();
    selectTier(g, 1);
    setAim(g, 50, 60);
    fire(g);
    expect(g.projectiles).toHaveLength(3);
    const angles = g.projectiles.map((p) => Math.round((Math.atan2(-p.vy, p.vx) * 180) / Math.PI));
    expect(angles).toEqual([46, 50, 54]);
    expect(weaselPop.spin).toBeGreaterThan(0);
    expect(g.players[0]!.ammo[1]).toBe(2);
  });

  it('lands, walks a short way towards the enemy, then pops when time runs out', () => {
    const g = game();
    const [kie, tones] = g.players as [(typeof g.players)[0], (typeof g.players)[0]];
    const x0 = kie.x + 150; // well short of tones, who is to the right
    expect(tones.x).toBeGreaterThan(x0 + walk.speed * walk.duration + 40);
    const w = dropWeasel(g, x0);
    const before = g.terrain.solid.reduce((n, v) => n + v, 0);
    let walkedTo = x0;
    tick(g, 1);
    expect(w.walkDir).toBe(1);
    tick(g, 10, () => g.projectiles.includes(w) && (walkedTo = w.x));
    expect(g.projectiles).toHaveLength(0);
    expect(walkedTo - x0).toBeGreaterThan(walk.speed * walk.duration * 0.8);
    expect(walkedTo - x0).toBeLessThan(walk.speed * walk.duration * 1.1);
    expect(g.terrain.solid.reduce((n, v) => n + v, 0)).toBeLessThan(before); // it popped
    expect(tones.hp).toBe(MAX_HP);
  });

  it('turns to walk towards the enemy when it lands past them', () => {
    const g = game();
    const tones = g.players[1]!;
    const w = dropWeasel(g, tones.x + 60);
    tick(g, 1);
    expect(w.walkDir).toBe(-1);
  });

  it('pops on contact when it walks into the enemy', () => {
    const g = game();
    const tones = g.players[1]!;
    dropWeasel(g, tones.x - 40);
    tick(g, walk.duration * 0.9);
    expect(g.projectiles).toHaveLength(0);
    expect(tones.hp).toBeLessThan(MAX_HP);
  });

  it('climbs small steps', () => {
    const step = 700;
    const g = game((x) => (x >= step ? 396 : 400)); // a 4px ledge
    const w = dropWeasel(g, step - 30);
    let maxX = 0;
    tick(g, walk.duration - 0.1, () => (maxX = Math.max(maxX, w.x)));
    expect(maxX).toBeGreaterThan(step + 20);
  });

  it("is stopped by a wall it can't climb", () => {
    const wall = 700;
    const g = game((x) => (x >= wall ? 300 : 400));
    const w = dropWeasel(g, wall - 30);
    let maxX = 0;
    tick(g, walk.duration - 0.1, () => (maxX = Math.max(maxX, w.x)));
    expect(maxX).toBeLessThan(wall);
  });

  it('tumbles off a ledge, lands and keeps walking', () => {
    const edge = 600;
    const g = game((x) => (x >= edge ? 440 : 400)); // a 40px drop
    const w = dropWeasel(g, edge - 20);
    let fell = false;
    let maxX = 0;
    tick(g, walk.duration + 1, () => {
      if (g.projectiles.includes(w)) {
        if (w.walkDir === 0 && w.x > edge) fell = true;
        maxX = Math.max(maxX, w.x);
      }
    });
    expect(fell).toBe(true);
    expect(maxX).toBeGreaterThan(edge + 30);
  });

  it('a weasel that lands straight on a tank pops immediately', () => {
    const g = game();
    const tones = g.players[1]!;
    dropWeasel(g, tones.x, tones.y - 40);
    tick(g, 0.5);
    expect(g.projectiles).toHaveLength(0);
    expect(tones.hp).toBeLessThan(MAX_HP);
  });
});

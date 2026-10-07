import { describe, expect, it } from 'vitest';
import { MAX_HP } from '../src/game/constants';
import { fire, selectTier, setAim } from '../src/game/game';
import type { GameState, Projectile } from '../src/game/state';
import { weaselPop } from '../src/characters/kits';
import { testGame, whileFlying } from './support/game';

const walk = weaselPop.walk!;
const players = [
  { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
  { name: 'tones', colour: '#ff5a5f', characterId: 'tones' },
];

function game(heights?: (x: number) => number): GameState {
  return testGame({ seed: 21, players, heights });
}

/** Drop a single weasel owned by kie at x, just above the ground. */
function dropWeasel(g: GameState, x: number, y = 380): Projectile {
  selectTier(g, 0);
  fire(g);
  const w = g.projectiles[0]!;
  Object.assign(w, { x, y, vx: 0, vy: 0 });
  g.projectiles = [w];
  return w;
}

describe('Weasel Pop', () => {
  it("is kie's tier 1", () => {
    expect(game().players[0]!.loadout[0]).toBe('weasel-pop');
  });

  it('launches three spinning weasels at aim −4° / 0° / +4°', () => {
    const g = game();
    selectTier(g, 0);
    setAim(g, 50, 60);
    fire(g);
    expect(g.projectiles).toHaveLength(3);
    const angles = g.projectiles.map((p) => Math.round((Math.atan2(-p.vy, p.vx) * 180) / Math.PI));
    expect(angles).toEqual([46, 50, 54]);
    expect(weaselPop.spin).toBeGreaterThan(0);
    expect(g.players[0]!.ammo[0]).toBe(4);
  });

  it('lands, walks a short way towards the enemy, then pops when time runs out', () => {
    const g = game();
    const [kie, tones] = g.players as [(typeof g.players)[0], (typeof g.players)[0]];
    const x0 = kie.x + 150; // well short of tones, who is to the right
    expect(tones.x).toBeGreaterThan(x0 + walk.speed * walk.duration + 40);
    const w = dropWeasel(g, x0);
    const before = g.terrain.solid.reduce((n, v) => n + v, 0);
    let walkedTo = x0;
    whileFlying(g, 1);
    expect(w.walkDir).toBe(1);
    whileFlying(g, 10, () => g.projectiles.includes(w) && (walkedTo = w.x));
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
    whileFlying(g, 1);
    expect(w.walkDir).toBe(-1);
  });

  it('scurries right up under the enemy and pops there, for (nearly) full damage', () => {
    for (const side of [-1, 1]) {
      const g = game();
      const tones = g.players[1]!;
      const w = dropWeasel(g, tones.x + side * 40);
      let poppedAt = NaN;
      whileFlying(g, walk.duration * 0.9, () => {
        if (g.projectiles.includes(w)) poppedAt = w.x;
      });
      expect(g.projectiles).toHaveLength(0);
      expect(Math.abs(poppedAt - tones.x)).toBeLessThanOrEqual(walk.fuse + 1);
      expect(MAX_HP - tones.hp).toBeGreaterThanOrEqual(weaselPop.damage - 2);
    }
  });

  it("doesn't wait to touch the tank: stopped short within blast range, it pops right away", () => {
    // tones sits up on a ledge; the weasel is stopped by the wall at its foot, just in range.
    const ledge = 790;
    const g = game((x) => (x >= ledge ? 385 : 400));
    const tones = g.players[1]!;
    tones.x = ledge + 14;
    tones.y = g.terrain.surfaceY(tones.x);
    const w = dropWeasel(g, ledge - 40);
    let walked = 0;
    whileFlying(g, walk.duration, () => {
      if (g.projectiles.includes(w)) walked = w.walkTime;
    });
    expect(g.projectiles).toHaveLength(0);
    expect(walked).toBeLessThan(walk.duration * 0.6); // long before its timer ran out
    expect(tones.hp).toBeLessThan(MAX_HP);
  });

  it("pops at the foot of a pillar it can't climb: the closest it can get", () => {
    // tones is on a narrow pillar too tall for the weasel to climb.
    const g = game((x) => (x >= 795 && x <= 815 ? 380 : 400));
    const tones = g.players[1]!;
    tones.x = 805;
    tones.y = 380;
    const w = dropWeasel(g, 760);
    let last = 0;
    whileFlying(g, walk.duration, () => {
      if (g.projectiles.includes(w)) last = w.x;
    });
    expect(g.projectiles).toHaveLength(0);
    expect(last).toBeLessThan(795); // it popped at the foot of the pillar, closest it could get
    expect(tones.hp).toBeLessThan(MAX_HP);
  });

  it('climbs small steps', () => {
    const step = 700;
    const g = game((x) => (x >= step ? 396 : 400)); // a 4px ledge
    const w = dropWeasel(g, step - 30);
    let maxX = 0;
    whileFlying(g, walk.duration - 0.1, () => (maxX = Math.max(maxX, w.x)));
    expect(maxX).toBeGreaterThan(step + 20);
  });

  it("is stopped by a wall it can't climb", () => {
    const wall = 700;
    const g = game((x) => (x >= wall ? 300 : 400));
    const w = dropWeasel(g, wall - 30);
    let maxX = 0;
    whileFlying(g, walk.duration - 0.1, () => (maxX = Math.max(maxX, w.x)));
    expect(maxX).toBeLessThan(wall);
  });

  it('tumbles off a ledge, lands and keeps walking', () => {
    const edge = 600;
    const g = game((x) => (x >= edge ? 440 : 400)); // a 40px drop
    const w = dropWeasel(g, edge - 20);
    let fell = false;
    let maxX = 0;
    whileFlying(g, walk.duration + 1, () => {
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
    whileFlying(g, 0.5);
    expect(g.projectiles).toHaveLength(0);
    expect(tones.hp).toBeLessThan(MAX_HP);
  });
});

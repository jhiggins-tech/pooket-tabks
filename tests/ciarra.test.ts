import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { Terrain } from '../src/core/terrain';
import { FIXED_DT, MAX_HP, TANK_BODY_HEIGHT } from '../src/game/constants';
import {
  createGame,
  currentPlayer,
  drive,
  explode,
  fire,
  HOP_DISTANCE,
  isAimless,
  selectTier,
  setAim,
  step,
} from '../src/game/game';
import type { GameState } from '../src/game/state';
import { marathon, sew, shell, tattooGun } from '../src/weapons/registry';

const players = [
  { name: 'ciarra', colour: '#f472b6', characterId: 'ciarra' },
  { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
];

/** ciarra at x = 300, kie at 700, over custom ground (flat at 400 by default). */
function game(heights?: (x: number) => number): GameState {
  const g = createGame({ seed: 80, players });
  const w = g.terrain.width;
  g.terrain = Terrain.fromHeights(Float32Array.from({ length: w }, (_, x) => heights?.(x) ?? 400), w, g.terrain.height, createRng(1));
  g.players[0]!.x = 300;
  g.players[1]!.x = 700;
  for (const p of g.players) p.y = g.terrain.surfaceY(p.x);
  return g;
}

function resolve(g: GameState): void {
  for (let t = 0; t < 20 && g.phase === 'flying'; t += FIXED_DT) step(g, FIXED_DT);
}

function pass(g: GameState): void {
  g.phase = 'settling';
  g.settleTimer = 0;
  step(g, FIXED_DT);
}

function hold(g: GameState, dir: number, seconds: number): void {
  for (let t = 0; t < seconds; t += FIXED_DT) drive(g, dir, FIXED_DT);
}

describe('Tattoo Gun', () => {
  it('buzzes out a stream of ink needles for one round', () => {
    const g = game();
    selectTier(g, 0);
    setAim(g, 40, 60);
    fire(g);
    const seen = new Set<object>();
    for (let t = 0; t < 10 && g.phase === 'flying'; t += FIXED_DT) {
      step(g, FIXED_DT);
      g.projectiles.forEach((p) => seen.add(p));
    }
    expect(seen.size).toBe(tattooGun.burst!.count);
    expect(g.players[0]!.ammo[0]).toBe(4);
  });

  it('tattoos what it hits: +25% damage from everything until it has had two more turns', () => {
    const g = game();
    const kie = g.players[1]!;
    fire(g);
    g.bursts = [];
    explode(g, kie.x, kie.y - TANK_BODY_HEIGHT, tattooGun, 0);
    expect(kie.tattoo).toEqual({ multiplier: 1.25, turnsLeft: 2 });
    expect(g.floaters.some((f) => f.text === 'TATTOOED')).toBe(true);
    let hp = kie.hp;
    explode(g, kie.x, kie.y - TANK_BODY_HEIGHT, shell, 0);
    expect(hp - kie.hp).toBe(Math.round(shell.damage * 1.25));
    resolve(g);
    pass(g); // kie's turn 1
    pass(g); // ciarra
    expect(kie.tattoo?.turnsLeft).toBe(1);
    pass(g); // kie's turn 2
    pass(g); // ciarra
    expect(kie.tattoo).toBeNull();
    kie.hp = MAX_HP;
    hp = kie.hp;
    explode(g, kie.x, kie.y - TANK_BODY_HEIGHT, shell, 0);
    expect(hp - kie.hp).toBe(shell.damage);
  });
});

describe('Sew', () => {
  function sewAt(g: GameState, angle: number, power: number): void {
    selectTier(g, 1);
    setAim(g, angle, power);
    fire(g);
    resolve(g);
  }

  it('stitches straight through terrain, damaging and pinning the enemy', () => {
    const g = game((x) => (x > 450 && x < 500 ? 300 : 400)); // a ridge in the way
    const kie = g.players[1]!;
    const before = g.terrain.solid.reduce((n, v) => n + v, 0);
    sewAt(g, 0, 100);
    expect(MAX_HP - kie.hp).toBe(sew.sew!.damage);
    expect(kie.pinned).toEqual({ active: false });
    expect(g.terrain.solid.reduce((n, v) => n + v, 0)).toBe(before); // passes through, no crater
    let marks = 0;
    for (let x = 450; x < 500; x++) for (let y = 380; y < 400; y++) if (g.terrain.isWet(x, y)) marks++;
    expect(marks).toBeGreaterThan(3); // stitch marks left in the ridge
  });

  it('a pinned enemy can’t move on their next turn, then is free again', () => {
    const g = game();
    const kie = g.players[1]!;
    sewAt(g, 0, 100);
    for (let t = 0; t < 3 && g.phase !== 'aiming'; t += FIXED_DT) step(g, FIXED_DT);
    expect(currentPlayer(g)).toBe(kie);
    expect(kie.pinned?.active).toBe(true);
    const x0 = kie.x;
    for (let t = 0; t < 1; t += FIXED_DT) drive(g, -1, FIXED_DT);
    expect(kie.x).toBe(x0);
    pass(g); // -> ciarra
    expect(kie.pinned).toBeNull();
  });

  it('power sets how far it sews; it never stitches ciarra', () => {
    const g = game();
    sewAt(g, 0, 0); // 200px: stops well short of kie at 400px away
    expect(g.players[1]!.hp).toBe(MAX_HP);
    expect(g.players[0]!.hp).toBe(MAX_HP);
  });
});

describe('Marathon', () => {
  it('needs no aiming; the runner jogs one leg towards the enemy, then waits', () => {
    const g = game();
    selectTier(g, 2);
    expect(isAimless(g)).toBe(true);
    fire(g);
    resolve(g);
    const r = g.runners[0]!;
    expect(r.x - 300).toBeCloseTo(marathon.runner!.leg, 0);
    expect(r.dir).toBe(1);
    expect(r.legLeft).toBe(0);
  });

  it('every shot fired sends it off again, over any hill, and it hits hard at the finish', () => {
    const g = game((x) => (x > 500 && x < 540 ? 330 : 400)); // a big hill on the route
    const kie = g.players[1]!;
    selectTier(g, 2);
    fire(g);
    resolve(g);
    // kie and ciarra trade (harmless) shots; the runner keeps going.
    for (let i = 0; i < 6 && g.runners.length > 0; i++) {
      pass(g);
      for (let t = 0; t < 3 && g.phase !== 'aiming'; t += FIXED_DT) step(g, FIXED_DT);
      if (currentPlayer(g).ammo.every((a) => a === 0)) break;
      selectTier(g, 0);
      setAim(g, 90, 0);
      g.projectiles = [];
      fire(g);
      g.projectiles = [];
      g.bursts = [];
      resolve(g);
    }
    expect(g.runners).toHaveLength(0);
    expect(MAX_HP - kie.hp).toBe(marathon.runner!.damage);
  });

  it('a blast that catches the runner knocks it out', () => {
    const g = game();
    selectTier(g, 2);
    fire(g);
    resolve(g);
    const r = g.runners[0]!;
    explode(g, r.x, r.y - 4, shell, 1);
    expect(r.out).toBe(true);
    step(g, FIXED_DT);
    g.phase = 'flying';
    step(g, FIXED_DT);
    expect(g.runners).toHaveLength(0);
  });
});

describe('frog hops', () => {
  it('ciarra hops instead of driving, a leap at a time, spending fuel', () => {
    const g = game();
    const c = g.players[0]!;
    const fuel = c.fuel;
    hold(g, 1, 0.1);
    expect(c.hop).not.toBeNull();
    let peak = c.y;
    for (let t = 0; t < 0.5; t += FIXED_DT) {
      drive(g, 0, FIXED_DT);
      peak = Math.min(peak, c.y);
    }
    expect(c.hop).toBeNull();
    expect(c.x - 300).toBe(HOP_DISTANCE);
    expect(peak).toBeLessThan(390); // it actually jumped
    expect(c.y).toBe(400);
    expect(c.fuel).toBe(fuel - HOP_DISTANCE);
  });

  it('hops over a wall a driving tank can’t climb, but not one taller than the hop', () => {
    const low = game((x) => (x >= 330 && x < 336 ? 390 : 400)); // a 10px wall
    hold(low, 1, 2);
    expect(low.players[0]!.x).toBeGreaterThan(340);

    const high = game((x) => (x >= 330 ? 370 : 400)); // a 30px cliff
    hold(high, 1, 2);
    expect(high.players[0]!.x).toBeLessThan(330);
  });

  it("can't fire mid-hop, and can't hop while pinned", () => {
    const g = game();
    hold(g, 1, 0.05);
    expect(fire(g)).toBe(false);
    hold(g, 0, 0.5);
    g.players[0]!.pinned = { active: true };
    const x = g.players[0]!.x;
    hold(g, 1, 1);
    expect(g.players[0]!.x).toBe(x);
  });
});

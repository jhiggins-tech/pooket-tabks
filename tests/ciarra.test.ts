import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { Terrain } from '../src/core/terrain';
import { DRIVE_SCRAMBLE, FIXED_DT, FUEL_PER_MATCH, MAX_HP, TANK_BODY_HEIGHT, WORLD_W } from '../src/game/constants';
import {
  createGame,
  currentPlayer,
  drive,
  explode,
  fire,
  HOP_DISTANCE,
  HOP_FUEL,
  HOP_HEIGHT,
  isAimless,
  selectTier,
  setAim,
  step,
} from '../src/game/game';
import type { GameState } from '../src/game/state';
import { marathon, sew, tattooGun } from '../src/characters/kits';
import { shell } from '../src/weapons/registry';
import { hold, passTurn, testGame, untilAiming, whileFlying } from './support/game';

const players = [
  { name: 'ciarra', colour: '#f472b6', characterId: 'ciarra' },
  { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
];

function game(heights?: (x: number) => number): GameState {
  return testGame({ seed: 80, players, heights, xs: [300, 700] });
}

describe('Tattoo Gun', () => {
  it('buzzes out a stream of ink needles for one round', () => {
    const g = game();
    selectTier(g, 0);
    setAim(g, 40, 60);
    fire(g);
    const seen = new Set<object>();
    whileFlying(g, 10, () => g.projectiles.forEach((p) => seen.add(p)));
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
    expect(g.fx.floaters.some((f) => f.text === 'TATTOOED')).toBe(true);
    let hp = kie.hp;
    explode(g, kie.x, kie.y - TANK_BODY_HEIGHT, shell, 0);
    expect(hp - kie.hp).toBe(Math.round(shell.damage * 1.25));
    whileFlying(g);
    passTurn(g); // kie's turn 1
    passTurn(g); // ciarra
    expect(kie.tattoo?.turnsLeft).toBe(1);
    passTurn(g); // kie's turn 2
    passTurn(g); // ciarra
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
    whileFlying(g);
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
    untilAiming(g, 3);
    expect(currentPlayer(g)).toBe(kie);
    expect(kie.pinned?.active).toBe(true);
    const x0 = kie.x;
    for (let t = 0; t < 1; t += FIXED_DT) drive(g, -1, FIXED_DT);
    expect(kie.x).toBe(x0);
    passTurn(g); // -> ciarra
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
    whileFlying(g);
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
    whileFlying(g);
    // kie and ciarra trade (harmless) shots; the runner keeps going.
    for (let i = 0; i < 6 && g.runners.length > 0; i++) {
      passTurn(g);
      untilAiming(g, 3);
      if (currentPlayer(g).ammo.every((a) => a === 0)) break;
      selectTier(g, 0);
      setAim(g, 90, 0);
      g.projectiles = [];
      fire(g);
      g.projectiles = [];
      g.bursts = [];
      whileFlying(g);
    }
    expect(g.runners).toHaveLength(0);
    expect(MAX_HP - kie.hp).toBe(marathon.runner!.damage);
  });

  /** ciarra's runner out on its first leg, then running another (as when kie fires). */
  function running(): GameState {
    const g = game();
    selectTier(g, 2);
    fire(g);
    whileFlying(g);
    g.runners[0]!.legLeft = marathon.runner!.leg;
    g.phase = 'flying';
    return g;
  }
  const shot = (g: GameState, ownerId: number, weaponId: string, x: number, y: number, vx: number, walk = 0) =>
    g.projectiles.push({ x, y, vx, vy: 0, weaponId, ownerId, trail: [], bounces: 0, age: 0, walkDir: walk, walkTime: 0, variant: 0 });

  it("an enemy shot that crosses the runner mid-leg goes off on her: DNF", () => {
    const g = running();
    const r = g.runners[0]!;
    shot(g, 1, shell.id, r.x + 60, r.y - 7, -400); // straight at her, at body height
    for (let t = 0; t < 1 && g.projectiles.length; t += FIXED_DT) step(g, FIXED_DT);
    expect(g.projectiles).toHaveLength(0);
    expect(r.out).toBe(true);
    expect(g.fx.floaters.some((f) => f.text === 'DNF')).toBe(true);
    // It went off on her, in mid-air at her body (not on the ground somewhere past her).
    const boom = g.fx.explosions[0]!;
    expect(Math.abs(boom.x - r.x)).toBeLessThanOrEqual(8);
    expect(boom.y).toBeLessThan(r.y - 2);
  });

  it("ciarra's own shots pass her by", () => {
    const g = running();
    const r = g.runners[0]!;
    shot(g, 0, shell.id, r.x - 30, r.y - 7, 600);
    for (let t = 0; t < 1 && g.projectiles[0] && g.projectiles[0].x < r.x + 20; t += FIXED_DT) step(g, FIXED_DT);
    expect(g.projectiles[0]!.x).toBeGreaterThan(r.x + 20);
    expect(r.out).toBe(false);
  });

  it('a weasel that walks into her pops on her', () => {
    const g = running();
    const r = g.runners[0]!;
    r.legLeft = 0; // standing still this time
    shot(g, 1, 'weasel-pop', r.x + 25, r.y, 0, -1);
    for (let t = 0; t < 3 && !r.out; t += FIXED_DT) step(g, FIXED_DT);
    expect(r.out).toBe(true);
  });

  it('a blast that catches the runner knocks it out', () => {
    const g = game();
    selectTier(g, 2);
    fire(g);
    whileFlying(g);
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
    for (let t = 0; t < 0.7; t += FIXED_DT) {
      drive(g, 0, FIXED_DT);
      peak = Math.min(peak, c.y);
    }
    expect(c.hop).toBeNull();
    expect(c.x - 300).toBe(HOP_DISTANCE);
    expect(peak).toBeLessThan(400 - 25); // a proper leap
    expect(c.y).toBe(400);
    expect(c.fuel).toBe(fuel - HOP_DISTANCE * HOP_FUEL);
  });

  /** The same ground with a driving tank (kie) in ciarra's place. */
  function driverGame(heights?: (x: number) => number): GameState {
    const g = createGame({ seed: 80, players: [{ name: 'kie', colour: '#4ea8ff', characterId: 'kie' }, players[1]!] });
    const w = g.terrain.width;
    g.terrain = Terrain.fromHeights(Float32Array.from({ length: w }, (_, x) => heights?.(x) ?? 400), w, g.terrain.height, createRng(1));
    g.players[0]!.x = 300;
    g.players[1]!.x = 700;
    for (const p of g.players) p.y = g.terrain.surfaceY(p.x);
    return g;
  }

  it('leaps up cliffs a driving tank can’t climb, but not one taller than the hop', () => {
    const cliff = (h: number) => (x: number) => (x >= 330 ? 400 - h : 400);
    const tall = DRIVE_SCRAMBLE + 15; // too much for a tank
    const tank = driverGame(cliff(tall));
    hold(tank, 1, 4);
    expect(tank.players[0]!.x).toBeLessThan(330);
    const frog = game(cliff(tall));
    hold(frog, 1, 4);
    hold(frog, 0, 1); // land
    expect(frog.players[0]!.x).toBeGreaterThan(340);
    expect(frog.players[0]!.y).toBe(400 - tall);

    const tooTall = game(cliff(HOP_HEIGHT + 10));
    hold(tooTall, 1, 4);
    expect(tooTall.players[0]!.x).toBeLessThan(330);
  });

  it('goes twice as far as a tank on a full tank of fuel', () => {
    const frog = game();
    const tank = driverGame();
    for (const g of [frog, tank]) g.players[1]!.x = 1080; // out of the way
    hold(frog, 1, 30);
    hold(tank, 1, 30);
    hold(frog, 0, 1);
    const hopped = frog.players[0]!.x - 300;
    const drove = tank.players[0]!.x - 300;
    expect(drove).toBeCloseTo(FUEL_PER_MATCH, -1);
    expect(hopped).toBeGreaterThan(drove * 1.8);
    expect(frog.players[0]!.fuel).toBeLessThan(HOP_DISTANCE * HOP_FUEL);
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

describe('Marathon info text', () => {
  it('says how far a leg is, matching the runner and the stage', () => {
    const leg = marathon.runner!.leg;
    const fraction = ['half', 'third', 'quarter', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'][Math.round(WORLD_W / leg) - 2];
    expect(marathon.info).toContain(`${leg}px`);
    expect(marathon.info).toContain(`about a ${fraction} of the stage`);
  });
});

import { describe, expect, it } from 'vitest';
import { sly } from '../src/characters/kits';
import { ARWING_ALTITUDE, ARWING_FUEL, ARWING_MORPH, ARWING_SPEED, FIXED_DT, FUEL_PER_MATCH, TANK_HALF_WIDTH } from '../src/game/constants';
import { canFire, drive, fire, selectTier, sneakClock, sneakReady } from '../src/game/game';
import type { GameState } from '../src/game/state';
import { hold, testGame } from './support/game';

const WALL = 500;

/** doctorfox at 300 on flat ground (y 400), a 100px-high wall from x = WALL, kcaj far off. */
function game(wall = true, xs: [number, number] = [300, 1000]): GameState {
  return testGame({
    seed: 9,
    players: [
      { name: 'fox', colour: '#fb923c', characterId: 'doctorfox' },
      { name: 'kcaj', colour: '#ffc53d', characterId: 'kcaj' },
    ],
    heights: (x) => (wall && x >= WALL ? 300 : 400),
    xs,
  });
}

describe("doctorfox's Arwing", () => {
  it('takes off (rising, no fuel spent, not moving), then flies at 3× drive speed over the ground', () => {
    const g = game(false);
    const fox = g.players[0]!;
    hold(g, 1, ARWING_MORPH / 2);
    expect(fox.flight?.stage).toBe('takeoff');
    expect(fox.x).toBe(300);
    expect(fox.y).toBeLessThan(400);
    expect(fox.fuel).toBe(FUEL_PER_MATCH);
    hold(g, 1, ARWING_MORPH / 2 + 0.02);
    expect(fox.flight?.stage).toBe('cruise');
    expect(fox.y).toBeCloseTo(400 - ARWING_ALTITUDE, 0);
    const [x0, fuel0] = [fox.x, fox.fuel];
    hold(g, 1, 0.5);
    expect(fox.x - x0).toBeCloseTo(ARWING_SPEED / 2, 0);
    expect(fox.fuel).toBeCloseTo(fuel0 - (fox.x - x0) * ARWING_FUEL, 5);
    expect(fox.y).toBeCloseTo(400 - ARWING_ALTITUDE, 0);
  });

  it('lands when let go, straight down, back on the ground and able to fire', () => {
    const g = game(false);
    const fox = g.players[0]!;
    hold(g, 1, ARWING_MORPH + 0.3);
    expect(canFire(g)).toBe(false);
    expect(fire(g)).toBe(false);
    const x = fox.x;
    hold(g, 0, ARWING_MORPH / 2);
    expect(fox.flight?.stage).toBe('landing');
    // Holding on again mid-landing does nothing until it's down.
    hold(g, 1, ARWING_MORPH / 2 - 0.03);
    expect(fox.flight?.stage).toBe('landing');
    hold(g, 0, 0.05);
    expect(fox.flight).toBeNull();
    expect([fox.x, fox.y]).toEqual([x, 400]);
    expect(canFire(g)).toBe(true);
  });

  it('flies up and over a wall a tank could never drive up, and lands on top', () => {
    const g = game();
    const fox = g.players[0]!;
    hold(g, 1, 3);
    expect(fox.x).toBeGreaterThan(WALL + 20);
    expect(fox.y).toBeCloseTo(300 - ARWING_ALTITUDE, 0);
    hold(g, 0, ARWING_MORPH + 0.02);
    expect(fox.y).toBe(300);
  });

  it('never flies into the ground on the way over', () => {
    const g = game();
    const fox = g.players[0]!;
    for (let i = 0; i < 360; i++) {
      drive(g, 1, 1 / 120);
      const ground = fox.x + TANK_HALF_WIDTH >= WALL ? 300 : 400;
      expect(fox.y).toBeLessThanOrEqual(ground);
    }
  });

  it('goes twice as far as a tank on the same fuel, then lands', () => {
    const g = game(false, [100, 1080]);
    const fox = g.players[0]!;
    hold(g, 1, 10);
    expect(fox.x - 100).toBeCloseTo(FUEL_PER_MATCH / ARWING_FUEL, 0);
    expect(fox.fuel).toBeCloseTo(0, 5);
    expect(fox.flight).toBeNull();
    expect(fox.y).toBe(400);
    expect(drive(g, 1, 0.1)).toBe(0);
    expect(fox.flight).toBeNull();
  });

  it('is stopped by another tank, as a driving one is', () => {
    const g = game(false, [300, 400]);
    const fox = g.players[0]!;
    hold(g, 1, 3);
    expect(fox.x).toBeLessThan(400 - TANK_HALF_WIDTH * 2 + 1);
    expect(fox.x).toBeGreaterThan(400 - TANK_HALF_WIDTH * 2 - 2);
  });

  it("can't take off when pinned", () => {
    const g = game(false);
    const fox = g.players[0]!;
    fox.pinned = { active: true };
    hold(g, 1, 1);
    expect(fox.flight).toBeNull();
    expect(fox.x).toBe(300);
  });
});

describe("doctorfox's Arwing under Sly's smoke", () => {
  it('flies off while hidden, and if time runs out in the air it lands before Sly is fired', () => {
    const g = game(false);
    const fox = g.players[0]!;
    selectTier(g, 1);
    fire(g);
    expect(g.phase).toBe('sneaking');
    expect(fox.hidden).toBe(true);
    for (let t = 0; t < sly.sly.time - 1.2; t += FIXED_DT) sneakClock(g, FIXED_DT);
    for (let t = 0; t < 1.1; t += FIXED_DT) {
      drive(g, 1, FIXED_DT);
      sneakClock(g, FIXED_DT);
    }
    expect(fox.flight?.stage).toBe('cruise');
    expect(fox.x).toBeGreaterThan(350);
    // Still holding as time runs out: it can't fly on, it lands, and only then is Sly ready to fire.
    for (let t = 0; t < 0.2; t += FIXED_DT) {
      drive(g, 1, FIXED_DT);
      sneakClock(g, FIXED_DT);
    }
    expect(g.sneak!.done).toBe(true);
    expect(fox.flight?.stage).toBe('landing');
    expect(sneakReady(g)).toBe(false);
    expect(canFire(g)).toBe(false);
    const x = fox.x;
    hold(g, 1, ARWING_MORPH);
    expect(fox.flight).toBeNull();
    expect([fox.x, fox.y]).toEqual([x, 400]);
    expect(sneakReady(g)).toBe(true);
    expect(fire(g)).toBe(true);
    expect(fox.hidden).toBe(true);
  });
});

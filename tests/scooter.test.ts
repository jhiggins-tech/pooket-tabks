import { describe, expect, it } from 'vitest';
import { DRIVE_SPEED, FUEL_PER_MATCH, SCOOTER_CRASH, SCOOTER_FUEL, SCOOTER_SPEED, TANK_HALF_WIDTH } from '../src/game/constants';
import { drive } from '../src/game/game';
import type { GameState } from '../src/game/state';
import { hold, testGame } from './support/game';

const WALL = 500;

/** garyoldmancorp at 300 on flat ground, a 100px wall from x = WALL, kcaj on top of it. */
function game(wall = true): GameState {
  return testGame({
    seed: 9,
    players: [
      { name: 'gary', colour: '#cbd5e1', characterId: 'garyoldmancorp' },
      { name: 'kcaj', colour: '#ffc53d', characterId: 'kcaj' },
    ],
    heights: (x) => (wall && x >= WALL ? 300 : 400),
    xs: [300, 900],
  });
}

describe("garyoldmancorp's scooter", () => {
  it('rides at 4× drive speed', () => {
    const g = game();
    const gary = g.players[0]!;
    hold(g, 1, 0.5);
    expect(SCOOTER_SPEED).toBe(DRIVE_SPEED * 4);
    expect(gary.x - 300).toBeCloseTo(SCOOTER_SPEED / 2, 0);
    expect(gary.y).toBe(400);
  });

  it('goes 1.5× as far on the same tank of fuel', () => {
    const g = game(false);
    const gary = g.players[0]!;
    hold(g, 1, 10);
    expect(gary.x - 300).toBeCloseTo(FUEL_PER_MATCH / SCOOTER_FUEL, 0);
    expect(FUEL_PER_MATCH / SCOOTER_FUEL).toBeCloseTo(375);
    expect(gary.fuel).toBeCloseTo(0, 5);
    expect(drive(g, 1, 0.1)).toBe(0);
  });

  it('crashes into terrain it can’t cross: stops there, 5 damage, once per run at it', () => {
    const g = game();
    const gary = g.players[0]!;
    hold(g, 1, 3);
    expect(gary.x).toBeLessThan(WALL);
    expect(gary.x).toBeGreaterThan(WALL - TANK_HALF_WIDTH - 2);
    expect(gary.hp).toBe(gary.maxHp - SCOOTER_CRASH);
    expect(gary.scooterCrash).toBe(1);
    expect(g.fx.floaters.some((f) => f.text === 'CRASH!')).toBe(true);
    // Holding on into the same wall: nothing more.
    hold(g, 1, 1);
    expect(gary.hp).toBe(gary.maxHp - SCOOTER_CRASH);
    // Back off and have another go: another crash.
    hold(g, -1, 0.2);
    expect(gary.scooterCrash).toBe(0);
    hold(g, 1, 1);
    expect(gary.hp).toBe(gary.maxHp - 2 * SCOOTER_CRASH);
    // Counted as his own damage.
    expect(g.tally[0]!.self).toBe(2 * SCOOTER_CRASH);
  });

  it('a crash never takes the last of his health', () => {
    const g = game();
    const gary = g.players[0]!;
    gary.hp = 3;
    hold(g, 1, 3);
    expect([gary.hp, gary.alive]).toEqual([1, true]);
    hold(g, -1, 0.2);
    hold(g, 1, 1);
    expect([gary.hp, gary.alive]).toEqual([1, true]);
  });

  it('another tank or the map edge just stops it: no crash', () => {
    const g = testGame({
      seed: 9,
      players: [
        { name: 'gary', colour: '#cbd5e1', characterId: 'garyoldmancorp' },
        { name: 'kcaj', colour: '#ffc53d', characterId: 'kcaj' },
      ],
      xs: [100, 180],
    });
    const gary = g.players[0]!;
    hold(g, 1, 1);
    expect(gary.x).toBeLessThan(180);
    hold(g, -1, 2);
    expect(gary.x).toBeLessThan(TANK_HALF_WIDTH + 1); // at the edge
    expect(gary.hp).toBe(gary.maxHp);
    expect(gary.scooterCrash).toBe(0);
  });

  it('pinned, it doesn’t move (or crash)', () => {
    const g = game();
    const gary = g.players[0]!;
    gary.pinned = { active: true };
    hold(g, 1, 1);
    expect([gary.x, gary.hp]).toEqual([300, gary.maxHp]);
  });
});

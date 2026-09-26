import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { Terrain } from '../src/core/terrain';
import { DRIVE_SPEED, FIXED_DT, FUEL_PER_TURN, TANK_HALF_WIDTH } from '../src/game/constants';
import { createGame, currentPlayer, drive, fire, selectTier, setAim, step } from '../src/game/game';
import type { GameState } from '../src/game/state';

const players = [
  { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
  { name: 'tones', colour: '#ff5a5f', characterId: 'tones' },
];

/** kie at x = 300, tones at 800, over custom ground (flat at 400 by default). */
function game(heights?: (x: number) => number): GameState {
  const g = createGame({ seed: 50, players });
  const w = g.terrain.width;
  g.terrain = Terrain.fromHeights(Float32Array.from({ length: w }, (_, x) => heights?.(x) ?? 400), w, g.terrain.height, createRng(1));
  g.players[0]!.x = 300;
  g.players[1]!.x = 800;
  for (const p of g.players) p.y = g.terrain.surfaceY(p.x);
  return g;
}

/** Hold a drive button for `seconds`. */
function hold(g: GameState, dir: number, seconds: number): void {
  for (let t = 0; t < seconds; t += FIXED_DT) drive(g, dir, FIXED_DT);
}

describe('driving with fuel', () => {
  it('every tank starts with a full tank of fuel', () => {
    expect(game().players.every((p) => p.fuel === FUEL_PER_TURN)).toBe(true);
  });

  it('drives at a steady speed, spending fuel per pixel, staying on the ground', () => {
    const g = game();
    const kie = g.players[0]!;
    hold(g, 1, 1);
    expect(kie.x - 300).toBeCloseTo(DRIVE_SPEED, 0);
    expect(kie.fuel).toBeCloseTo(FUEL_PER_TURN - (kie.x - 300), 5);
    expect(kie.y).toBe(400);
    hold(g, -1, 0.5);
    expect(kie.x).toBeCloseTo(300 + DRIVE_SPEED / 2, 0);
  });

  it('only goes as far as the fuel allows', () => {
    const g = game();
    const kie = g.players[0]!;
    hold(g, 1, 10);
    expect(kie.x - 300).toBeCloseTo(FUEL_PER_TURN, 5);
    expect(kie.fuel).toBe(0);
    expect(drive(g, 1, 1)).toBe(0);
  });

  it('can drive at any point before firing, but not once the shot is away', () => {
    const g = game();
    hold(g, 1, 0.3);
    setAim(g, 90, 10);
    hold(g, 1, 0.3);
    selectTier(g, 0);
    fire(g);
    expect(drive(g, 1, 0.5)).toBe(0);
  });

  it('refills at the start of each turn', () => {
    const g = game();
    hold(g, 1, 10);
    const pass = () => {
      g.phase = 'settling';
      g.settleTimer = 0;
      step(g, FIXED_DT);
    };
    pass(); // kie -> tones
    expect(currentPlayer(g).fuel).toBe(FUEL_PER_TURN);
    pass(); // tones -> kie
    expect(currentPlayer(g).name).toBe('kie');
    expect(currentPlayer(g).fuel).toBe(FUEL_PER_TURN);
  });

  it('climbs gentle slopes and rolls down them', () => {
    const g = game((x) => (x >= 300 ? 400 - (x - 300) * 0.5 : 400)); // 1-in-2 slope up to the right
    const kie = g.players[0]!;
    hold(g, 1, 1.2);
    expect(kie.x).toBeGreaterThan(330);
    expect(kie.y).toBeLessThan(400);
    const high = kie.y;
    hold(g, -1, 1.2);
    expect(kie.y).toBeGreaterThan(high);
  });

  it('is stopped by walls, other tanks, and the map edge', () => {
    const wall = game((x) => (x >= 330 ? 370 : 400));
    hold(wall, 1, 2);
    expect(wall.players[0]!.x).toBeLessThan(330);

    const tanks = game();
    tanks.players[1]!.x = 340;
    hold(tanks, 1, 2);
    expect(tanks.players[1]!.x - tanks.players[0]!.x).toBeGreaterThanOrEqual(TANK_HALF_WIDTH * 2 - 1);

    const edge = game();
    edge.players[0]!.x = 30;
    hold(edge, -1, 2);
    expect(edge.players[0]!.x).toBeGreaterThanOrEqual(TANK_HALF_WIDTH);
  });

  it('drops off a ledge onto the ground below', () => {
    const g = game((x) => (x >= 320 ? 440 : 400));
    const kie = g.players[0]!;
    hold(g, 1, 1.5);
    expect(kie.x).toBeGreaterThan(330);
    expect(kie.y).toBe(440);
  });
});

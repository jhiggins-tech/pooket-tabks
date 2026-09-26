import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { Terrain } from '../src/core/terrain';
import { FIXED_DT, MAX_HP, TANK_HALF_WIDTH } from '../src/game/constants';
import { createGame, currentPlayer, drive, fire, jetCharge, selectTier, setAim, step } from '../src/game/game';
import type { GameState } from '../src/game/state';
import { ten2 } from '../src/weapons/registry';

const spec = ten2.jetpack!;
const players = [
  { name: 'tones', colour: '#ff5a5f', characterId: 'tones' },
  { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
];

function flatGame(): GameState {
  const g = createGame({ seed: 12, players });
  const w = g.terrain.width;
  g.terrain = Terrain.fromHeights(new Float32Array(w).fill(400), w, g.terrain.height, createRng(1));
  for (const p of g.players) p.y = 400;
  return g;
}

function launch(g: GameState, angle: number, power: number): void {
  selectTier(g, 1);
  setAim(g, angle, power);
  fire(g);
}

function run(g: GameState, seconds: number, onTick?: () => void): void {
  for (let t = 0; t < seconds && g.phase === 'flying'; t += FIXED_DT) {
    step(g, FIXED_DT);
    onTick?.();
  }
}

function solidCount(g: GameState): number {
  return g.terrain.solid.reduce((n, v) => n + v, 0);
}

describe('ten-2', () => {
  it("is tones' tier 2 with a 10 second charge", () => {
    expect(createGame({ seed: 1, players }).players[0]!.loadout[1]).toBe('ten-2');
    expect(spec.chargeTime).toBe(10);
  });

  it('shakes in place for the whole charge, then blasts off', () => {
    const g = flatGame();
    const tones = g.players[0]!;
    const start = { x: tones.x, y: tones.y };
    launch(g, 60, 60);
    run(g, spec.chargeTime - 0.05);
    expect({ x: tones.x, y: tones.y }).toEqual(start);
    expect(jetCharge(g, 0)).toBeGreaterThan(0.99);
    expect(g.sludge).toHaveLength(0);
    run(g, 0.2);
    expect(jetCharge(g, 0)).toBeNull(); // launched
    expect(tones.y).toBeLessThan(start.y);
    expect(g.sludge.length).toBeGreaterThan(0);
  });

  it('flies in the aimed direction, further with more power, and lands on the ground', () => {
    const distance = (angle: number, power: number) => {
      const g = flatGame();
      const tones = g.players[0]!;
      tones.x = 550; // mid-map so either direction has room
      const x0 = tones.x;
      launch(g, angle, power);
      run(g, 25);
      expect(g.phase).not.toBe('flying');
      // Resting on the highest ground under its hull (which may be its own mud).
      let rest = g.terrain.height;
      for (let dx = -TANK_HALF_WIDTH + 2; dx <= TANK_HALF_WIDTH - 2; dx += 2) {
        rest = Math.min(rest, g.terrain.groundBelow(tones.x + dx, tones.y - 30));
      }
      expect(tones.y).toBe(rest);
      return tones.x - x0;
    };
    const right = distance(60, 50);
    expect(right).toBeGreaterThan(50);
    expect(distance(120, 50)).toBeLessThan(-50); // left
    expect(distance(60, 70)).toBeGreaterThan(right);
  });

  it('stays on the map', () => {
    const g = flatGame();
    const tones = g.players[0]!;
    tones.x = 60;
    launch(g, 170, 100);
    run(g, 25);
    expect(tones.x).toBeGreaterThanOrEqual(TANK_HALF_WIDTH);
  });

  it('propellant piles up as new dirt where it lands', () => {
    const g = flatGame();
    const before = solidCount(g);
    launch(g, 70, 55);
    run(g, 25);
    expect(solidCount(g)).toBeGreaterThan(before + 200);
    expect(g.sludge).toHaveLength(0);
  });

  it('propellant landing on an enemy poisons it over time; never tones', () => {
    const g = flatGame();
    const [tones, kie] = g.players as [(typeof g.players)[0], (typeof g.players)[0]];
    // tones flies up and over kie, whose tank sits under the early flight path where the exhaust falls.
    kie.x = tones.x + 60;
    launch(g, 55, 60);
    const hpOverTime: number[] = [];
    let burnEndedAt = -1;
    let t = 0;
    run(g, 30, () => {
      t += FIXED_DT;
      const jet = g.jets[0];
      if (burnEndedAt < 0 && (!jet || (jet.launched && jet.burnLeft <= 0))) burnEndedAt = t;
      hpOverTime.push(kie.hp);
    });
    const dealt = MAX_HP - kie.hp;
    expect(dealt).toBeGreaterThan(3);
    expect(dealt).toBeLessThan(40); // "a short amount"
    expect(tones.hp).toBe(MAX_HP);
    // Damage keeps trickling after the exhaust has stopped.
    const idx = Math.round(burnEndedAt / FIXED_DT);
    expect(hpOverTime.at(-1)!).toBeLessThan(hpOverTime[idx]!);
    // ...in several small numbers.
    expect(new Set(hpOverTime).size).toBeGreaterThan(4);
  });

  it('fired straight down into the ground it barely moves, and the turn still passes', () => {
    const g = flatGame();
    const tones = g.players[0]!;
    const x0 = tones.x;
    launch(g, 270, 80);
    run(g, 25);
    expect(Math.abs(tones.x - x0)).toBeLessThan(3);
    for (let t = 0; t < 3 && g.phase !== 'aiming'; t += FIXED_DT) step(g, FIXED_DT);
    expect(currentPlayer(g).name).toBe('kie');
  });

  it("won't land on top of another tank", () => {
    const g = flatGame();
    const [tones, kie] = g.players as [(typeof g.players)[0], (typeof g.players)[0]];
    tones.x = 400;
    kie.x = 400 + 150;
    launch(g, 60, 45);
    run(g, 25);
    expect(Math.abs(tones.x - kie.x)).toBeGreaterThanOrEqual(TANK_HALF_WIDTH * 2);
  });

  it('blasts out a big, wide spray of mud that carpets the ground', () => {
    const g = flatGame();
    const before = solidCount(g);
    launch(g, 55, 60);
    const seen = new Set<object>();
    run(g, 25, () => g.sludge.forEach((p) => seen.add(p)));
    expect(seen.size).toBeGreaterThan(800);
    expect(solidCount(g) - before).toBeGreaterThan(5000);
    let minX = Infinity;
    let maxX = -Infinity;
    for (let x = 0; x < g.terrain.width; x++) {
      for (let y = 330; y < 400; y++) {
        if (g.terrain.solid[y * g.terrain.width + x]) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
        }
      }
    }
    expect(maxX - minX).toBeGreaterThan(250);
  });

  it("doesn't leave mud hanging in mid-air behind the tank", () => {
    const g = flatGame();
    launch(g, 70, 70);
    run(g, 25);
    // Every column is solid from its surface all the way down: no mud floating with air beneath it.
    const w = g.terrain.width;
    for (let x = 0; x < w; x++) {
      const top = g.terrain.surfaceY(x);
      for (let y = top; y < 400; y++) expect(g.terrain.solid[y * w + x]).toBe(1);
    }
  });

  it("never buries tones under his own mud: he can still drive afterwards", () => {
    const g = flatGame();
    launch(g, 80, 30);
    run(g, 25);
    for (let t = 0; t < 3 && g.phase !== 'aiming'; t += FIXED_DT) step(g, FIXED_DT);
    for (let t = 0; t < 3 && currentPlayer(g).name !== 'tones'; t += FIXED_DT) {
      g.phase = 'settling';
      g.settleTimer = 0;
      step(g, FIXED_DT);
    }
    const x0 = g.players[0]!.x;
    let moved = 0;
    for (let t = 0; t < 1; t += FIXED_DT) moved += drive(g, 1, FIXED_DT) + drive(g, -1, 0);
    if (moved === 0) for (let t = 0; t < 1; t += FIXED_DT) moved += drive(g, -1, FIXED_DT);
    expect(moved).toBeGreaterThan(5);
    expect(g.players[0]!.x).not.toBe(x0);
  });
});

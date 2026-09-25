import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { Terrain } from '../src/core/terrain';
import { FIXED_DT, MAX_HP, TANK_BODY_HEIGHT } from '../src/game/constants';
import { adjustAim, createGame, fire, muzzle, normalizeAngle, selectTier, setAim, step } from '../src/game/game';
import type { GameState } from '../src/game/state';
import { angleLabel } from '../src/render/hud';

const players = [
  { name: 'kcaj', colour: '#ffc53d', characterId: 'kcaj' },
  { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
];

/** kcaj on a plateau at y = 200, kie down in a basin at y = 420. */
function cliffGame(): GameState {
  const g = createGame({ seed: 5, players });
  const w = g.terrain.width;
  const heights = Float32Array.from({ length: w }, (_, x) => (x < w * 0.4 ? 200 : 420));
  g.terrain = Terrain.fromHeights(heights, w, g.terrain.height, createRng(1));
  const [kcaj, kie] = g.players as [(typeof g.players)[0], (typeof g.players)[0]];
  kcaj.x = Math.round(w * 0.4) - 6; // right at the cliff edge, so there's a clear line down
  kcaj.y = 200;
  kie.x = Math.round(w * 0.8);
  kie.y = 420;
  return g;
}

/** Degrees from kcaj's barrel pivot straight at kie's tank. */
function angleToKie(g: GameState): number {
  const [kcaj, kie] = g.players as [(typeof g.players)[0], (typeof g.players)[0]];
  const dx = kie.x - kcaj.x;
  const dy = kie.y - TANK_BODY_HEIGHT - (kcaj.y - TANK_BODY_HEIGHT);
  return normalizeAngle((Math.atan2(-dy, dx) * 180) / Math.PI);
}

describe('360° aiming', () => {
  it('wraps angles instead of clamping to the horizon', () => {
    const g = createGame({ seed: 1, players });
    setAim(g, 300, 50);
    expect(g.players[0]!.angle).toBe(300);
    setAim(g, -20, 50);
    expect(g.players[0]!.angle).toBe(340);
    setAim(g, 359, 50);
    adjustAim(g, 2, 0);
    expect(g.players[0]!.angle).toBe(1);
    adjustAim(g, -3, 0);
    expect(g.players[0]!.angle).toBe(358);
  });

  it('points the barrel below the horizon', () => {
    const g = createGame({ seed: 1, players });
    const p = g.players[0]!;
    setAim(g, 270, 50);
    expect(muzzle(p).y).toBeGreaterThan(p.y - TANK_BODY_HEIGHT);
  });

  it('labels elevation above or below the horizon on the side the barrel points', () => {
    expect(angleLabel(45)).toBe('45° ▸');
    expect(angleLabel(135)).toBe('◂ 45°');
    expect(angleLabel(330)).toBe('−30° ▸');
    expect(angleLabel(210)).toBe('◂ −30°');
    expect(angleLabel(0)).toBe('0° ▸');
    expect(angleLabel(180)).toBe('◂ 0°');
    expect(angleLabel(90)).toBe('90° ▴');
    expect(angleLabel(270)).toBe('90° ▾');
  });

  it('a laser aimed downward hits a tank below (line of sight)', () => {
    const g = cliffGame();
    const angle = angleToKie(g);
    expect(angle).toBeGreaterThan(270); // below the horizon, pointing right
    selectTier(g, 1); // Hyperfixate
    setAim(g, angle, 50);
    fire(g);
    expect(g.beams[0]!.hitTank).toBe(true);
    expect(g.players[1]!.hp).toBeLessThan(MAX_HP);
  });

  it('a shell fired below the horizon can hit a tank below', () => {
    // Gravity bends a shell under the straight line, so aim a little above it (but still downward).
    const direct = angleToKie(cliffGame());
    const hits: number[] = [];
    for (let a = Math.ceil(direct); a < 360; a++) {
      const g = cliffGame();
      selectTier(g, 0); // Double Park
      setAim(g, a, 100);
      fire(g);
      for (let t = 0; t < 10 && g.phase === 'flying'; t += FIXED_DT) step(g, FIXED_DT);
      if (g.players[1]!.hp < MAX_HP && g.players[0]!.hp === MAX_HP) hits.push(a);
    }
    expect(hits.length).toBeGreaterThan(0);
    expect(Math.min(...hits)).toBeGreaterThan(270);
  });
});

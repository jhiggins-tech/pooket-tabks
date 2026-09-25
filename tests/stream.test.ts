import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { Terrain } from '../src/core/terrain';
import { FIXED_DT, GRAVITY, MAX_HP, MAX_SPEED } from '../src/game/constants';
import { createGame, currentPlayer, fire, muzzle, step, streamDuration, streamPressure } from '../src/game/game';
import type { GameState } from '../src/game/state';
import { ten1 } from '../src/weapons/registry';

const spec = ten1.stream!;
const players = [
  { name: 'tones', colour: '#ff5a5f', characterId: 'tones' },
  { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
];

/** tones vs kie on flat ground at y = 400. */
function flatGame(): GameState {
  const g = createGame({ seed: 8, players });
  const w = g.terrain.width;
  g.terrain = Terrain.fromHeights(new Float32Array(w).fill(400), w, g.terrain.height, createRng(1));
  for (const p of g.players) p.y = 400;
  return g;
}

/** Aim tones at 45° with the power whose full-pressure arc lands on kie. */
function aimAtKie(g: GameState): void {
  const [tones, kie] = g.players as [(typeof g.players)[0], (typeof g.players)[0]];
  tones.angle = 45;
  const m = muzzle(tones);
  const dx = kie.x - m.x;
  const drop = kie.y - 8 - m.y; // aim at the tank's centre
  // 45° launch, y measured downwards: y(x) = −x + g·x²/v², so hitting (dx, drop) needs v² = g·dx² / (dx + drop)
  const v = Math.sqrt((GRAVITY * dx * dx) / (dx + drop));
  tones.power = (v / MAX_SPEED) * 100;
}

function runTurn(g: GameState, onTick?: (g: GameState) => void): void {
  for (let t = 0; t < 20 && g.phase !== 'aiming' && g.phase !== 'gameover'; t += FIXED_DT) {
    step(g, FIXED_DT);
    onTick?.(g);
  }
}

describe('ten-1 pressure profile', () => {
  it('ramps from zero to full over a couple of seconds, holds briefly, then eases back to zero', () => {
    const d = streamDuration(spec);
    expect(spec.rampUp).toBeGreaterThanOrEqual(1.5);
    expect(spec.hold).toBeLessThan(spec.rampUp);
    expect(streamPressure(spec, 0)).toBe(0);
    expect(streamPressure(spec, spec.rampUp / 2)).toBeCloseTo(0.5);
    expect(streamPressure(spec, spec.rampUp + spec.hold / 2)).toBe(1);
    expect(streamPressure(spec, d)).toBe(0);
    // Monotonic up, then down: no sudden cut-off.
    let prev = 0;
    for (let t = 0; t <= spec.rampUp + spec.hold; t += 0.05) {
      const p = streamPressure(spec, t);
      expect(p).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = p;
    }
    for (let t = spec.rampUp + spec.hold; t <= d; t += 0.05) {
      const p = streamPressure(spec, t);
      expect(p).toBeLessThanOrEqual(prev + 1e-9);
      expect(prev - p).toBeLessThan(0.1);
      prev = p;
    }
  });
});

describe('ten-1 stream', () => {
  it('builds from a dribble to the full aimed shot speed, then fades out', () => {
    const g = flatGame();
    const tones = g.players[0]!;
    tones.angle = 60;
    tones.power = 70;
    fire(g);
    expect(g.streams).toHaveLength(1);
    const full = 0.7 * MAX_SPEED;
    const speeds: { t: number; v: number }[] = [];
    let t = 0;
    let seen = 0;
    runTurn(g, (s) => {
      t += FIXED_DT;
      for (const d of s.droplets.slice(seen)) speeds.push({ t, v: d.pressure * full });
      seen = s.droplets.length;
    });
    const early = speeds.filter((s) => s.t < 0.3).map((s) => s.v);
    const held = speeds.filter((s) => s.t > spec.rampUp + 0.1 && s.t < spec.rampUp + spec.hold - 0.1).map((s) => s.v);
    expect(Math.max(...early)).toBeLessThan(full * 0.1);
    expect(Math.min(...held)).toBeCloseTo(full, 0);
    expect(currentPlayer(g).name).toBe('kie');
  });

  it('at full pressure, droplets follow the full aimed trajectory', () => {
    const g = flatGame();
    aimAtKie(g);
    fire(g);
    // Fast-forward into the hold, then track a freshly emitted droplet until it lands.
    runUntilTime(g, spec.rampUp + 0.2);
    const d = g.droplets[g.droplets.length - 1]!;
    expect(d.pressure).toBe(1);
    let last = { x: d.x, y: d.y };
    for (let i = 0; i < 1000 && g.droplets.includes(d); i++) {
      last = { x: d.x, y: d.y };
      step(g, FIXED_DT);
    }
    expect(Math.abs(last.x - g.players[1]!.x)).toBeLessThan(20);
  });

  it('trickles damage onto the target in small batches and never hurts tones', () => {
    const g = flatGame();
    aimAtKie(g);
    fire(g);
    const seen = new Set<object>();
    runTurn(g, (s) => s.floaters.forEach((f) => f.colour === '#7fd3ff' && seen.add(f)));
    const [tones, kie] = g.players as [(typeof g.players)[0], (typeof g.players)[0]];
    const dealt = MAX_HP - kie.hp;
    expect(dealt).toBeGreaterThan(20);
    expect(dealt).toBeLessThan(45);
    expect(tones.hp).toBe(MAX_HP);
    expect(seen.size).toBeGreaterThan(5); // a trickle of small numbers, not one big hit
    expect(Math.max(...[...seen].map((f) => -Number((f as { text: string }).text)))).toBeLessThan(10);
  });

  it('is water: no craters, but it soaks the soil', () => {
    const g = flatGame();
    const solid = g.terrain.solid.reduce((n, v) => n + v, 0);
    g.players[0]!.angle = 60;
    g.players[0]!.power = 60;
    fire(g);
    runTurn(g);
    expect(g.terrain.solid.reduce((n, v) => n + v, 0)).toBe(solid);
    let wet = 0;
    for (let x = 0; x < g.terrain.width; x++) if (g.terrain.isWet(x, 400)) wet++;
    expect(wet).toBeGreaterThan(20);
  });

  it('uses one round of ammo and the turn only passes once every droplet has landed', () => {
    const g = flatGame();
    fire(g);
    expect(g.players[0]!.ammo).toEqual([4, 3, 1]);
    let stillFlying = false;
    for (let t = 0; t < 20 && g.phase === 'flying'; t += FIXED_DT) {
      if (g.streams.length === 0 && g.droplets.length > 0) stillFlying = true;
      step(g, FIXED_DT);
    }
    expect(stillFlying).toBe(true);
    expect(g.phase).toBe('settling');
  });
});

function runUntilTime(g: GameState, seconds: number): void {
  for (let t = 0; t < seconds; t += FIXED_DT) step(g, FIXED_DT);
}

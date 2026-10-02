import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { Terrain } from '../src/core/terrain';
import { FIXED_DT, GRAVITY, MAX_HP, MAX_SPEED } from '../src/game/constants';
import { createGame, currentPlayer, fire, muzzle, step, streamDuration, streamPressure } from '../src/game/game';
import type { GameState } from '../src/game/state';
import { ten1 } from '../src/characters/kits';
import { run, testGame, untilAiming } from './support/game';
import { SPLASHBACK_DAMAGE, SPLASHBACK_DECAY, SPLASHBACK_RANGE } from '../src/game/stream';
import { applySnapshot, takeSnapshot, upgradeSnapshot } from '../src/net/snapshot';

const spec = ten1.stream!;
const players = [
  { name: 'tones', colour: '#ff5a5f', characterId: 'tones' },
  { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
];

function flatGame(): GameState {
  return testGame({ seed: 8, players });
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

describe('ten-1 pressure profile', () => {
  const sample = (seed: number, from: number, to: number, dt = 0.01) => {
    const out: number[] = [];
    for (let t = from; t <= to; t += dt) out.push(streamPressure(spec, t, seed));
    return out;
  };

  it('starts empty, holds at exactly full, and ends empty', () => {
    for (const seed of [0, 1, 2, 12345]) {
      expect(streamPressure(spec, 0, seed)).toBe(0);
      expect(streamPressure(spec, spec.rampUp + spec.hold / 2, seed)).toBe(1);
      expect(streamPressure(spec, streamDuration(spec), seed)).toBe(0);
      for (const p of sample(seed, 0, streamDuration(spec))) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
  });

  it('builds up and winds down overall, starting as a dribble', () => {
    for (const seed of [0, 7, 99]) {
      const at = (t: number) => streamPressure(spec, t, seed);
      expect(at(0.05)).toBeLessThan(0.1);
      expect(at(spec.rampUp * 0.8)).toBeGreaterThan(at(spec.rampUp * 0.3));
      const down = spec.rampUp + spec.hold;
      expect(at(down + spec.rampDown * 0.8)).toBeLessThan(at(down + spec.rampDown * 0.3));
    }
  });

  it('comes in spurts: surges and lulls, not a steady ramp', () => {
    for (const seed of [0, 3, 42]) {
      const ps = sample(seed, 0, spec.rampUp - 0.01);
      const slopes = ps.slice(1).map((p, i) => (p - ps[i]!) / 0.01);
      const steady = 1 / spec.rampUp;
      expect(Math.max(...slopes)).toBeGreaterThan(2.5 * steady); // surges
      expect(slopes.filter((s) => Math.abs(s) < 0.3 * steady).length).toBeGreaterThan(20); // lulls
    }
  });

  it('every stream spurts differently', () => {
    expect(sample(1, 0, spec.rampUp)).not.toEqual(sample(2, 0, spec.rampUp));
  });
});

describe('ten-1 stream', () => {
  it('is yellow', () => {
    expect(ten1.colour).toBe('#ffcc1f');
  });

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
    untilAiming(g, (s) => {
      t += FIXED_DT;
      for (const d of s.droplets.slice(seen)) speeds.push({ t, v: d.pressure * full });
      seen = s.droplets.length;
    });
    const early = speeds.filter((s) => s.t < 0.1).map((s) => s.v);
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
    run(g, spec.rampUp + 0.2);
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
    untilAiming(g, (s) => s.fx.floaters.forEach((f) => f.colour !== '#ffffff' && seen.add(f)));
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
    untilAiming(g);
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

describe('ten-1 refund on a miss', () => {
  it('a jet that soaks nobody gives the round back at the end of the turn', () => {
    const g = flatGame();
    const tones = g.players[0]!;
    tones.angle = 135; // away from kie, off the left of the map
    tones.power = 60;
    fire(g);
    expect(tones.ammo[0]).toBe(4);
    untilAiming(g);
    expect(currentPlayer(g).name).toBe('kie');
    expect(tones.ammo[0]).toBe(5);
    expect(g.fx.floaters.some((f) => f.text === 'REFUNDED')).toBe(true);
    expect(g.sfx.some((e) => e.cue === 'refund')).toBe(true);
    expect(g.players[1]!.hp).toBe(MAX_HP);
  });

  it('a jet that soaks the enemy keeps the round spent', () => {
    const g = flatGame();
    const tones = g.players[0]!;
    aimAtKie(g);
    fire(g);
    untilAiming(g);
    expect(g.players[1]!.hp).toBeLessThan(MAX_HP);
    expect(tones.ammo[0]).toBe(4);
    expect(g.fx.floaters.some((f) => f.text === 'REFUNDED')).toBe(false);
  });

  it('refunds the last round too, so a player out of everything else keeps their turn coming', () => {
    const g = flatGame();
    const tones = g.players[0]!;
    tones.ammo = [1, 0, 0];
    tones.angle = 135;
    tones.power = 60;
    fire(g);
    untilAiming(g);
    expect(tones.ammo[0]).toBe(1);
    // kie passes; it comes back round to tones.
    g.phase = 'settling';
    g.settleTimer = 0;
    step(g, FIXED_DT);
    expect(currentPlayer(g).name).toBe('tones');
  });

  it('other weapons never refund', () => {
    const g = flatGame();
    const tones = g.players[0]!;
    tones.selectedTier = 2; // ten-3, spewed away from kie
    tones.angle = 180;
    fire(g);
    untilAiming(g);
    expect(tones.ammo[2]).toBe(0);
  });
});

describe('ten-1 spread', () => {
  /** tones at x = 200 and kie `dist` px to the right, on flat ground; returns kie's damage. */
  const shot = (dist: number, angle: number, power: number, seed: number): number => {
    const g = createGame({ seed, players });
    const w = g.terrain.width;
    g.terrain = Terrain.fromHeights(new Float32Array(w).fill(400), w, g.terrain.height, createRng(1));
    g.players[0]!.x = 200;
    g.players[1]!.x = 200 + dist;
    for (const p of g.players) p.y = 400;
    Object.assign(g.players[0]!, { angle, power });
    fire(g);
    untilAiming(g);
    return MAX_HP - g.players[1]!.hp;
  };

  it('sprays wide while the pressure is low, and tightens to a clean line at full', () => {
    const g = flatGame();
    Object.assign(g.players[0]!, { angle: 30, power: 80 });
    fire(g);
    const launch: { p: number; angle: number }[] = [];
    let seen = 0;
    untilAiming(g, (s) => {
      for (const d of s.droplets.slice(seen)) launch.push({ p: d.pressure, angle: (Math.atan2(-d.vy, d.vx) * 180) / Math.PI });
      seen = s.droplets.length;
    });
    const spread = (list: typeof launch) => Math.max(...list.map((l) => l.angle)) - Math.min(...list.map((l) => l.angle));
    expect(spread(launch.filter((l) => l.p > 0.05 && l.p < 0.4))).toBeGreaterThan(25);
    expect(spread(launch.filter((l) => l.p === 1))).toBeLessThan(0.5);
  });

  it("isn't so concentrated point-blank, but still reaches as far as ever", () => {
    const close = [1, 2, 3].map((s) => shot(60, 0, 75, s));
    const far = [1, 2, 3].map((s) => shot(400, 10, 95, s));
    for (const d of close) expect(d).toBeLessThan(72); // was ~90: nearly a one-shot
    for (const d of far) expect(d).toBeGreaterThan(38);
  });
});

describe('ten-1 splashback', () => {
  /** tones2 at x = 200 and kie `dist` px to the right on flat ground, firing; plays the turn out. */
  const play = (dist: number, angle: number, power: number, seed = 1) => {
    const g = createGame({ seed, players });
    const w = g.terrain.width;
    g.terrain = Terrain.fromHeights(new Float32Array(w).fill(400), w, g.terrain.height, createRng(1));
    g.players[0]!.x = 200;
    g.players[1]!.x = 200 + dist;
    for (const p of g.players) p.y = 400;
    Object.assign(g.players[0]!, { angle, power });
    fire(g);
    const st = g.streams[0]!;
    let streamTime = 0;
    let splashAt: number | null = null;
    const floaters = new Set<string>();
    untilAiming(g, (s) => {
      if (s.streams.includes(st)) streamTime = st.elapsed;
      splashAt ??= st.splashAt;
      for (const f of s.fx.floaters) floaters.add(f.text);
    });
    return { g, st, streamTime, splashAt, damage: MAX_HP - g.players[1]!.hp, tones: MAX_HP - g.players[0]!.hp, floaters };
  };

  it('up close (within 12 tank-widths): after 5 damage it splashes back, and the pressure dies away fast', () => {
    for (const [dist, angle, power, seed] of [[60, 0, 75, 1], [60, 0, 75, 2], [150, 10, 75, 3], [SPLASHBACK_RANGE - 20, 10, 85, 1]] as const) {
      const r = play(dist, angle, power, seed);
      expect(r.st.close).toEqual({ playerId: 1, twin: false });
      expect(r.splashAt).not.toBeNull();
      expect(r.floaters.has('SPLASHBACK!')).toBe(true);
      expect(r.g.sfx.some((e) => e.cue === 'splashback')).toBe(true);
      // The jet stops early: within the decay of the splashback, long before its full run.
      expect(r.streamTime).toBeLessThanOrEqual(r.splashAt! + SPLASHBACK_DECAY + FIXED_DT);
      expect(r.streamTime).toBeLessThan(streamDuration(spec));
      // A little over the 5 (drops already in the air still land), nowhere near the old ~70.
      expect(r.damage).toBeGreaterThan(SPLASHBACK_DAMAGE);
      expect(r.damage).toBeLessThan(16);
      expect(r.tones).toBe(0); // the rebound doesn't hurt
    }
  });

  it("further away it doesn't splash back: the full jet, as before", () => {
    for (const [dist, angle, power] of [[SPLASHBACK_RANGE + 20, 10, 85], [400, 10, 95]] as const) {
      const r = play(dist, angle, power);
      expect(r.st.close).toBeNull();
      expect(r.splashAt).toBeNull();
      expect(r.floaters.has('SPLASHBACK!')).toBe(false);
      expect(r.damage).toBeGreaterThan(30);
    }
  });

  it('close, but aimed away: nothing to splash back off, so the jet runs its course', () => {
    const r = play(SPLASHBACK_RANGE - 30, 180, 60);
    expect(r.st.close).not.toBeNull();
    expect(r.splashAt).toBeNull();
    expect(r.streamTime).toBeGreaterThan(streamDuration(spec) - 0.1);
  });

  it('a stored match with a stream in flight from before splashbacks carries on', () => {
    const g = flatGame();
    fire(g);
    const snap = takeSnapshot(g);
    const st = (snap.streams as Record<string, unknown>[])[0]!;
    for (const k of ['close', 'dealt', 'splashAt', 'splashFrom']) delete st[k];
    applySnapshot(g, upgradeSnapshot(snap));
    expect(g.streams[0]).toMatchObject({ close: null, dealt: 0, splashAt: null, splashFrom: 0 });
    run(g, 0.5);
  });
});

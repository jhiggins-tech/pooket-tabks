import { randRange } from '../core/rng';
import { getWeapon } from '../weapons/registry';
import type { StreamSpec, WeaponDef } from '../weapons/types';
import { GRAVITY, MAX_SPEED } from './constants';
import { spawnSplash } from './fx';
import type { Stepper } from './mechanics';
import type { Droplet, GameState, Player, Stream } from './state';
import { muzzle, noteHit, offence, soakTarget, targetAt, targetOwner } from './tanks';
import { hash, hexToRgb, tint } from './util';

/** tones' ten-1: the water jet, its pressure profile and droplets. */

export function fireStream(state: GameState, p: Player, weapon: WeaponDef): void {
  const m = muzzle(p);
  state.streams.push({
    id: state.fxSeq++,
    weaponId: weapon.id,
    ownerId: p.id,
    x: m.x,
    y: m.y,
    angle: p.angle,
    fullSpeed: (p.power / 100) * MAX_SPEED,
    elapsed: 0,
    emitCarry: 0,
    seed: Math.floor(state.rng() * 1e6),
    colour: weapon.colour ?? '#3fb6ff',
  });
}

/** Total time a stream runs for. */
export function streamDuration(spec: StreamSpec): number {
  return spec.rampUp + spec.hold + spec.rampDown;
}

/**
 * Pressure 0–1 at time t. It builds in uneven spurts (each surges quickly, then plateaus) with a
 * slight flutter, holds at exactly full so the jet completes the aimed arc, then sputters back
 * down the same way. `seed` makes every stream's spurts different.
 */
export function streamPressure(spec: StreamSpec, t: number, seed = 0): number {
  if (t <= 0) return 0;
  const up = spec.rampUp;
  const holdEnd = up + spec.hold;
  let base: number;
  if (t < up) base = spurts(t / up, seed);
  else if (t < holdEnd) return 1;
  else if (t < holdEnd + spec.rampDown) base = 1 - spurts((t - holdEnd) / spec.rampDown, seed + 101);
  else return 0;
  // Flutter fades out at empty and at full, so the endpoints stay exact.
  const flutter = 0.05 * Math.sin(t * 29 + seed) * Math.sin(t * 11.3 + seed * 1.7) * 4 * base * (1 - base);
  return Math.min(1, Math.max(0, base + flutter));
}

const SPURTS = 5;

/**
 * Monotonic 0→1 staircase with uneven step lengths and heights. Each step surges fast then
 * flattens (1 − (1 − f)^4). Later steps tend to be bigger, so it starts as a dribble.
 */
function spurts(u: number, seed: number): number {
  const widths = Array.from({ length: SPURTS }, (_, i) => 0.6 + hash(seed + i * 7.13) * 0.8);
  const rises = Array.from({ length: SPURTS }, (_, i) => (0.5 + hash(seed + i * 3.37 + 50)) * (i + 1));
  const wSum = widths.reduce((a, b) => a + b);
  const rSum = rises.reduce((a, b) => a + b);
  let b0 = 0;
  let h0 = 0;
  for (let i = 0; i < SPURTS; i++) {
    const b1 = b0 + widths[i]! / wSum;
    const h1 = h0 + rises[i]! / rSum;
    if (u < b1 || i === SPURTS - 1) {
      const f = Math.min(1, Math.max(0, (u - b0) / (b1 - b0)));
      return h0 + (h1 - h0) * (1 - (1 - f) ** 4);
    }
    b0 = b1;
    h0 = h1;
  }
  return 1;
}

/** Emits droplets for one stream. Returns true once its pressure profile has finished. */
export function stepStream(state: GameState, st: Stream, dt: number): boolean {
  const spec = getWeapon(st.weaponId).stream!;
  st.elapsed += dt;
  const pressure = streamPressure(spec, st.elapsed, st.seed);
  // Flow scales with pressure: a sparse dribble at first, a solid jet at full.
  st.emitCarry += spec.dropsPerSecond * (0.2 + 0.8 * pressure) * dt;
  while (st.emitCarry >= 1) {
    st.emitCarry -= 1;
    // A clean line at full pressure (just enough jitter that it isn't a laser: more and the drawn ribbon
    // zigzags), but a weak flow sprays, so the dribble that would otherwise all land on a close target
    // scatters around it.
    const loose = (1 - pressure) ** 1.5;
    const scatter = (spread: number) => ((randRange(state.rng, -1, 1) + randRange(state.rng, -1, 1)) / 2) * spread;
    const a = ((st.angle + 0.12 * scatter(1) + scatter((spec.spray ?? 0) * loose)) * Math.PI) / 180;
    const speed = st.fullSpeed * pressure * (1 + 0.002 * scatter(1) + scatter((spec.speedSpread ?? 0) * loose));
    state.droplets.push({
      streamId: st.id,
      weaponId: st.weaponId,
      ownerId: st.ownerId,
      x: st.x,
      y: st.y,
      vx: Math.cos(a) * speed,
      vy: -Math.sin(a) * speed,
      pressure,
      colour: st.colour,
    });
  }
  return st.elapsed >= streamDuration(spec);
}

/** Moves one droplet. Returns true when it has landed, soaked a tank or left the map. */
export function stepDroplet(state: GameState, d: Droplet, dt: number): boolean {
  const { terrain } = state;
  const weapon = getWeapon(d.weaponId);
  d.vy += GRAVITY * dt;
  const nx = d.x + d.vx * dt;
  const ny = d.y + d.vy * dt;
  const steps = Math.max(1, Math.ceil(Math.hypot(nx - d.x, ny - d.y) / 1.5));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = d.x + (nx - d.x) * t;
    const y = d.y + (ny - d.y) * t;
    const target = targetAt(state, x, y);
    if (target) noteHit(state, target, d.ownerId);
    if (target && !(weapon.friendlyFire === false && targetOwner(target) === d.ownerId)) {
      // A weak dribble stings much less than the full-pressure jet.
      const drop = (weapon.stream?.damagePerDrop ?? 0) * (0.1 + 0.9 * d.pressure ** 2);
      soakTarget(target, drop * offence(state, d.ownerId), tint(d.colour, 0.35));
      spawnSplash(state, x, y, d, 3);
      return true;
    }
    if (terrain.isSolid(x, y)) {
      terrain.wetCircle(x, y, 2.5 + d.pressure * 2, hexToRgb(d.colour));
      spawnSplash(state, x, y, d, 2);
      return true;
    }
  }
  d.x = nx;
  d.y = ny;
  return d.x < -50 || d.x > terrain.width + 50;
}

export const streamStepper: Stepper = {
  step(state, dt) {
    state.streams = state.streams.filter((st) => !stepStream(state, st, dt));
  },
  busy: (state) => state.streams.length > 0,
};

export const dropletStepper: Stepper = {
  step(state, dt) {
    state.droplets = state.droplets.filter((d) => !stepDroplet(state, d, dt));
  },
  busy: (state) => state.droplets.length > 0,
};

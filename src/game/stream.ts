import { randRange } from '../core/rng';
import { weaponOf } from '../weapons/registry';
import type { StreamSpec, WeaponOf } from '../weapons/types';
import { bodiesOf } from './bodies';
import { GRAVITY, MAX_SPEED, TANK_BODY_HEIGHT, TANK_HALF_WIDTH } from './constants';
import { sound, spawnFloater, spawnSplash } from './fx';
import type { Stepper } from './mechanics';
import type { Droplet, GameState, Player, Stream } from './state';
import { muzzle, noteHit, offence, soakTarget, targetAt, targetOwner, type Target } from './tanks';
import { hash, hexToRgb, tint } from './util';

/**
 * tones2's ten-1: the water jet, its pressure profile and droplets. And the splashback: fired at an enemy
 * tank within SPLASHBACK_RANGE (the nearest, when firing), once the jet has done SPLASHBACK_DAMAGE to it
 * the water rebounds onto tones2's own tank (looks only, no damage), knocking the aim off, and the
 * pressure dies away to nothing over SPLASHBACK_DECAY.
 */

/** How close (tank centres) an enemy has to be for the jet to splash back: 12 tank-widths. */
export const SPLASHBACK_RANGE = TANK_HALF_WIDTH * 2 * 12;
/** Damage to that close enemy (more than this) that sets off the splashback. */
export const SPLASHBACK_DAMAGE = 5;
/** Seconds the pressure takes to die away after a splashback. */
export const SPLASHBACK_DECAY = 0.45;
/** How far (degrees) the splashback knocks the aim, upwards, by the time the pressure's gone. */
const SPLASHBACK_KNOCK = 35;

/** The enemy tank nearest p, if it's within splashback range. */
function closeEnemy(state: GameState, p: Player): Stream['close'] {
  let best: Stream['close'] = null;
  let bestD = SPLASHBACK_RANGE;
  for (const q of state.players) {
    if (q === p || !q.alive) continue;
    for (const tank of bodiesOf(q)) {
      const d = Math.hypot(tank.x - p.x, tank.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = { playerId: q.id, twin: tank !== q };
      }
    }
  }
  return best;
}

function isClose(st: Stream, t: Target): boolean {
  const c = st.close;
  return !!c && t.kind === 'tank' && t.player.id === c.playerId && (t.tank !== t.player) === c.twin;
}

export function fireStream(state: GameState, p: Player, weapon: WeaponOf<'stream'>): void {
  const m = muzzle(p);
  state.streams.push({
    id: state.nextId++,
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
    close: closeEnemy(state, p),
    dealt: 0,
    splashAt: null,
    splashFrom: 0,
  });
}

/** How far through dying away a splashed-back stream is (0–1), or null if it hasn't splashed back. */
function splashed(st: Stream): number | null {
  return st.splashAt === null ? null : Math.min(1, (st.elapsed - st.splashAt) / SPLASHBACK_DECAY);
}

/** The water bounces back off the close enemy onto tones2: a burst of spray arcing home, and the aim knocked. */
function splashBack(state: GameState, st: Stream, pressure: number, x: number, y: number): void {
  st.splashAt = st.elapsed;
  st.splashFrom = pressure;
  const owner = state.players[st.ownerId];
  if (!owner) return;
  const tx = owner.x;
  const ty = owner.y - TANK_BODY_HEIGHT;
  // Cosmetic: arcs that land on tones2's tank (ballistic: flight time T, same gravity as the splashes).
  for (let i = 0; i < 36; i++) {
    const h = hash(state.fxSeq++ * 1.37);
    const T = 0.45 + hash(h * 53) * 0.3;
    const aimX = tx + (hash(h * 11) - 0.5) * 18;
    const aimY = ty + (hash(h * 29) - 0.5) * 8;
    state.fx.splashes.push({
      x: x + (hash(h * 17) - 0.5) * 6,
      y: y - 2,
      vx: (aimX - x) / T,
      vy: (aimY - y) / T - 0.5 * GRAVITY * T,
      age: 0,
      life: T + 0.15,
      colour: st.colour,
      size: 2.2 + hash(h * 41) * 1.6,
    });
  }
  spawnFloater(state, tx, ty - 22, 'SPLASHBACK!', st.colour);
  sound(state, 'splashback', st.weaponId);
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
  const spec = weaponOf(st.weaponId, 'stream').stream;
  st.elapsed += dt;
  // After a splashback the pressure dies away from where it was, and the aim's knocked upwards.
  const back = splashed(st);
  const pressure = back === null ? streamPressure(spec, st.elapsed, st.seed) : st.splashFrom * (1 - back);
  const knock = back === null ? 0 : back * SPLASHBACK_KNOCK * (st.angle > 90 && st.angle < 270 ? -1 : 1);
  // Flow scales with pressure: a sparse dribble at first, a solid jet at full.
  st.emitCarry += spec.dropsPerSecond * (0.2 + 0.8 * pressure) * dt;
  while (st.emitCarry >= 1) {
    st.emitCarry -= 1;
    // A clean line at full pressure (just enough jitter that it isn't a laser: more and the drawn ribbon
    // zigzags), but a weak flow sprays, so the dribble that would otherwise all land on a close target
    // scatters around it.
    const loose = Math.max((1 - pressure) ** 1.5, back ?? 0);
    const scatter = (spread: number) => ((randRange(state.rng, -1, 1) + randRange(state.rng, -1, 1)) / 2) * spread;
    const a = ((st.angle + knock + 0.12 * scatter(1) + scatter((spec.spray ?? 0) * loose)) * Math.PI) / 180;
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
  return back === 1 || st.elapsed >= streamDuration(spec);
}

/** Moves one droplet. Returns true when it has landed, soaked a tank or left the map. */
export function stepDroplet(state: GameState, d: Droplet, dt: number): boolean {
  const { terrain } = state;
  const weapon = weaponOf(d.weaponId, 'stream');
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
      const drop = weapon.stream.damagePerDrop * (0.1 + 0.9 * d.pressure ** 2) * offence(state, d.ownerId);
      soakTarget(target, drop, tint(d.colour, 0.35));
      // Too close: once it's done enough to the close enemy, it splashes back.
      const st = state.streams.find((s) => s.id === d.streamId);
      if (st && st.splashAt === null && isClose(st, target) && (st.dealt += drop) > SPLASHBACK_DAMAGE) {
        splashBack(state, st, streamPressure(weapon.stream, st.elapsed, st.seed), x, y);
      }
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

import { randRange } from '../core/rng';
import { getWeapon, gunkWeapon, weaponOf } from '../weapons/registry';
import type { WeaponDef } from '../weapons/types';
import { GRAVITY, TANK_BODY_HEIGHT, TANK_HALF_WIDTH } from './constants';
import type { Stepper } from './mechanics';
import type { GameState, Player, Puddle, Sludge, Spew } from './state';
import { allTargets, doseTarget, muzzle, offence, soakTarget, tankBodies, targetAt, targetOwner, targetPos } from './tanks';
import { hash } from './util';

/** Gunk: ten-3's spew, the mud and sludge it throws (and ten-2's propellant), toxic puddles and toxin doses. */

/** Gush chunks from the barrel for the spew's duration. Returns true once it has finished. */
export function stepSpew(state: GameState, sp: Spew, dt: number): boolean {
  const p = state.players[sp.playerId]!;
  const spec = weaponOf(sp.weaponId, 'spew').spew;
  sp.elapsed += dt;
  sp.emitCarry += spec.chunksPerSecond * dt;
  const m = muzzle(p);
  while (sp.emitCarry >= 1) {
    sp.emitCarry -= 1;
    const a = ((p.angle + randRange(state.rng, -spec.spreadDeg, spec.spreadDeg)) * Math.PI) / 180;
    const v = (0.25 + 0.75 * (p.power / 100)) * spec.speed * randRange(state.rng, 0.75, 1.1);
    state.sludge.push({
      x: m.x,
      y: m.y,
      vx: Math.cos(a) * v,
      vy: -Math.sin(a) * v,
      ownerId: p.id,
      weaponId: sp.weaponId,
      look: hash(state.fxSeq++ * 1.618),
      age: 0,
    });
  }
  return sp.elapsed >= spec.duration;
}

/** True while a player's spew is gushing (for drawing). */
export function isSpewing(state: GameState, playerId: number): boolean {
  return state.spews.some((sp) => sp.playerId === playerId);
}

/**
 * Gunk ignores terrain for this long after leaving the nozzle. Otherwise a particle landing right at
 * the nozzle leaves a blob the next ones hit, and mud piles up in mid-air behind a flying tank.
 */
const GUNK_GRACE = 0.05;

/** Moves one gunk particle. Returns true when it has landed (as dirt) or hit a tank. */
export function stepSludge(state: GameState, sl: Sludge, dt: number): boolean {
  const { terrain } = state;
  const spec = gunkWeapon(sl.weaponId).gunk;
  sl.age += dt;
  sl.vy += GRAVITY * dt;
  const nx = sl.x + sl.vx * dt;
  const ny = sl.y + sl.vy * dt;
  const steps = Math.max(1, Math.ceil(Math.hypot(nx - sl.x, ny - sl.y)));
  let freeX = sl.x;
  let freeY = sl.y;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = sl.x + (nx - sl.x) * t;
    const y = sl.y + (ny - sl.y) * t;
    const target = targetAt(state, x, y);
    if (target && targetOwner(target) !== sl.ownerId) {
      const dose = spec.dosePerParticle * offence(state, sl.ownerId);
      const colour = getWeapon(sl.weaponId).colour ?? '#9be22d';
      doseTarget(target, dose, spec.dosePerSecond, colour);
      return true;
    }
    if (!target && sl.age > GUNK_GRACE && terrain.isSolid(x, y)) {
      // Gunk slumps: slide down and off the top of piles before settling, so it builds mounds, not spikes.
      let mx = Math.round(freeX);
      let my = Math.round(freeY);
      // Blasted into the ground during its grace period? Surface first.
      for (let up = 0; up < 40 && terrain.isSolid(mx, my); up++) my--;
      // Look up to 3px either side for somewhere lower, so piles spread into low mounds, not towers.
      for (let k = 0; k < 40; k++) {
        if (!terrain.isSolid(mx, my + 1)) {
          my++;
          continue;
        }
        const side = hash(mx * 0.7 + my * 1.3 + k) < 0.5 ? 1 : -1;
        let slid = false;
        for (let d = 1; d <= 3 && !slid; d++) {
          for (const dir of [side, -side]) {
            if (!terrain.isSolid(mx + dir * d, my) && !terrain.isSolid(mx + dir * d, my + 1)) {
              mx += dir * d;
              my++;
              slid = true;
              break;
            }
          }
        }
        if (!slid) break;
      }
      // Gunk that lands on a tank's hull splatters off rather than burying it.
      const onHull = tankBodies(state).some(
        (q) => Math.abs(q.x - mx) < TANK_HALF_WIDTH + 2 && my <= q.y + 1 && my >= q.y - TANK_BODY_HEIGHT * 2 - 2,
      );
      if (!onHull) terrain.addDirt(mx, my - 0.5, spec.depositRadius, spec.deposit);
      if (spec.puddle) addPuddle(state, sl, mx, my, spec.puddle);
      return true;
    }
    freeX = x;
    freeY = y;
  }
  sl.x = nx;
  sl.y = ny;
  return sl.x < -50 || sl.x > terrain.width + 50;
}

/** Leave (or refresh) a patch of toxic sludge where a particle landed. */
function addPuddle(
  state: GameState,
  sl: Sludge,
  x: number,
  y: number,
  spec: { radius: number; linger: number },
): void {
  const near = state.puddles.find((p) => p.ownerId === sl.ownerId && Math.hypot(p.x - x, p.y - y) < spec.radius * 0.6);
  if (near) {
    near.age = 0; // fresh sludge keeps it going
    return;
  }
  state.puddles.push({ x, y, radius: spec.radius, ownerId: sl.ownerId, weaponId: sl.weaponId, age: 0, ttl: spec.linger });
}

/** Whether a tank resting with its feet at (x, y) is touching a puddle. */
function touchesPuddle(p: Puddle, x: number, y: number): boolean {
  return Math.abs(p.x - x) <= p.radius + TANK_HALF_WIDTH && Math.abs(p.y - y) <= p.radius + TANK_BODY_HEIGHT;
}

/** Burn enemies (and decoys) touching toxic sludge; puddles expire after lingering. */
export function stepPuddles(state: GameState, dt: number): void {
  if (state.puddles.length === 0) return;
  for (const t of allTargets(state)) {
    const pos = targetPos(t);
    // One burn per sludge owner, however many patches the tank is sitting in.
    const burning = state.puddles.find((p) => p.ownerId !== targetOwner(t) && touchesPuddle(p, pos.x, pos.y));
    if (!burning) continue;
    const amount = (gunkWeapon(burning.weaponId).gunk.puddle?.damagePerSecond ?? 0) * dt * offence(state, burning.ownerId);
    soakTarget(t, amount, '#b6f04a');
  }
  for (const p of state.puddles) p.age += dt;
  state.puddles = state.puddles.filter((p) => p.age < p.ttl);
}

/** Toxin on a tank drains into (batched, trickling) damage over a couple of seconds. */
export function drainToxin(state: GameState, dt: number): void {
  for (const p of state.players) {
    const tw = p.twin;
    for (const tank of tw ? [p, tw] : [p]) {
      if (tank.toxin <= 0) continue;
      const d = Math.min(tank.toxin, tank.toxinRate * dt);
      tank.toxin = tank.toxin - d < 1e-6 ? 0 : tank.toxin - d;
      tank.soak += d;
    }
  }
}

/** ten-3: a gush of chunks from the barrel. */
export function fireSpew(state: GameState, p: Player, weapon: WeaponDef): void {
  state.spews.push({ playerId: p.id, weaponId: weapon.id, elapsed: 0, emitCarry: 0 });
}

export const spewStepper: Stepper = {
  step(state, dt) {
    state.spews = state.spews.filter((sp) => !stepSpew(state, sp, dt));
  },
  busy: (state) => state.spews.length > 0,
};

export const sludgeStepper: Stepper = {
  step(state, dt) {
    state.sludge = state.sludge.filter((sl) => !stepSludge(state, sl, dt));
  },
  busy: (state) => state.sludge.length > 0,
};

export const puddleStepper: Stepper = {
  step: stepPuddles,
  busy: (state) => state.puddles.length > 0,
};

/** Toxin doses drain into damage before the turn can end. */
export const toxinStepper: Stepper = {
  step: drainToxin,
  busy: (state) => state.players.some((p) => p.toxin > 0 || (p.twin?.toxin ?? 0) > 0),
};

import { getWeapon, kindOf, weaponOf } from '../weapons/registry';
import type { WeaponOf } from '../weapons/types';
import { GRAVITY, MAX_SPEED, TANK_BODY_HEIGHT } from './constants';
import { sound, spawnFloater } from './fx';
import type { Stepper } from './mechanics';
import type { Basketball, GameState, Hoop, Player } from './state';
import { applyHit, explode, forEachTargetPos, muzzle, scaled, targetAt, targetOwner, targetPos, type Target } from './tanks';

/**
 * garyoldmancorp's Hoop Dreamz: while it's selected a basketball hoop hangs over the enemy nearest him
 * (`hoopFor`: a fixed height over their tank, the backboard on the far side). The ball flies like a shell
 * (aim and power as usual). Dropping through the rim near the middle is a make: it sits on the rim a
 * moment, then is slammed straight down, faster and faster, and blows up on whatever's under the hoop
 * (the weapon's blast, from the middle of the tank, so a dunk onto them is the full damage). Anything
 * else and it's just a ball: it clanks off the rim's outer part, the underside and the backboard, bounces
 * across the ground and off tanks, and the first enemy it bounces onto takes `looseDamage`; no crater.
 * It can still go in after a bounce. The camera zooming in on the hoop is the renderer's (canvas.ts).
 */

/** The ball's radius (px), for bouncing off things and drawing. */
export const BALL_RADIUS = 4.5;
/** The backboard: how far it stands out past the rim's end, and how far it reaches above the rim (and below). */
export const BOARD_GAP = 3;
export const BOARD_HEIGHT = 30;
const BOARD_BELOW = 4;
/** The rim is never higher than this (px from the top of the world). */
const HOOP_TOP = 40;
/** How long a dunk sits on the rim before the slam (s), and how hard it's slammed down (px/s²). */
const DUNK_HANG = 0.14;
const DUNK_ACCEL = 2600;
/** A rim-out kicks the ball outward this fast (px/s), as well as back up. */
const RIM_KICK = 70;
/** A ball slower than this after a bounce has stopped (it's gone); and these cap a ball that won't settle. */
const REST_SPEED = 40;
const MAX_BOUNCES = 16;
const MAX_AGE = 8;

/** Points round the ball's edge, for touching the ground: underneath first, then the sides, then the top. */
const EDGE: readonly (readonly [number, number])[] = [
  [0, 1],
  [-0.7, 0.7],
  [0.7, 0.7],
  [-1, 0],
  [1, 0],
  [-0.7, -0.7],
  [0.7, -0.7],
  [0, -1],
];

/** Whether `p`'s tier `tier` is a Hoop Dreamz. */
export function isHoop(p: Player, tier: number): boolean {
  const id = p.loadout[tier];
  return id !== undefined && kindOf(getWeapon(id)) === 'hoop';
}

/**
 * Where `p`'s Hoop Dreamz hoop hangs: over the enemy target nearest them along the ground (a decoy counts,
 * so it gives nothing away; an enemy hidden by Sly doesn't, nor does it give him away), `height` px above it, and the backboard on the side away from `p`.
 */
export function hoopFor(state: GameState, p: Player, weapon: WeaponOf<'hoop'>): Hoop | null {
  let bx = 0;
  let by = 0;
  let best = Infinity;
  forEachTargetPos(state, (x, y, owner) => {
    if (owner === p.id || Math.abs(x - p.x) >= best) return;
    [bx, by, best] = [x, y, Math.abs(x - p.x)];
  }, true);
  if (best === Infinity) return null;
  const edge = weapon.hoop.rimHalf + BOARD_GAP + 2;
  const x = Math.min(state.terrain.width - edge, Math.max(edge, bx));
  return { x, y: Math.max(HOOP_TOP, by - TANK_BODY_HEIGHT - weapon.hoop.height), side: bx >= p.x ? 1 : -1 };
}

/** Shoot: the ball leaves the barrel like a shell, at the hoop over the nearest enemy. */
export function shootHoop(state: GameState, p: Player, weapon: WeaponOf<'hoop'>): void {
  const speed = (p.power / 100) * MAX_SPEED;
  const a = (p.angle * Math.PI) / 180;
  const m = muzzle(p);
  state.basketballs.push({
    ownerId: p.id,
    weaponId: weapon.id,
    x: m.x,
    y: m.y,
    vx: Math.cos(a) * speed,
    vy: -Math.sin(a) * speed,
    hoop: hoopFor(state, p, weapon),
    age: 0,
    bounces: 0,
    dunk: null,
    hit: false,
  });
}

/** Moves a ball on. Returns true once it's done (slammed home, stopped, or off the map). */
export function stepBall(state: GameState, b: Basketball, dt: number): boolean {
  const weapon = weaponOf(b.weaponId, 'hoop');
  b.age += dt;
  if (b.dunk !== null) return stepDunk(state, b, weapon, dt);
  if (b.age > MAX_AGE) return true;
  b.vy += GRAVITY * dt;
  const nx = b.x + b.vx * dt;
  const ny = b.y + b.vy * dt;
  // ~1px at a time, so it can't skip the rim, a tank or thin ground.
  const steps = Math.max(1, Math.ceil(Math.hypot(nx - b.x, ny - b.y)));
  let lastX = b.x;
  let lastY = b.y;
  for (let i = 1; i <= steps; i++) {
    const x = b.x + ((nx - b.x) * i) / steps;
    const y = b.y + ((ny - b.y) * i) / steps;
    if (b.hoop && atHoop(state, b, weapon, b.hoop, lastX, lastY, x, y)) return false;
    const target = targetAt(state, x, y);
    if (target) {
      offTank(state, b, weapon, target, lastX, lastY);
      return false;
    }
    for (const [ex, ey] of EDGE) {
      const cx = x + ex * BALL_RADIUS;
      const cy = y + ey * BALL_RADIUS;
      if (state.terrain.isSolid(cx, cy)) return offGround(state, b, weapon, cx, cy, lastX, lastY);
    }
    lastX = x;
    lastY = y;
  }
  b.x = nx;
  b.y = ny;
  return b.x < -BALL_RADIUS || b.x > state.terrain.width + BALL_RADIUS;
}

/**
 * The ball meets the hoop going from (x0, y0) to (x1, y1): through the middle of the rim (a make), the
 * outer part of the rim from above or the rim from below (a clank, back the way it came), or the
 * backboard. Returns true if it met it (the ball's been dealt with).
 */
function atHoop(state: GameState, b: Basketball, weapon: WeaponOf<'hoop'>, h: Hoop, x0: number, y0: number, x1: number, y1: number): boolean {
  const { rimHalf, swish, restitution } = weapon.hoop;
  const off = Math.abs(x1 - h.x);
  if (y0 < h.y && y1 >= h.y) {
    if (off <= swish) {
      // Nothing but net.
      Object.assign(b, { x: h.x, y: h.y, vx: 0, vy: 0, dunk: 0 });
      sound(state, 'swish', b.weaponId);
      spawnFloater(state, h.x, h.y - 16, 'SLAM DUNK!', '#fb923c');
      return true;
    }
    if (off <= rimHalf + BALL_RADIUS) {
      // Off the rim: up, and outwards.
      Object.assign(b, { x: x0, y: y0, vx: b.vx * 0.7 + Math.sign(x1 - h.x) * RIM_KICK, vy: -Math.abs(b.vy) * restitution });
      sound(state, 'clank', b.weaponId);
      return true;
    }
  }
  if (y0 > h.y && y1 <= h.y && off <= rimHalf + BALL_RADIUS) {
    // Up into the underside of the hoop.
    Object.assign(b, { x: x0, y: y0, vy: Math.abs(b.vy) * restitution * 0.6 });
    sound(state, 'clank', b.weaponId);
    return true;
  }
  // The backboard: a face either side, from BOARD_HEIGHT above the rim to a little below it.
  const board = h.x + h.side * (rimHalf + BOARD_GAP);
  if (y1 >= h.y - BOARD_HEIGHT && y1 <= h.y + BOARD_BELOW) {
    const before = x0 - board;
    const after = x1 - board;
    if ((before < -BALL_RADIUS && after >= -BALL_RADIUS) || (before > BALL_RADIUS && after <= BALL_RADIUS)) {
      Object.assign(b, { x: x0, y: y0, vx: -b.vx * restitution });
      sound(state, 'clank', b.weaponId);
      return true;
    }
  }
  return false;
}

/** A loose ball bounces off a tank (or a decoy): the first enemy it lands on takes the loose damage. */
function offTank(state: GameState, b: Basketball, weapon: WeaponOf<'hoop'>, t: Target, x: number, y: number): void {
  if (!b.hit && targetOwner(t) !== b.ownerId) {
    b.hit = true;
    applyHit(state, t, weapon, b.ownerId, scaled(state, b.ownerId, weapon.hoop.looseDamage), weapon.colour);
  }
  // Off the top of the hull, away from its middle.
  const at = targetPos(t);
  const away = Math.sign(x - at.x) || -Math.sign(b.vx) || 1;
  Object.assign(b, { x, y, vx: away * Math.max(40, Math.abs(b.vx) * 0.5), vy: -Math.max(80, Math.abs(b.vy) * weapon.hoop.restitution) });
  sound(state, 'dribble', b.weaponId, Math.hypot(b.vx, b.vy));
}

/** Bounce off the ground where the ball's edge touched it (cx, cy), from its last clear spot. Returns true once it's stopped. */
function offGround(state: GameState, b: Basketball, weapon: WeaponOf<'hoop'>, cx: number, cy: number, x: number, y: number): boolean {
  const n = state.terrain.normalAt(cx, cy);
  const e = weapon.hoop.restitution;
  const vn = b.vx * n.x + b.vy * n.y;
  if (vn < 0) {
    const tx = b.vx - vn * n.x;
    const ty = b.vy - vn * n.y;
    b.vx = tx * 0.9 - e * vn * n.x;
    b.vy = ty * 0.9 - e * vn * n.y;
  }
  b.x = x + n.x * 0.5;
  b.y = y + n.y * 0.5;
  b.bounces++;
  const speed = Math.hypot(b.vx, b.vy);
  if (speed > REST_SPEED) sound(state, 'dribble', b.weaponId, speed);
  return speed < REST_SPEED || b.bounces > MAX_BOUNCES;
}

/** A make: a moment on the rim, then straight down, faster and faster, until it blows up on what's below. */
function stepDunk(state: GameState, b: Basketball, weapon: WeaponOf<'hoop'>, dt: number): boolean {
  b.dunk! += dt;
  if (b.dunk! < DUNK_HANG) return false;
  b.vy += DUNK_ACCEL * dt;
  const ny = b.y + b.vy * dt;
  for (let y = b.y + 1; y <= ny + 1e-9; y += 1) {
    const target = targetAt(state, b.x, y);
    if (target) {
      // Through the middle of them: the whole blast.
      explode(state, b.x, targetPos(target).y - TANK_BODY_HEIGHT, weapon, b.ownerId);
      return true;
    }
    if (state.terrain.isSolid(b.x, y + BALL_RADIUS)) {
      explode(state, b.x, Math.min(y, state.terrain.height), weapon, b.ownerId);
      return true;
    }
  }
  b.y = ny;
  return false;
}

export const ballStepper: Stepper = {
  step(state, dt) {
    state.basketballs = state.basketballs.filter((b) => !stepBall(state, b, dt));
  },
  busy: (state) => state.basketballs.length > 0,
};

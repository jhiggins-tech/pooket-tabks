import { weaponOf } from '../weapons/registry';
import type { BunkerSpec, WeaponOf } from '../weapons/types';
import { hullRest } from './bodies';
import { TANK_BODY_HEIGHT, TANK_HALF_WIDTH } from './constants';
import { sound, spawnFloater } from './fx';
import type { Stepper } from './mechanics';
import type { Bunker, GameState, Player } from './state';

/**
 * ShotDownBoyz's Prepper: he drills into the ground (a pit, his tank sinking `sink` px), then a brick bunker
 * builds up round him, course by course from the ground up both sides (on footings down to the ground where it
 * falls away), over the top, leaving one slit
 * along his aim. The bricks are terrain (filled into empty pixels, in brick and mortar colours), so shells
 * hit them, blasts knock them out, a shot aimed outside the slit hits his own wall, and a hole blown through
 * is a hole. `Player.bunker` is where it is and how it's going; while it stands he can't drive
 * (statuses.ts `canMove`). It's down (`Player.bunker` null, the bricks left are just rubble) once fewer than
 * `standing` of its pixels are left at a turn's end. The falling bricks, dust and the dark inside:
 * render/draw/bunker.ts. After a snapshot (net/follow.ts) `repaintBunkers` puts the brick colours back.
 */

/** How far below the pivot's level the walls reach, each side (°), so they meet sloping ground. */
const FOOT = 10;
/** Half the width of the pit he drills (px). */
const PIT = TANK_HALF_WIDTH + 6;
/** How far below the pivot a footing reaches at most (px). */
const FOOTING = 40;
/** A gap of mortar this thick (px) between bricks. */
const MORTAR = 0.8;

const BRICK_COLOURS: readonly (readonly [number, number, number])[] = [
  [180, 85, 60],
  [168, 74, 51],
  [192, 96, 63],
  [156, 68, 48],
  [184, 90, 63],
];
const MORTAR_COLOUR = [222, 206, 178] as const;

/** The slit's direction for an aim: the aim, kept above the ground line (aiming down faces the nearer side). */
export function slitOf(angle: number): number {
  if (angle <= 180) return angle;
  return angle < 270 ? 180 : 0;
}

/** Course `k`'s ring: its radii, a brick's angular length (°), and its stagger (°). */
function course(spec: BunkerSpec, k: number): { r0: number; r1: number; step: number; offset: number } {
  const r0 = spec.inner + k * spec.course;
  const r1 = r0 + spec.course;
  const step = (spec.brick / ((r0 + r1) / 2)) * (180 / Math.PI);
  return { r0, r1, step, offset: k % 2 ? step / 2 : 0 };
}

/** When brick `index` of course `k` lands (s into the build): lowest first, both sides at once, keystones last. */
function landTime(spec: BunkerSpec, k: number, index: number): number {
  const { step, offset } = course(spec, k);
  const mid = -FOOT - offset + (index + 0.5) * step;
  const elev = Math.min(1, Math.max(0, Math.min(mid + FOOT, 180 + FOOT - mid) / (90 + FOOT)));
  return elev * (spec.buildTime - 0.45) + k * 0.06 + ((index * 7 + k * 3) % 5) * 0.015;
}

/** A brick, as the renderer drops it into place: its course, angles (°, either side of the slit), radii and landing time. */
export interface Brick {
  k: number;
  index: number;
  a0: number;
  a1: number;
  r0: number;
  r1: number;
  land: number;
}

/** Every brick of a bunker (cut where the slit is). */
export function bricksOf(b: Bunker): Brick[] {
  const spec = weaponOf(b.weaponId, 'bunker').bunker;
  const s0 = b.slit - spec.slit / 2;
  const s1 = b.slit + spec.slit / 2;
  const out: Brick[] = [];
  for (let k = 0; k < spec.courses; k++) {
    const { r0, r1, step, offset } = course(spec, k);
    for (let index = 0; -FOOT - offset + index * step < 180 + FOOT; index++) {
      const a0 = Math.max(-FOOT, -FOOT - offset + index * step);
      const a1 = Math.min(180 + FOOT, -FOOT - offset + (index + 1) * step);
      const land = landTime(spec, k, index);
      const pieces: [number, number][] = a1 <= s0 || a0 >= s1 ? [[a0, a1]] : [[a0, Math.min(a1, s0)], [Math.max(a0, s1), a1]];
      for (const [c0, c1] of pieces) {
        if (c1 - c0 > 1) out.push({ k, index, a0: c0, a1: c1, r0, r1, land });
      }
    }
  }
  return out;
}

/** The bunker's wall at pixel (x, y), if it has one there: when its brick lands, and its colour. */
function wallAt(b: Bunker, spec: BunkerSpec, x: number, y: number): { land: number; rgb: readonly [number, number, number]; footing: boolean } | null {
  const dx = x + 0.5 - b.x;
  const dy = b.y - (y + 0.5);
  const thick = spec.courses * spec.course;
  let a = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (a < -90) a += 360;
  if (Math.abs(a - b.slit) < spec.slit / 2) return null;
  if (a < -FOOT || a > 180 + FOOT) {
    // Below a foot: a footing straight down to the ground (it only fills air), so a wall on falling ground
    // doesn't hang over a gap.
    const side = Math.abs(dx) - spec.inner;
    if (side < 0 || side >= thick || dy > 0 || dy < -FOOTING) return null;
    const k = Math.floor(side / spec.course);
    const v = (-dy + (k % 2 ? spec.brick / 2 : 0)) / spec.brick;
    const index = Math.floor(v);
    const mortar = side - k * spec.course < MORTAR || Math.min(v - index, index + 1 - v) * spec.brick < MORTAR / 2;
    return { land: k * 0.06, rgb: mortar ? MORTAR_COLOUR : BRICK_COLOURS[(index * 3 + k * 2 + 1) % BRICK_COLOURS.length]!, footing: true };
  }
  const out = Math.hypot(dx, dy) - spec.inner;
  if (out < 0 || out >= thick) return null;
  const k = Math.floor(out / spec.course);
  const { r0, r1, step, offset } = course(spec, k);
  const u = (a + FOOT + offset) / step;
  const index = Math.floor(u);
  const along = Math.min(u - index, index + 1 - u) * ((step * Math.PI) / 180) * ((r0 + r1) / 2);
  const mortar = out - k * spec.course < MORTAR || along < MORTAR / 2;
  return { land: landTime(spec, k, index), rgb: mortar ? MORTAR_COLOUR : BRICK_COLOURS[(index * 3 + k * 2) % BRICK_COLOURS.length]!, footing: false };
}

/** The box round a bunker's walls: [x0, y0, x1, y1]. */
function wallBox(b: Bunker, spec: BunkerSpec): [number, number, number, number] {
  const r = spec.inner + spec.courses * spec.course;
  return [b.x - r - 1, b.y - r - 1, b.x + r + 1, b.y + FOOTING + 1];
}

/** How many pixels of a bunker's walls are still standing (the arch above the ground it was dug from: not the footings, nor soil). */
function wallLeft(state: GameState, b: Bunker, spec: BunkerSpec): number {
  const [x0, y0, x1] = wallBox(b, spec);
  let n = 0;
  for (let y = Math.max(0, Math.floor(y0)); y < b.ground; y++) {
    for (let x = Math.max(0, Math.floor(x0)); x <= x1; x++) if (wallAt(b, spec, x, y)?.footing === false && state.terrain.isSolid(x, y)) n++;
  }
  return n;
}

/** Prepper: dig in where he stands, the slit along his aim. */
export function fireBunker(state: GameState, p: Player, weapon: WeaponOf<'bunker'>): void {
  const spec = weapon.bunker;
  p.bunker = { weaponId: weapon.id, x: p.x, y: p.y + spec.sink - TANK_BODY_HEIGHT, ground: p.y, slit: slitOf(p.angle), elapsed: 0, bricks: 0 };
  sound(state, 'drill');
}

/** Drill, then lay whatever bricks land this tick. Returns true once it's built. */
function stepBunker(state: GameState, p: Player, b: Bunker, dt: number): boolean {
  const spec = weaponOf(b.weaponId, 'bunker').bunker;
  const { terrain } = state;
  const before = b.elapsed;
  b.elapsed = Math.min(spec.drillTime + spec.buildTime, b.elapsed + dt);
  if (before < spec.drillTime) {
    // The pit, a little deeper each tick, and the tank sinking into it.
    const floor = b.ground + spec.sink * Math.min(1, b.elapsed / spec.drillTime);
    terrain.carveRect(b.x - PIT, b.y - spec.inner, PIT * 2, floor - (b.y - spec.inner));
    p.y = hullRest(terrain, p.x, p.y);
    if (b.elapsed >= spec.drillTime) {
      // Room inside for the barrel: the half disc over the pivot.
      for (let y = Math.floor(b.y - spec.inner); y < b.y; y++) {
        const w = Math.sqrt(Math.max(0, spec.inner ** 2 - (b.y - y - 0.5) ** 2));
        terrain.carveRect(b.x - w, y, w * 2, 1);
      }
      p.y = hullRest(terrain, p.x, p.y);
    }
  }
  if (b.elapsed > spec.drillTime) {
    const t0 = before - spec.drillTime;
    const t1 = b.elapsed - spec.drillTime;
    const [x0, y0, x1, y1] = wallBox(b, spec);
    const laid = terrain.paint(x0, y0, x1, y1, (x, y) => {
      const w = wallAt(b, spec, x, y);
      return w && (t0 <= 0 ? w.land >= 0 : w.land > t0) && w.land <= t1 ? w.rgb : null;
    }, 'fill');
    if (laid > 0) sound(state, 'brick');
  }
  if (b.elapsed < spec.drillTime + spec.buildTime) return false;
  b.bricks = Math.max(1, wallLeft(state, b, spec));
  return true;
}

/** Whether a bunker is still drilling or building. */
function building(b: Bunker): boolean {
  const spec = weaponOf(b.weaponId, 'bunker').bunker;
  return b.elapsed < spec.drillTime + spec.buildTime;
}

/** At a turn's end: a bunker knocked down below `standing` of its walls (or whose tank is out) is gone. */
export function checkBunkers(state: GameState): void {
  for (const p of state.players) {
    const b = p.bunker;
    if (!b) continue;
    if (!p.alive) {
      p.bunker = null;
      continue;
    }
    const spec = weaponOf(b.weaponId, 'bunker').bunker;
    if (b.bricks === 0 || wallLeft(state, b, spec) >= spec.standing * b.bricks) continue;
    p.bunker = null;
    spawnFloater(state, b.x, b.y - spec.inner - 14, 'BUNKER DOWN', '#fca5a5');
    sound(state, 'bunker-down');
  }
}

/**
 * Brick colours back on every bunker's walls (above the ground it was dug from), after the terrain has
 * been patched from another phone's mask, which only knows solid from empty.
 */
export function repaintBunkers(state: GameState): void {
  for (const p of state.players) {
    const b = p.bunker;
    if (!b) continue;
    const spec = weaponOf(b.weaponId, 'bunker').bunker;
    const t = b.elapsed - spec.drillTime;
    const [x0, y0, x1, y1] = wallBox(b, spec);
    state.terrain.paint(x0, y0, x1, Math.min(y1, b.ground - 1), (x, y) => {
      const w = wallAt(b, spec, x, y);
      return w && w.land <= t ? w.rgb : null;
    }, 'recolour');
  }
}

export const bunkerStepper: Stepper = {
  step(state, dt) {
    for (const p of state.players) if (p.bunker && building(p.bunker)) stepBunker(state, p, p.bunker, dt);
  },
  busy: (state) => state.players.some((p) => p.bunker !== null && building(p.bunker)),
};

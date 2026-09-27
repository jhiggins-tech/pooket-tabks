import { getWeapon } from '../weapons/registry';
import type { WeaponDef } from '../weapons/types';
import { TANK_BODY_HEIGHT, TANK_HIT_RADIUS } from './constants';
import type { Boom, GameState, Player } from './state';
import { allTargets, damageTarget, gone, muzzle, scaled, targetKey, targetOwner, targetPos } from './tanks';

/** torikloud's Sonic Boom: waves of expanding arcs, and twin booms phasing where they overlap. */

export function fireSonic(state: GameState, p: Player, weapon: WeaponDef, gun: Player): void {
  const spec = weapon.sonic!;
  const m = muzzle(gun);
  state.booms.push({
    ownerId: p.id,
    weaponId: weapon.id,
    x: m.x,
    y: m.y,
    angle: (p.angle * Math.PI) / 180,
    range: spec.minRange + (spec.maxRange - spec.minRange) * (p.power / 100),
    elapsed: 0,
    hits: Array.from({ length: spec.waves }, () => []),
  });
}

/** Radius of each wave of a boom right now (negative = not emitted yet). */
export function boomRadii(b: Boom): number[] {
  const spec = getWeapon(b.weaponId).sonic!;
  return b.hits.map((_, k) => (b.elapsed - k * spec.interval) * spec.speed);
}

/**
 * Advance a boom's waves. Each wave hits each target (tank or hologram, never the owner's) once, as
 * its front sweeps past, if the target is inside the arc. Terrain doesn't stop it. Returns true once
 * the last wave has reached full range.
 */
export function stepBoom(state: GameState, b: Boom, dt: number): boolean {
  const spec = getWeapon(b.weaponId).sonic!;
  b.elapsed += dt;
  const radii = boomRadii(b);
  // Twins: another boom from the same player at the same time. Where their arcs cross, the waves
  // phase together: more range and focused damage.
  const siblings = state.booms.filter((o) => o !== b && o.ownerId === b.ownerId);
  for (const t of allTargets(state)) {
    if (gone(t) || targetOwner(t) === b.ownerId) continue;
    const pos = targetPos(t);
    const tx = pos.x;
    const ty = pos.y - TANK_BODY_HEIGHT;
    const d = Math.hypot(tx - b.x, ty - b.y);
    if (!inArc(b, spec, tx, ty)) continue;
    const phased = siblings.some((o) => inArc(o, spec, tx, ty) && Math.hypot(tx - o.x, ty - o.y) <= o.range * PHASE_RANGE);
    if (d > b.range * (phased ? PHASE_RANGE : 1)) continue;
    const key = targetKey(t);
    radii.forEach((r, k) => {
      if (r < d - TANK_HIT_RADIUS || b.hits[k]!.includes(key)) return;
      b.hits[k]!.push(key);
      const falloff = Math.min(1, spec.refDistance / Math.max(d, 1));
      const dmg = scaled(state, b.ownerId, spec.damage * falloff * (phased ? PHASE_FOCUS : 1));
      damageTarget(state, t, dmg, b.ownerId, phased ? '#ffffff' : (getWeapon(b.weaponId).colour ?? '#c9b6ff'));
    });
  }
  return radii[radii.length - 1]! >= b.range * (siblings.length > 0 ? PHASE_RANGE : 1);
}

/** Crossing waves from twin booms reach this much further… */
export const PHASE_RANGE = 1.5;

/** …and hit this much harder. */
export const PHASE_FOCUS = 1.5;

/** Whether (x, y) is inside a boom's arc (allowing for the width of a hull). */
function inArc(b: Boom, spec: { halfAngleDeg: number }, x: number, y: number): boolean {
  const dx = x - b.x;
  const dy = -(y - b.y);
  const d = Math.hypot(dx, dy);
  let off = Math.atan2(dy, dx) - b.angle;
  off = Math.atan2(Math.sin(off), Math.cos(off));
  return Math.abs(off) <= (spec.halfAngleDeg * Math.PI) / 180 + Math.atan2(TANK_HIT_RADIUS, Math.max(d, 1));
}

/**
 * The phased stretches of each twin boom's waves (cosmetic): runs of arc that pass through the
 * region the other boom's arc also covers, out to the phased range. Angles are canvas radians.
 */
export function boomPhaseArcs(state: GameState): { x: number; y: number; r: number; from: number; to: number; fade: number }[] {
  const out: { x: number; y: number; r: number; from: number; to: number; fade: number }[] = [];
  const SAMPLES = 24;
  for (const b of state.booms) {
    const siblings = state.booms.filter((o) => o !== b && o.ownerId === b.ownerId);
    if (siblings.length === 0) continue;
    const spec = getWeapon(b.weaponId).sonic!;
    const half = (spec.halfAngleDeg * Math.PI) / 180;
    const maxR = b.range * PHASE_RANGE;
    for (const r of boomRadii(b)) {
      if (r <= 2 || r > maxR) continue;
      let runStart: number | null = null;
      for (let i = 0; i <= SAMPLES; i++) {
        const a = b.angle - half + (2 * half * i) / SAMPLES; // maths angle
        const x = b.x + Math.cos(a) * r;
        const y = b.y - Math.sin(a) * r;
        const inside = siblings.some((o) => inArc(o, spec, x, y) && Math.hypot(x - o.x, y - o.y) <= o.range * PHASE_RANGE);
        if (inside && runStart === null) runStart = a;
        if ((!inside || i === SAMPLES) && runStart !== null) {
          const end = inside ? a : a - (2 * half) / SAMPLES;
          if (end > runStart) out.push({ x: b.x, y: b.y, r, from: -end, to: -runStart, fade: 1 - r / maxR });
          runStart = null;
        }
      }
    }
  }
  return out;
}

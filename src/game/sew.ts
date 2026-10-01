import { weaponOf } from '../weapons/registry';
import type { WeaponOf } from '../weapons/types';
import type { Stepper } from './mechanics';
import type { GameState, Player, Stitch } from './state';
import { applyHit, muzzle, scaled, targetAt, targetKey, targetOwner } from './tanks';

/** ciarra's Sew: a needle and thread stitched through the terrain. */

/** The needle's position after sewing `t` px: along the aim, zig-zagging either side of the line. */
export function stitchPoint(st: Stitch, amplitude: number, wavelength: number, t: number): { x: number; y: number } {
  const zig = Math.sin((t / wavelength) * Math.PI * 2) * amplitude; // weaving in and out, like running stitches
  const ux = Math.cos(st.angle);
  const uy = -Math.sin(st.angle);
  return { x: st.x0 + ux * t - uy * zig, y: st.y0 + uy * t + ux * zig };
}

/**
 * Sew along the line through anything, stitching (damaging and pinning) each enemy it passes through
 * and leaving stitch marks in the soil. The thread lingers a moment after. Returns true when finished.
 */
export function stepStitch(state: GameState, st: Stitch, dt: number): boolean {
  const weapon = weaponOf(st.weaponId, 'sew');
  const spec = weapon.sew;
  const { terrain } = state;
  if (st.done) {
    st.linger -= dt;
    return st.linger <= 0;
  }
  const to = Math.min(st.range, st.travelled + spec.speed * dt);
  for (let t = st.travelled + 1; t <= to; t += 1) {
    const pt = stitchPoint(st, spec.amplitude, spec.wavelength, t);
    if (pt.x < -20 || pt.x > terrain.width + 20 || pt.y < -200 || pt.y > terrain.height + 20) {
      st.done = true;
      break;
    }
    if (Math.round(t) % 3 === 0 && terrain.isSolid(pt.x, pt.y)) terrain.wetCircle(pt.x, pt.y, 1.3, [244, 114, 182]);
    const target = targetAt(state, pt.x, pt.y);
    if (target && targetOwner(target) !== st.ownerId && !st.hits.includes(targetKey(target))) {
      st.hits.push(targetKey(target));
      applyHit(state, target, weapon, st.ownerId, scaled(state, st.ownerId, spec.damage), weapon.colour);
    }
    if (Math.round(t) % 4 === 0) st.path.push(pt);
  }
  st.travelled = to;
  if (st.travelled >= st.range) st.done = true;
  return false;
}

/** Sew: a needle sets off from the barrel along the aim; power is how far it sews. */
export function fireSew(state: GameState, p: Player, weapon: WeaponOf<'sew'>): void {
  const spec = weapon.sew;
  const m = muzzle(p);
  state.stitches.push({
    ownerId: p.id,
    weaponId: weapon.id,
    x0: m.x,
    y0: m.y,
    angle: (p.angle * Math.PI) / 180,
    range: spec.minRange + (spec.maxRange - spec.minRange) * (p.power / 100),
    travelled: 0,
    path: [{ x: m.x, y: m.y }],
    hits: [],
    linger: 1.2,
    done: false,
  });
}

export const stitchStepper: Stepper = {
  step(state, dt) {
    state.stitches = state.stitches.filter((st) => !stepStitch(state, st, dt));
  },
  busy: (state) => state.stitches.length > 0,
};

import { getWeapon } from '../weapons/registry';
import { TANK_BODY_HEIGHT } from './constants';
import type { GameState, Stitch } from './state';
import { sound, spawnFloater } from './fx';
import { damageTarget, scaled, targetAt, targetKey, targetOwner, targetPos } from './tanks';

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
  const weapon = getWeapon(st.weaponId);
  const spec = weapon.sew!;
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
      damageTarget(state, target, scaled(state, st.ownerId, spec.damage), st.ownerId, weapon.colour);
      if (target.kind !== 'hologram' && target.player.alive) {
        target.player.pinned = { active: false };
        const c = targetPos(target);
        spawnFloater(state, c.x, c.y - TANK_BODY_HEIGHT - 10, 'PINNED', weapon.colour ?? '#f472b6');
        sound(state, 'pin');
      }
    }
    if (Math.round(t) % 4 === 0) st.path.push(pt);
  }
  st.travelled = to;
  if (st.travelled >= st.range) st.done = true;
  return false;
}

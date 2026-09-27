import { stitchPoint } from '../../game/game';
import type { Stitch } from '../../game/state';
import { getWeapon } from '../../weapons/registry';
import type { Draw } from './context';

/** ciarra's Sew: the needle and its stitched thread. */

/** Sew: pink thread with cross-stitches trailing a silver needle, fading once it stops. */
export function drawStitch(d: Draw, st: Stitch): void {
  const { ctx } = d;
  if (st.path.length < 2) return;
  const w = getWeapon(st.weaponId);
  const spec = w.sew!;
  ctx.save();
  ctx.globalAlpha = st.done ? Math.max(0, st.linger / 1.2) : 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(80,20,50,0.6)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  st.path.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
  ctx.stroke();
  ctx.strokeStyle = w.colour ?? '#f472b6';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  // Little stitch ticks across the thread.
  ctx.strokeStyle = '#ffd1e6';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  for (let i = 2; i < st.path.length; i += 3) {
    const a = st.path[i - 1]!;
    const b = st.path[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    ctx.moveTo(b.x - nx * 2.5, b.y - ny * 2.5);
    ctx.lineTo(b.x + nx * 2.5, b.y + ny * 2.5);
  }
  ctx.stroke();
  // The needle, pointing the way it's sewing.
  if (!st.done) {
    const head = stitchPoint(st, spec.amplitude, spec.wavelength, st.travelled);
    const prev = stitchPoint(st, spec.amplitude, spec.wavelength, Math.max(0, st.travelled - 3));
    ctx.translate(head.x, head.y);
    ctx.rotate(Math.atan2(head.y - prev.y, head.x - prev.x));
    ctx.strokeStyle = '#e8ecf6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(3, 0);
    ctx.stroke();
    ctx.strokeStyle = '#6b7390';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(-10, 0, 2, 0.9, 0, 0, Math.PI * 2); // the eye
    ctx.stroke();
  }
  ctx.restore();
}

import { boomerangPoint, CAP_REST } from '../../game/game';
import type { GameState } from '../../game/state';
import { weaponOf } from '../../weapons/registry';
import type { Draw } from './context';

/** kiwicore's flat cap: on his dome (draw/tank.ts), and spinning round its loop when thrown (the berètta M2), drawn bigger in flight to be seen. */

/**
 * A flat cap side on, brim towards `facing` (±1), its band's middle at (x, y): a low tweed crown sloping
 * forward to a short peak, a button on top.
 */
export function drawFlatCap(ctx: CanvasRenderingContext2D, x: number, y: number, facing: number, turn = 0, scale = 1): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(turn);
  ctx.scale(facing * scale, scale);
  ctx.beginPath();
  ctx.moveTo(-8, 2);
  ctx.bezierCurveTo(-9, -2, -6, -4.2, -1, -4);
  ctx.bezierCurveTo(4, -3.8, 7, -1.5, 8, 0);
  ctx.lineTo(12, 1.2); // the peak
  ctx.quadraticCurveTo(12.5, 2.4, 10, 2.6);
  ctx.lineTo(-8, 2.6);
  ctx.closePath();
  ctx.fillStyle = '#8a7a5c';
  ctx.strokeStyle = 'rgba(30,22,10,0.8)';
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();
  // Tweed: a couple of darker panel seams, and the band.
  ctx.strokeStyle = 'rgba(52,40,22,0.55)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-4, -3.4);
  ctx.quadraticCurveTo(-3, -0.5, -3.5, 2.2);
  ctx.moveTo(2.5, -3.3);
  ctx.quadraticCurveTo(3, -0.5, 2, 2.2);
  ctx.moveTo(-7.6, 1.4);
  ctx.lineTo(8.5, 1.4);
  ctx.stroke();
  ctx.fillStyle = '#5b4d34';
  ctx.beginPath();
  ctx.arc(-1, -4.1, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Thrown caps: spinning round the loop, a light streak of where it's just been. */
export function drawBoomerangs(d: Draw, state: GameState): void {
  const { ctx } = d;
  for (const b of state.boomerangs) {
    const { curl } = weaponOf(b.weaponId, 'boomerang').boomerang;
    const s = b.t / b.duration;
    const facing = Math.cos(b.angle) >= 0 ? 1 : -1;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    for (let k = 0; k <= 8; k++) {
      const pt = boomerangPoint(b, curl, Math.max(0, s - k * 0.008));
      if (k === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
    const at = boomerangPoint(b, curl, s);
    // Near home it's drawn lifting off (and settling back onto) his head.
    const lift = CAP_REST * Math.max(0, 1 - Math.hypot(at.x - b.x0, at.y - b.y0) / 24);
    drawFlatCap(ctx, at.x, at.y - lift, facing, -b.side * facing * b.t * 16, 1 + 0.5 * Math.min(1, Math.hypot(at.x - b.x0, at.y - b.y0) / 24));
    ctx.restore();
  }
}

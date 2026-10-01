import { boomPhaseArcs, boomRadii } from '../../game/game';
import type { GameState } from '../../game/state';
import { weaponOf } from '../../weapons/registry';
import type { Draw } from './context';

/** torikloud's Sonic Boom arcs and where twin booms phase. */

/** Sonic waves: nested arcs that fade as they spread, drawn over the terrain they pass through. */
export function drawBooms(d: Draw, state: GameState): void {
  const { ctx } = d;
  ctx.save();
  // Where twin booms' waves overlap they phase together: those stretches glow white and carry further.
  ctx.lineCap = 'round';
  for (const arc of boomPhaseArcs(state)) {
    const shimmer = 0.75 + 0.25 * Math.sin(d.time * 30 + arc.r * 0.2);
    ctx.globalAlpha = Math.min(1, arc.fade * 1.4) * shimmer;
    ctx.strokeStyle = 'rgba(235,225,255,0.35)';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(arc.x, arc.y, arc.r, arc.from, arc.to);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(arc.x, arc.y, arc.r, arc.from, arc.to);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  for (const b of state.booms) {
    const w = weaponOf(b.weaponId, 'sonic');
    const half = (w.sonic.halfAngleDeg * Math.PI) / 180;
    const colour = w.colour ?? '#c9b6ff';
    for (const r of boomRadii(b)) {
      if (r <= 2 || r > b.range) continue;
      const fade = 1 - r / b.range;
      const wobble = Math.sin(r * 0.15 + d.time * 20) * 1.2;
      const arc = (rr: number, style: string, width: number, alpha: number) => {
        ctx.globalAlpha = alpha * fade;
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.arc(b.x, b.y, Math.max(1, rr), -b.angle - half, -b.angle + half);
        ctx.stroke();
      };
      arc(r + wobble, colour, 10, 0.18);
      arc(r + wobble, colour, 3.5, 0.9);
      arc(r + wobble, '#ffffff', 1.2, 0.9);
      arc(r - 7, colour, 1.5, 0.5);
      arc(r - 13, colour, 1, 0.3);
    }
  }
  ctx.restore();
}

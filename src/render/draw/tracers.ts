import type { GameState, TracerMark } from '../../game/state';
import { glow } from './colour';
import type { Draw } from './context';

/**
 * doctorfox's Calculated: where its tracers landed, each with how many degrees off his aim it was fired
 * ("+20°": aim 20° higher to land there), until he fires again (game/projectiles.ts). A pulsing dot and a
 * little tag above it.
 */

/** How a mark's offset reads: "+10°", "−20°". */
export function markText(m: TracerMark): string {
  return `${m.offset > 0 ? '+' : '−'}${Math.abs(m.offset)}°`;
}

export function drawMarks(d: Draw, state: GameState): void {
  const { ctx } = d;
  if (state.fx.marks.length === 0) return;
  ctx.save();
  ctx.font = '800 11px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const m of state.fx.marks) {
    const pop = Math.min(1, m.age * 5);
    const pulse = 0.6 + 0.4 * Math.sin(d.time * 5 + m.offset);
    glow(ctx, m.x, m.y, 7 * pop, [
      [0, `rgba(255,255,255,${0.9 * pulse})`],
      [0.4, `rgba(103,232,249,${0.7 * pulse})`],
      [1, 'rgba(103,232,249,0)'],
    ]);
    // A thin stalk up to the tag, taller the further off the aim (so tags landing close together stack up).
    const tagY = m.y - (6 + 9 * Math.min(4, Math.round(Math.abs(m.offset) / 10))) * pop;
    ctx.globalAlpha = pop;
    ctx.strokeStyle = 'rgba(103,232,249,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(m.x, m.y - 2);
    ctx.lineTo(m.x, tagY + 5);
    ctx.stroke();
    const text = markText(m);
    ctx.strokeStyle = 'rgba(8,16,28,0.9)';
    ctx.lineWidth = 3;
    ctx.strokeText(text, m.x, tagY);
    ctx.fillStyle = '#a5f3fc';
    ctx.fillText(text, m.x, tagY);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

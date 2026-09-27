import { TANK_BODY_HEIGHT } from '../../game/constants';
import { STEAL_SPIN } from '../../game/game';
import type { GameState } from '../../game/state';
import type { Draw } from './context';

/** kie's Steal: the grabbing hand reaching over to the victim. */

/**
 * Steal: a dashed tether arcs from the thief to the victim, and a grabbing hand reaches over while the
 * roulette spins, then carries the stolen round home once it lands.
 */
export function drawHeist(d: Draw, state: GameState): void {
  const h = state.heist;
  const thief = h && state.players[h.thiefId];
  const victim = h && state.players[h.victimId];
  if (!h || !thief || !victim) return;
  const { ctx } = d;
  const a = { x: thief.x, y: thief.y - TANK_BODY_HEIGHT - 4 };
  const b = { x: victim.x, y: victim.y - TANK_BODY_HEIGHT - 4 };
  const c = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 50 - Math.abs(b.x - a.x) * 0.12 };
  const at = (s: number) => ({
    x: (1 - s) ** 2 * a.x + 2 * (1 - s) * s * c.x + s ** 2 * b.x,
    y: (1 - s) ** 2 * a.y + 2 * (1 - s) * s * c.y + s ** 2 * b.y,
  });
  ctx.save();
  ctx.strokeStyle = thief.colour;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.55 + 0.25 * Math.sin(d.time * 9);
  ctx.setLineDash([5, 6]);
  ctx.lineDashOffset = -d.time * 40;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  // Reach out (hovering, fidgeting over the victim), then haul the loot back.
  const reach = h.locked ? Math.max(0, 1 - (h.t - STEAL_SPIN) / 0.7) : Math.min(1, h.t / 0.7) * (0.96 + 0.04 * Math.sin(d.time * 14));
  const hand = at(reach);
  if (h.locked) {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = victim.colour;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(hand.x - 6, hand.y + 3, 12, 8, 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = thief.colour;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(hand.x, hand.y, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Grabby fingers.
  ctx.strokeStyle = thief.colour;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  const curl = h.locked ? 0.6 : 0.2 + 0.2 * Math.sin(d.time * 12);
  for (const f of [-1, -0.33, 0.33, 1]) {
    const ang = Math.PI / 2 + f * 0.7;
    const x0 = hand.x + Math.cos(ang) * 4;
    const y0 = hand.y + Math.sin(ang) * 4;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + Math.cos(ang - curl * f) * 3.5, y0 + Math.sin(ang - curl * f) * 3.5);
    ctx.stroke();
  }
  ctx.restore();
}

import type { GameState } from '../../game/state';
import type { Draw } from './context';

/** Explosions and floating damage numbers. */

export function drawFloaters(d: Draw, state: GameState): void {
  const { ctx } = d;
  ctx.save();
  ctx.font = '800 15px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const f of state.floaters) {
    const k = f.age / f.duration;
    ctx.globalAlpha = k < 0.35 ? 1 : Math.max(0, 1 - (k - 0.35) / 0.65);
    const scale = 0.8 + 0.4 * Math.min(1, k * 6); // quick pop-in
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(scale, scale);
    ctx.strokeStyle = 'rgba(10,12,24,0.85)';
    ctx.lineWidth = 3.5;
    ctx.strokeText(f.text, 0, 0);
    ctx.fillStyle = f.colour;
    ctx.fillText(f.text, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

export function drawExplosions(d: Draw, state: GameState): void {
  const { ctx } = d;
  for (const e of state.explosions) {
    const k = e.age / e.duration;
    if (e.ring) {
      // Hologram shimmer: a couple of expanding, fading rings with scan lines.
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = e.ring;
      ctx.lineWidth = 2;
      for (const f of [1, 0.6]) {
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius * (0.3 + k * f), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.5 * (1 - k);
      ctx.fillStyle = e.ring;
      for (let yy = -12; yy <= 8; yy += 4) ctx.fillRect(e.x - 14, e.y + yy + ((d.time * 40) % 4), 28, 1);
      ctx.restore();
      continue;
    }
    const r = e.radius * (0.5 + 0.7 * k);
    const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
    g.addColorStop(0, `rgba(255,245,200,${1 - k})`);
    g.addColorStop(0.4, `rgba(255,160,40,${0.9 * (1 - k)})`);
    g.addColorStop(1, 'rgba(200,40,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

import type { Droplet, GameState } from '../../game/state';
import { shade, tint, withAlpha } from './colour';
import type { Draw } from './context';

/** tones' ten-1: the water jet ribbon and its splashes. */

/**
 * Water jets: consecutive droplets from the same stream are joined into one continuous,
 * pressure-thickened ribbon (glow, body, core, highlight), breaking into beads where they separate.
 */
export function drawLiquid(d: Draw, state: GameState): void {
  const { ctx } = d;
  const drops = state.droplets;
  if (drops.length === 0 && state.splashes.length === 0) return;
  const colour = drops[0]?.colour ?? state.splashes[0]?.colour ?? '#3fb6ff';
  const width = (d: Droplet) => 1.5 + 5.5 * d.pressure;
  const JOIN_DIST = 14;

  // Link each droplet to the previous one in emission order if they're still close and heading the
  // same way (a sputtering spray flies apart, so it shows as beads rather than a scribble).
  const heading = (d: Droplet) => Math.atan2(d.vy, d.vx);
  const linked: boolean[] = new Array(drops.length).fill(false);
  const joins: [Droplet, Droplet][] = [];
  for (let i = 1; i < drops.length; i++) {
    const a = drops[i - 1]!;
    const b = drops[i]!;
    const turn = Math.abs(((heading(a) - heading(b) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    if (a.streamId === b.streamId && Math.hypot(a.x - b.x, a.y - b.y) < JOIN_DIST && turn < 0.12) {
      joins.push([a, b]);
      linked[i - 1] = linked[i] = true;
    }
  }

  const passes = [
    { style: withAlpha(colour, 0.18), scale: 2.4, dy: 0 },
    { style: shade(colour, 0.55), scale: 1, dy: 0 },
    { style: colour, scale: 0.62, dy: -0.15 },
    { style: 'rgba(255,255,255,0.75)', scale: 0.22, dy: -0.45 },
  ];
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const pass of passes) {
    // Bucket segments by thickness so each pass is a handful of strokes, not hundreds.
    const buckets = new Map<number, [Droplet, Droplet][]>();
    for (const j of joins) {
      const w = Math.round(Math.min(width(j[0]), width(j[1])) * 2) / 2;
      let list = buckets.get(w);
      if (!list) buckets.set(w, (list = []));
      list.push(j);
    }
    ctx.strokeStyle = pass.style;
    for (const [w, list] of buckets) {
      ctx.lineWidth = w * pass.scale;
      const off = w * pass.dy;
      ctx.beginPath();
      for (const [a, b] of list) {
        ctx.moveTo(a.x, a.y + off);
        ctx.lineTo(b.x, b.y + off);
      }
      ctx.stroke();
    }
    // Loose beads
    ctx.fillStyle = pass.style;
    ctx.beginPath();
    drops.forEach((d, i) => {
      if (linked[i]) return;
      const r = Math.max(0.6, (width(d) * pass.scale) / 2);
      ctx.moveTo(d.x + r, d.y + width(d) * pass.dy);
      ctx.arc(d.x, d.y + width(d) * pass.dy, r, 0, Math.PI * 2);
    });
    ctx.fill();
  }

  // Spray
  for (const sp of state.splashes) {
    ctx.globalAlpha = 1 - sp.age / sp.life;
    ctx.fillStyle = tint(sp.colour, 0.45);
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

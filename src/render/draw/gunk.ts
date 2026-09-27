import type { GameState } from '../../game/state';
import { getWeapon } from '../../weapons/registry';
import { noise } from './colour';
import type { Draw } from './context';

/** Mud and sludge in flight, and toxic puddles. */

/** Gunk in flight: mud clumps for ten-2's propellant, chunky spew for ten-3. */
export function drawSludge(d: Draw, state: GameState): void {
  if (state.sludge.length === 0) return;
  const mud = state.sludge.filter((s) => getWeapon(s.weaponId).gunk?.look !== 'spew');
  const spew = state.sludge.filter((s) => getWeapon(s.weaponId).gunk?.look === 'spew');
  drawClumps(d, mud, ['#5c3d22', '#6e4a2a', '#7d5632', '#4d321c'], '#2e1d10', 'rgba(220,190,150,0.7)', 1.5, 1.9);
  // Chunky: bigger, lumpier, in bile yellows and oranges with darker bits.
  drawClumps(d, spew, ['#e8b84e', '#d99a3a', '#c7b24a', '#b8742a'], '#6b4a16', 'rgba(255,250,215,0.85)', 2, 2.6);
}

/** Irregular clumps in a few shades, darker rims and the odd glossy highlight, stretched along their motion. */
export function drawClumps(
  d: Draw,
  parts: GameState['sludge'],
  shades: readonly string[],
  rim: string,
  shine: string,
  minR: number,
  extraR: number,
): void {
  if (parts.length === 0) return;
  const { ctx } = d;
  ctx.save();
  for (let pass = 0; pass < 3; pass++) {
    for (const [idx, shade] of shades.entries()) {
      ctx.beginPath();
      for (const s of parts) {
        if (Math.floor(s.look * shades.length) !== idx) continue;
        const r = minR + s.look * extraR;
        const a = Math.atan2(s.vy, s.vx);
        if (pass === 0) {
          ctx.moveTo(s.x + r + 0.8, s.y);
          ctx.ellipse(s.x, s.y, r * 1.3 + 0.8, r + 0.8, a, 0, Math.PI * 2);
        } else if (pass === 1) {
          ctx.moveTo(s.x + r, s.y);
          ctx.ellipse(s.x, s.y, r * 1.3, r, a, 0, Math.PI * 2);
        } else if (s.look > 0.6) {
          ctx.moveTo(s.x + 0.8, s.y - r * 0.4);
          ctx.arc(s.x - r * 0.3, s.y - r * 0.4, 0.8, 0, Math.PI * 2);
        }
      }
      ctx.fillStyle = pass === 0 ? rim : pass === 1 ? shade : shine;
      ctx.fill();
    }
  }
  ctx.restore();
}

/** ten-3's toxic sludge: a glowing, bubbling coat on the ground that fades as the turn ends. */
export function drawPuddles(d: Draw, state: GameState): void {
  if (state.puddles.length === 0) return;
  const { ctx } = d;
  ctx.save();
  for (const p of state.puddles) {
    const life = 1 - p.age / p.ttl;
    const alpha = Math.min(1, life * 2.5);
    // Glow
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius + 5);
    g.addColorStop(0, `rgba(182,240,74,${0.55 * alpha})`);
    g.addColorStop(1, 'rgba(120,200,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius + 5, 0, Math.PI * 2);
    ctx.fill();
    // Slick coat hugging the surface
    ctx.globalAlpha = 0.85 * alpha;
    ctx.fillStyle = '#7fb31f';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.radius, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c8f25a';
    ctx.beginPath();
    ctx.ellipse(p.x - 1, p.y - 0.8, p.radius * 0.6, 1, 0, 0, Math.PI * 2);
    ctx.fill();
    // Bubbles rising and popping
    const seed = p.x * 0.73 + p.y * 1.31;
    for (let i = 0; i < 2; i++) {
      const phase = (d.time * 1.4 + noise(seed + i * 7)) % 1;
      const bx = p.x + (noise(seed + i * 3) - 0.5) * p.radius * 1.6;
      ctx.globalAlpha = alpha * (1 - phase);
      ctx.strokeStyle = '#d9ff7a';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(bx, p.y - 2 - phase * 9, 0.8 + phase * 1.6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

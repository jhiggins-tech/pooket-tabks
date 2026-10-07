import type { Apparition, GameState } from '../../game/state';
import type { Draw } from './context';
import { glow } from './colour';
import { spriteReady } from '../sprites';

/** Sky apparitions (the kookaburra in parting clouds). */

/**
 * torikloud's kookaburra: clouds part like a sunrise, a glowing kookaburra looks down from a burst
 * of golden rays, then it all fades back into the sky.
 */
export function drawApparition(d: Draw, a: Apparition): void {
  const { ctx } = d;
  const k = a.age / a.duration;
  const ease = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
  const reveal = ease(k / 0.35);
  const alpha = k < 0.8 ? reveal : Math.max(0, 1 - (k - 0.8) / 0.2);
  ctx.save();
  ctx.translate(a.x, a.y);

  // Sun glow and slowly turning rays.
  ctx.globalAlpha = alpha;
  glow(
    ctx,
    0,
    0,
    70,
    [
      [0, 'rgba(255,236,170,0.95)'],
      [0.35, 'rgba(255,196,90,0.45)'],
      [1, 'rgba(255,170,60,0)'],
    ],
    4,
  );
  ctx.save();
  ctx.rotate(d.time * 0.25);
  ctx.fillStyle = 'rgba(255,214,120,0.22)';
  for (let i = 0; i < 12; i++) {
    ctx.rotate((Math.PI * 2) / 12);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(95, -7);
    ctx.lineTo(95, 7);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // The kookaburra, rising slightly into view with a golden halo.
  const sprite = d.sprites.kookaburra;
  if (spriteReady(sprite)) {
    const s = 0.85 + 0.15 * reveal;
    const bob = Math.sin(d.time * 2) * 1.5 + (1 - reveal) * 10;
    ctx.save();
    ctx.shadowColor = 'rgba(255,215,120,0.9)';
    ctx.shadowBlur = 14;
    ctx.drawImage(sprite.image, (-sprite.width * s) / 2, (-sprite.height * s) / 2 + bob, sprite.width * s, sprite.height * s);
    ctx.restore();
  }

  // Clouds drifting apart to reveal it, then melting away.
  ctx.globalAlpha = Math.min(1, (1 - reveal) * 0.6 + 0.4) * (k < 0.8 ? 1 : alpha);
  for (const side of [-1, 1]) {
    const cx = side * (8 + 70 * reveal);
    for (const [dx, dy, r] of [
      [0, 6, 16],
      [side * 14, 2, 13],
      [side * -12, 10, 12],
      [side * 26, 9, 10],
    ] as const) {
      const g = ctx.createRadialGradient(cx + dx, dy + 2, 2, cx + dx, dy + 2, r);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.7, 'rgba(226,232,245,0.9)');
      g.addColorStop(1, 'rgba(200,210,230,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx + dx, dy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Apparitions in the sky (behind the hills). */
export function drawApparitions(d: Draw, state: GameState): void {
  for (const a of state.fx.apparitions) drawApparition(d, a);
}

import { WALKER_BODY } from '../../game/game';
import type { GameState, Projectile } from '../../game/state';
import { projectileWeapon } from '../../weapons/registry';
import { glow, withAlpha } from './colour';
import type { Draw } from './context';
import { spriteReady } from '../sprites';

/** Projectiles (sprites, letters, plain shells) and laser beams. */

export function drawProjectiles(d: Draw, state: GameState): void {
  const { ctx } = d;
  for (const pr of state.projectiles) {
    if (pr.wait !== undefined) continue; // (still in the barrel)
    if (projectileWeapon(pr.weaponId).straight) {
      drawStreak(d, pr);
      continue;
    }
    if (pr.tracer !== undefined) {
      drawTracer(d, pr);
      continue;
    }
    if (projectileWeapon(pr.weaponId).plasma) {
      drawPlasma(d, pr);
      continue;
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    pr.trail.forEach((t, i) => {
      if (i % 3) return;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    });
    if (pr.glyph) {
      drawGlyph(d, pr);
    } else if (!drawSprite(d, pr)) {
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Calculated's tracers: a thin bright streak along the last bit of the path, and a hot dot. */
function drawTracer(d: Draw, pr: Projectile): void {
  const { ctx } = d;
  const t = pr.trail;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(165,243,252,0.55)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  const from = Math.max(0, t.length - 10);
  t.slice(from).forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.lineTo(pr.x, pr.y);
  ctx.stroke();
  ctx.fillStyle = '#ecfeff';
  ctx.beginPath();
  ctx.arc(pr.x, pr.y, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A straight round (the Autocannon Sentry's): a long glowing tracer streak behind it, along its line. */
function drawStreak(d: Draw, pr: Projectile): void {
  const { ctx } = d;
  const colour = projectileWeapon(pr.weaponId).colour ?? '#fde68a';
  const v = Math.hypot(pr.vx, pr.vy) || 1;
  const len = Math.min(26, pr.age * v);
  const tx = pr.x - (pr.vx / v) * len;
  const ty = pr.y - (pr.vy / v) * len;
  ctx.save();
  ctx.lineCap = 'round';
  const g = ctx.createLinearGradient(tx, ty, pr.x, pr.y);
  g.addColorStop(0, withAlpha(colour, 0));
  g.addColorStop(1, withAlpha(colour, 0.9));
  ctx.strokeStyle = g;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(pr.x, pr.y);
  ctx.stroke();
  ctx.strokeStyle = '#fffbeb';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(pr.x - (pr.vx / v) * len * 0.4, pr.y - (pr.vy / v) * len * 0.4);
  ctx.lineTo(pr.x, pr.y);
  ctx.stroke();
  ctx.restore();
}

/** Calculated's plasma: a glowing ball in the weapon's colour, crackling, with a fading glow behind it. */
function drawPlasma(d: Draw, pr: Projectile): void {
  const { ctx } = d;
  const colour = projectileWeapon(pr.weaponId).colour ?? '#22d3ee';
  pr.trail.forEach((p, i) => {
    if (i % 2) return;
    const k = i / pr.trail.length;
    glow(ctx, p.x, p.y, 2 + 3 * k, [
      [0, withAlpha(colour, 0.35 * k)],
      [1, withAlpha(colour, 0)],
    ]);
  });
  const flicker = 1 + 0.15 * Math.sin(d.time * 40 + pr.age * 13);
  glow(ctx, pr.x, pr.y, 11 * flicker, [
    [0, 'rgba(255,255,255,1)'],
    [0.25, withAlpha(colour, 0.95)],
    [0.6, withAlpha(colour, 0.35)],
    [1, withAlpha(colour, 0)],
  ]);
}

/** Debate: each round is a letter, tumbling through the air. */
export function drawGlyph(d: Draw, pr: Projectile): void {
  const { ctx } = d;
  const spin = projectileWeapon(pr.weaponId).spin ?? 0;
  ctx.save();
  ctx.translate(pr.x, pr.y);
  ctx.rotate(pr.age * spin * (pr.vx < 0 ? -1 : 1));
  ctx.font = '900 16px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = 'rgba(20,16,40,0.9)';
  ctx.strokeText(pr.glyph!.toUpperCase(), 0, 0);
  ctx.fillStyle = pr.glyphColour ?? '#fff';
  ctx.fillText(pr.glyph!.toUpperCase(), 0, 0);
  ctx.restore();
}

/**
 * Draws the weapon's sprite: pointing along the velocity by default, tumbling about its centre
 * for `spin` weapons, or upright and scurrying for walkers on the ground.
 * Returns false if there isn't one (yet).
 */
export function drawSprite(d: Draw, pr: Projectile): boolean {
  const weapon = projectileWeapon(pr.weaponId);
  const variants = weapon.spriteVariants;
  const id = variants?.length ? variants[(pr.variant ?? 0) % variants.length] : weapon.sprite;
  const sprite = id ? d.sprites[id] : undefined;
  if (!spriteReady(sprite)) return false;
  const { ctx } = d;
  const { width: w, height: h } = sprite;
  ctx.save();
  if (pr.walkDir !== 0) {
    // Scurrying: upright, facing its walk direction, with a quick bob.
    const bob = Math.abs(Math.sin(pr.walkTime * 22)) * 1.6;
    ctx.translate(pr.x, pr.y - WALKER_BODY - bob);
    ctx.scale(pr.walkDir, 1);
    ctx.rotate(Math.sin(pr.walkTime * 22) * 0.06);
    ctx.drawImage(sprite.image, -w / 2, -h / 2 - 0.5, w, h);
  } else if (weapon.spin) {
    ctx.translate(pr.x, pr.y);
    ctx.rotate(pr.age * weapon.spin * (pr.vx < 0 ? -1 : 1));
    ctx.scale(pr.vx < 0 ? -1 : 1, 1);
    ctx.drawImage(sprite.image, -w / 2, -h / 2, w, h);
  } else {
    ctx.translate(pr.x, pr.y);
    ctx.rotate(Math.atan2(pr.vy, pr.vx));
    // Anchor near the tip so the sprite's nose sits on the collision point.
    ctx.drawImage(sprite.image, -w * 0.85, -h / 2, w, h);
  }
  ctx.restore();
  return true;
}

export function drawBeams(d: Draw, state: GameState): void {
  const { ctx } = d;
  ctx.save();
  ctx.lineCap = 'round';
  for (const b of state.beams) {
    const k = b.age / b.duration;
    const fade = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    const flicker = 0.85 + 0.15 * Math.sin(d.time * 90);
    ctx.globalAlpha = fade * flicker;
    ctx.strokeStyle = withAlpha(b.colour, 0.35);
    ctx.lineWidth = 9;
    line(d, b.x1, b.y1, b.x2, b.y2);
    ctx.strokeStyle = b.colour;
    ctx.lineWidth = 3.5;
    line(d, b.x1, b.y1, b.x2, b.y2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.2;
    line(d, b.x1, b.y1, b.x2, b.y2);
    // Impact flare
    glow(ctx, b.x2, b.y2, b.hitTank ? 16 : 10, [
      [0, 'rgba(255,255,255,0.95)'],
      [0.4, withAlpha(b.colour, 0.8)],
      [1, withAlpha(b.colour, 0)],
    ]);
  }
  ctx.restore();
}

export function line(d: Draw, x1: number, y1: number, x2: number, y2: number): void {
  d.ctx.beginPath();
  d.ctx.moveTo(x1, y1);
  d.ctx.lineTo(x2, y2);
  d.ctx.stroke();
}

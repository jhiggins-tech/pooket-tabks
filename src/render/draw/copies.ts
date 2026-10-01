import { TANK_BODY_HEIGHT } from '../../game/constants';
import type { GameState, HologramBlast } from '../../game/state';
import { glow, noise, withAlpha } from './colour';
import type { Draw } from './context';
import { drawGlitchedTank } from './tank';

/**
 * A hologram blowing up (game/copies.ts): it overloads (swells and glitches out), bursts in a white-hot
 * flash with a double shockwave (cyan and magenta, slightly out of register), and sprays pixel shards
 * and tumbling chunks of the tank (its colour) that arc down and flicker out, with glitch bars tearing
 * across it. The blast's fireball is drawn as any other explosion's.
 */

const CYAN = '#7cf7d4';
const MAGENTA = '#ff6bd6';
const SHARD_COLOURS = [CYAN, MAGENTA, '#ffffff', '#4ea8ff'];
const SHARDS = 32;
const CHUNKS = 7;
/** How long the overload lasts before it bursts (seconds). */
const OVERLOAD = 0.16;
const GRAVITY = 260;

export function drawHologramBlasts(d: Draw, state: GameState): void {
  for (const b of state.fx.holoBlasts) drawBlast(d, state, b);
}

function drawBlast(d: Draw, state: GameState, b: HologramBlast): void {
  const { ctx } = d;
  const t = b.age;
  const k = b.age / b.duration;
  const cx = b.x;
  const cy = b.y - TANK_BODY_HEIGHT;
  const r = Math.max(12, b.radius);
  const seed = b.x * 7.31 + b.y * 3.17;
  const tick = Math.floor(d.time * 30);
  ctx.save();

  // Overload: the copy swells and tears apart, then it's gone.
  const owner = state.players[b.ownerId];
  if (owner && t < OVERLOAD) {
    const a = t / OVERLOAD;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1 + 0.35 * a, 1 + 0.2 * a);
    ctx.translate(-cx, -cy);
    drawGlitchedTank(d, owner, state, b, 1 + 2 * a, 1, 1 - 0.4 * a);
    ctx.restore();
  }

  // The burst: a white-hot core going cyan.
  const burst = Math.max(0, t - OVERLOAD * 0.6);
  if (burst < 0.35) {
    const e = burst / 0.35;
    const fr = r * (0.6 + 1.8 * Math.sqrt(e));
    glow(ctx, cx, cy, fr, [
      [0, withAlpha('#ffffff', 1 - e)],
      [0.45, withAlpha(CYAN, 0.85 * (1 - e))],
      [1, withAlpha(CYAN, 0)],
    ]);
  }

  // Shockwave: two rings, a little out of register.
  const ease = 1 - (1 - k) ** 3;
  ctx.globalAlpha = 1 - k;
  ctx.lineWidth = 0.5 + 3 * (1 - k);
  for (const [colour, dx] of [[CYAN, -1.5], [MAGENTA, 1.5]] as const) {
    ctx.strokeStyle = colour;
    ctx.beginPath();
    ctx.arc(cx + dx * (1 - k), cy, r * (0.4 + 2.4 * ease), 0, Math.PI * 2);
    ctx.stroke();
  }

  // Pixel shards: thrown out (mostly upwards), falling, flickering out.
  for (let i = 0; i < SHARDS; i++) {
    const angle = -Math.PI * (0.08 + 0.84 * noise(seed + i * 1.7)) - (noise(seed + i * 9.1) < 0.25 ? Math.PI * 0.9 : 0);
    const speed = 110 + 190 * noise(seed + i * 3.3);
    const life = 0.55 + 0.4 * noise(seed + i * 5.9);
    const age = Math.max(0, t - OVERLOAD * 0.5);
    if (age > life * b.duration) continue;
    const x = cx + Math.cos(angle) * speed * age;
    const y = cy + Math.sin(angle) * speed * age + 0.5 * GRAVITY * age * age;
    const fade = 1 - age / (life * b.duration);
    ctx.globalAlpha = fade * (noise(i * 2.3 + tick) < 0.15 ? 0.3 : 1);
    ctx.fillStyle = SHARD_COLOURS[i % SHARD_COLOURS.length]!;
    const size = 2 + 4 * fade;
    ctx.fillRect(Math.round(x - size / 2), Math.round(y - size / 2), size, size);
  }

  // Chunks of the tank itself, tumbling.
  if (owner) {
    for (let i = 0; i < CHUNKS; i++) {
      const angle = -Math.PI * (0.15 + 0.7 * noise(seed + i * 11.3));
      const speed = 70 + 110 * noise(seed + i * 6.1);
      const age = Math.max(0, t - OVERLOAD);
      if (age <= 0 || age > b.duration * 0.8) continue;
      const fade = 1 - age / (b.duration * 0.8);
      ctx.save();
      ctx.translate(cx + Math.cos(angle) * speed * age, cy + Math.sin(angle) * speed * age + 0.5 * GRAVITY * age * age);
      ctx.rotate((noise(seed + i) - 0.5) * 24 * age);
      ctx.globalAlpha = fade;
      ctx.fillStyle = i % 3 === 0 ? CYAN : owner.colour;
      ctx.fillRect(-4, -2.5, 8, 5);
      ctx.restore();
    }
  }

  // Glitch bars tearing across it, early on.
  if (t < 0.45) {
    const g = 1 - t / 0.45;
    for (let i = 0; i < 5; i++) {
      const n = noise(seed + i * 4.1 + tick * 0.7);
      ctx.globalAlpha = 0.7 * g;
      ctx.fillStyle = i % 2 ? MAGENTA : CYAN;
      const w = r * (0.8 + 1.8 * n);
      ctx.fillRect(cx - w / 2 + (n - 0.5) * 16, cy + (noise(seed + i * 7.7 + tick) - 0.5) * r * 1.6, w, 1.5 + 2 * n);
    }
  }
  ctx.restore();
}

/** Holograms whose owner is out, phasing away: tearing apart, flattening to a line and fading. */
export function drawGhosts(d: Draw, state: GameState): void {
  for (const g of state.fx.ghosts) {
    const owner = state.players[g.ownerId];
    if (!owner) continue;
    const k = g.age / g.duration;
    drawGlitchedTank(d, owner, state, g, 0.4 + k, 1, 1 - k, 1 - k * 0.9);
  }
}

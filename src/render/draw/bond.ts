import { BARREL_LENGTH, TANK_BODY_HEIGHT, TANK_HALF_WIDTH } from '../../game/constants';
import { BARREL } from '../../game/game';
import type { GameState, GunBarrel } from '../../game/state';
import type { Draw } from './context';

/**
 * garyoldmancorp's 007 (game/bond.ts): the gun barrel. The screen goes dark and a white dot slides across
 * to the enemy, leaving dots behind it; it opens into the view down a rifled barrel, bright inside, with
 * their tank silhouetted in black in the middle, swaying a little as the barrel tracks it while the sting
 * plays. On the shot, red runs down from the top of the barrel and it all fades away.
 */

/** The barrel's opening once it's open (world px), and how long it takes to open (s). */
const HOLE = 44;
const OPENING = 0.35;
/** How far the dot comes from (px, left of the target), and how far apart the dots it leaves are. */
const DOT_RUN = 320;
const DOT_GAP = 64;
/** How long the dark takes to come down, and to lift after the shot (s). */
const FADE_IN = 0.25;
/** Rifling grooves down the barrel. */
const GROOVES = 9;

export function drawBarrel(d: Draw, state: GameState): void {
  const b = state.barrel;
  if (!b || b.t < BARREL.dots) return;
  const { ctx } = d;
  const t = b.t;
  const dark = Math.min(1, (t - BARREL.dots) / FADE_IN) * (t < BARREL.shot ? 1 : Math.max(0, 1 - (t - BARREL.shot) / (BARREL.end - BARREL.shot)));
  if (dark <= 0) return;
  const cx = b.x + (t > BARREL.open ? Math.sin((t - BARREL.open) * 1.6) * 5 : 0);
  const cy = b.y - TANK_BODY_HEIGHT;
  const open = Math.min(1, Math.max(0, (t - BARREL.open) / OPENING));
  const r = t < BARREL.open ? 0 : 5 + (HOLE - 5) * (1 - (1 - open) ** 3);
  const W = state.terrain.width;
  const H = state.terrain.height;

  ctx.save();
  ctx.globalAlpha = dark;
  // The dark, with the barrel's opening cut out of it once it's open.
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.rect(-W, -H, W * 3, H * 3);
  if (r > 0) ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
  ctx.fill('evenodd');

  if (t < BARREL.open) {
    drawDots(ctx, b, (t - BARREL.dots) / (BARREL.open - BARREL.dots));
  } else {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    drawBore(ctx, cx, cy, r, t);
    drawSilhouette(ctx, state, b, open);
    if (t >= BARREL.shot) drawRedRun(ctx, cx, cy, r, (t - BARREL.shot) / (BARREL.end - BARREL.shot));
    ctx.restore();
  }
  ctx.restore();
}

/** The white dot sliding across to the target (`k`: 0 to 1), the dots it's passed left glowing behind it. */
function drawDots(ctx: CanvasRenderingContext2D, b: GunBarrel, k: number): void {
  const y = b.y - TANK_BODY_HEIGHT;
  const x = b.x - DOT_RUN * (1 - Math.min(1, k * 1.15));
  const alpha = ctx.globalAlpha;
  ctx.fillStyle = '#fff';
  ctx.globalAlpha = alpha * 0.7;
  for (let left = b.x - DOT_RUN; left < x - 1; left += DOT_GAP) {
    ctx.beginPath();
    ctx.arc(left, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = alpha;
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

/** Down the barrel: bright in the middle, the steel darkening to the rim, the rifling turning slowly. */
function drawBore(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, t: number): void {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.55, '#e8e8ec');
  g.addColorStop(0.8, '#9a9aa4');
  g.addColorStop(1, '#2a2a30');
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  // The grooves spiral in from the rim, the whole barrel turning as it tracks them.
  ctx.strokeStyle = 'rgba(30,30,36,0.45)';
  ctx.lineWidth = 2.2;
  const turn = (t - BARREL.open) * 0.5;
  for (let i = 0; i < GROOVES; i++) {
    const a = turn + (i / GROOVES) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.quadraticCurveTo(cx + Math.cos(a + 0.35) * r * 0.75, cy + Math.sin(a + 0.35) * r * 0.75, cx + Math.cos(a + 0.55) * r * 0.55, cy + Math.sin(a + 0.55) * r * 0.55);
    ctx.stroke();
  }
}

/** Their tank, in black (the barrel at its aim), coming out of the glare as the barrel opens. */
function drawSilhouette(ctx: CanvasRenderingContext2D, state: GameState, b: GunBarrel, open: number): void {
  const m = b.mark;
  const owner = state.players[m.kind === 'tank' ? m.playerId : (state.holograms.find((h) => h.id === m.id)?.ownerId ?? -1)];
  const angle = m.kind === 'tank' && m.twin && owner?.twin ? owner.twin.angle : (owner?.angle ?? 90);
  const a = (angle * Math.PI) / 180;
  const cy = b.y - TANK_BODY_HEIGHT;
  ctx.save();
  ctx.globalAlpha *= open;
  ctx.fillStyle = '#050505';
  ctx.strokeStyle = '#050505';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(b.x, cy);
  ctx.lineTo(b.x + Math.cos(a) * BARREL_LENGTH, cy - Math.sin(a) * BARREL_LENGTH);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(b.x, cy, 7, Math.PI, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(b.x - TANK_HALF_WIDTH, b.y - TANK_BODY_HEIGHT, TANK_HALF_WIDTH * 2, TANK_BODY_HEIGHT, 3);
  ctx.fill();
  ctx.restore();
}

/** The shot: red running down the barrel from the top (`k`: 0 to 1, over the fade). */
function drawRedRun(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, k: number): void {
  const down = Math.min(1, k * 1.6);
  ctx.fillStyle = '#b10e17';
  ctx.beginPath();
  const top = cy - r;
  const edge = top + r * 2 * down;
  ctx.moveTo(cx - r, top);
  ctx.lineTo(cx + r, top);
  // A wavy front, as if it's running.
  for (let i = 8; i >= 0; i--) {
    const x = cx - r + (i / 8) * r * 2;
    ctx.lineTo(x, edge + Math.sin(i * 1.9) * 4 * down);
  }
  ctx.closePath();
  ctx.fill();
}

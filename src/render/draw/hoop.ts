import { BALL_RADIUS, BOARD_HEIGHT, currentPlayer, hoopFor, isHoop } from '../../game/game';
import type { Basketball, GameState, Hoop } from '../../game/state';
import { weaponOf } from '../../weapons/registry';
import type { Draw } from './context';

/**
 * Hoop Dreamz (game/hoop.ts): the hoop over the enemy (showing while it's selected, and for the shot),
 * popping in and fading out after; the ball, spinning as it flies, and its slam. The rim's back half and
 * the backboard are drawn behind the ball (`drawHoopBack`), its front half and the net over it
 * (`drawHoopFront`), so a make drops through.
 */

/** How long the hoop takes to pop in, and to fade once the shot's over (s). */
const POP_IN = 0.25;
const FADE_OUT = 0.7;
/** Where the net's bottom ring is, below the rim, and how wide (a fraction of the rim). */
const NET_DROP = 12;
const NET_NARROW = 0.6;

/** The hoop the game says is there now: the shot's, or the one that hangs while Hoop Dreamz is selected. */
function hoopNow(state: GameState): Hoop | null {
  const ball = state.basketballs.find((b) => b.hoop);
  if (ball) return ball.hoop;
  if (state.phase !== 'aiming') return null;
  const p = currentPlayer(state);
  if (!isHoop(p, p.selectedTier)) return null;
  return hoopFor(state, p, weaponOf(p.loadout[p.selectedTier]!, 'hoop'));
}

/** The hoop as drawn this frame, and how much of it there is (popping in, fading out): kept in `d.hoop`. */
function shownHoop(d: Draw, state: GameState): { h: Hoop; a: number; pop: number } | null {
  const now = hoopNow(state);
  if (now) {
    if (!d.hoop || d.time - d.hoop.last > 0.1) d.hoop = { h: now, since: d.time, last: d.time };
    d.hoop.h = now;
    d.hoop.last = d.time;
  }
  const mem = d.hoop;
  if (!mem) return null;
  const fade = 1 - (d.time - mem.last) / FADE_OUT;
  if (fade <= 0) {
    d.hoop = null;
    return null;
  }
  const pop = Math.min(1, (d.time - mem.since) / POP_IN);
  return { h: mem.h, a: Math.min(1, fade * 1.5) * pop, pop };
}

/** The rim's half-width of the hoop's weapon (they're all Hoop Dreamz). */
function rimHalfOf(state: GameState): number {
  const ball = state.basketballs[0];
  const p = currentPlayer(state);
  const id = ball?.weaponId ?? (isHoop(p, p.selectedTier) ? p.loadout[p.selectedTier]! : 'hoop-dreamz');
  return weaponOf(id, 'hoop').hoop.rimHalf;
}

/** The backboard, its bracket and the back of the rim. */
export function drawHoopBack(d: Draw, state: GameState): void {
  const s = shownHoop(d, state);
  if (!s) return;
  const { ctx } = d;
  const { h, a, pop } = s;
  const rim = rimHalfOf(state);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(h.x, h.y);
  // Popping in: a little overshoot.
  const k = pop < 1 ? 0.6 + 0.55 * Math.sin((pop * Math.PI) / 1.6) : 1;
  ctx.scale(k, k);
  ctx.scale(h.side, 1);
  const bx = rim + 3;
  // The board, a little turned towards us: white, a red box over the rim, a dark edge.
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = 'rgba(15,23,42,0.85)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bx, -BOARD_HEIGHT);
  ctx.lineTo(bx + 5, -BOARD_HEIGHT - 2);
  ctx.lineTo(bx + 5, 6);
  ctx.lineTo(bx, 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 1.4, -11, 2.2, 9);
  // The bracket from the board to the rim.
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(bx, 0);
  ctx.lineTo(rim - 1, 0);
  ctx.moveTo(bx, 3);
  ctx.lineTo(rim - 2, 0.5);
  ctx.stroke();
  // The back of the rim.
  ctx.strokeStyle = '#c2410c';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(0, 0, rim, 3, 0, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** The net and the front of the rim, over the ball; the net stretches as a dunk goes through. */
export function drawHoopFront(d: Draw, state: GameState): void {
  const s = d.hoop && shownHoop(d, state);
  if (!s) return;
  const { ctx } = d;
  const { h, a, pop } = s;
  const rim = rimHalfOf(state);
  const dunk = state.basketballs.find((b) => b.dunk !== null);
  const stretch = dunk ? Math.max(0, 1 - Math.abs(dunk.y - h.y - NET_DROP) / 30) * 7 : 0;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(h.x, h.y);
  const k = pop < 1 ? 0.6 + 0.55 * Math.sin((pop * Math.PI) / 1.6) : 1;
  ctx.scale(k, k);
  // The net: strings from the rim to a narrower ring below, crossed.
  const drop = NET_DROP + stretch;
  const low = rim * NET_NARROW;
  ctx.strokeStyle = 'rgba(248,250,252,0.85)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const top = -rim + 2 * rim * t;
    const bottom = -low + 2 * low * t;
    ctx.moveTo(top, 1);
    ctx.lineTo(bottom, drop);
    if (i < 6) {
      ctx.moveTo(top, 1);
      ctx.lineTo(-low + 2 * low * ((i + 1) / 6), drop);
    }
  }
  ctx.moveTo(-rim * 0.8, drop * 0.5);
  ctx.lineTo(rim * 0.8, drop * 0.5);
  ctx.moveTo(-low, drop);
  ctx.lineTo(low, drop);
  ctx.stroke();
  // The front of the rim.
  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.ellipse(0, 0, rim, 3, 0, 0, Math.PI);
  ctx.stroke();
  ctx.restore();
}

/** Balls in play: orange with black seams, rolling as they go; a slam leaves speed lines. */
export function drawBasketballs(d: Draw, state: GameState): void {
  for (const b of state.basketballs) drawBall(d, b);
}

function drawBall(d: Draw, b: Basketball): void {
  const { ctx } = d;
  const r = BALL_RADIUS;
  ctx.save();
  if (b.dunk !== null && b.vy > 200) {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const dx of [-3, 0, 3]) {
      ctx.moveTo(b.x + dx, b.y - r - 2);
      ctx.lineTo(b.x + dx, b.y - r - 2 - Math.min(26, b.vy / 40));
    }
    ctx.stroke();
  }
  ctx.translate(b.x, b.y);
  ctx.rotate(b.dunk !== null ? 0 : b.x / r);
  ctx.fillStyle = '#ea580c';
  ctx.strokeStyle = '#1c1917';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-r, 0);
  ctx.lineTo(r, 0);
  ctx.moveTo(0, -r);
  ctx.lineTo(0, r);
  ctx.moveTo(-r * 0.7, -r * 0.7);
  ctx.quadraticCurveTo(-r * 0.2, 0, -r * 0.7, r * 0.7);
  ctx.moveTo(r * 0.7, -r * 0.7);
  ctx.quadraticCurveTo(r * 0.2, 0, r * 0.7, r * 0.7);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.arc(-r * 0.35, -r * 0.4, r * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

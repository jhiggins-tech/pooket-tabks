import { STRIKE, horizonOf, shipAt } from '../../game/game';
import { TANK_BODY_HEIGHT } from '../../game/constants';
import type { AirStrike, GameState } from '../../game/state';
import type { Draw } from './context';
import { drawArwing } from './arwing';

/**
 * doctorfox's Air Strike (game/airstrike.ts), in the world: the ping of light on the horizon ("kira!"), the
 * three Arwings coming out of it and growing as they close, their blue laser bolts streaking down, the
 * bomb falling from the lead ship, and the Star Fox bomb going off: a white-hot core in a swelling red
 * sphere, wireframe triangles and hexagons spinning out of it. The comm is draw/comm.ts.
 */

/** How long a laser bolt is on screen (s), and how long its streak is (px). */
const BOLT_LIFE = 0.16;
const BOLT_STREAK = 46;
/** The bomb's blast as drawn: how long it lasts (s), how big it gets (px). */
const BLAST_LIFE = STRIKE.end - STRIKE.bomb;
const BLAST_SIZE = 62;

export function drawAirStrike(d: Draw, state: GameState): void {
  const s = state.airstrike;
  if (!s) return;
  const colour = state.players[s.ownerId]?.colour ?? '#fb923c';
  if (s.t < STRIKE.ping + 0.2) drawPing(d, s);
  for (let i = 2; i >= 0; i--) {
    const ship = shipAt(s, i, s.t);
    if (!ship) continue;
    const { ctx } = d;
    ctx.save();
    ctx.translate(ship.x, ship.y);
    const k = 1.25 * ship.scale;
    ctx.scale(s.dir * k, k);
    // Banking down into the run, level across it, nose up away.
    ctx.rotate(s.t < STRIKE.strafe ? 0.18 : s.t < STRIKE.drop ? 0.05 : -0.45);
    ctx.globalAlpha = Math.min(1, ship.scale * 3);
    drawArwing(d, colour);
    ctx.restore();
  }
  drawBolts(d, s);
  if (s.t >= STRIKE.drop && s.t < STRIKE.bomb) drawBomb(d, s);
  if (s.t >= STRIKE.bomb) drawBlast(d, s, (s.t - STRIKE.bomb) / BLAST_LIFE);
}

/** Kira! A four-pointed glint on the horizon, flaring then shrinking into the ships coming out of it. */
function drawPing(d: Draw, s: AirStrike): void {
  const { ctx } = d;
  const h = horizonOf(s);
  const k = Math.min(1, s.t / (STRIKE.ping + 0.2));
  const flare = Math.sin(k * Math.PI);
  if (flare <= 0) return;
  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 22 * flare);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.35, 'rgba(160,210,255,0.55)');
  g.addColorStop(1, 'rgba(120,180,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 22 * flare, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(k * 1.2);
  ctx.fillStyle = '#ffffff';
  for (const [len, w] of [[30, 2.2], [14, 1.4]] as const) {
    for (let q = 0; q < 4; q++) {
      ctx.save();
      ctx.rotate(q * (Math.PI / 2) + (len < 20 ? Math.PI / 4 : 0));
      ctx.beginPath();
      ctx.moveTo(0, -w);
      ctx.lineTo(len * flare, 0);
      ctx.lineTo(0, w);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
}

/** The laser bolts: a bright blue streak racing from the ship to where it stops, then a flash there. */
function drawBolts(d: Draw, s: AirStrike): void {
  const { ctx } = d;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const b of s.bolts) {
    const age = s.t - b.t;
    if (age < 0 || age > BOLT_LIFE) continue;
    const k = age / BOLT_LIFE;
    const len = Math.hypot(b.x2 - b.x1, b.y2 - b.y1) || 1;
    // The head races down the line (in the first half of its life); the streak trails behind it.
    const head = Math.min(1, k * 2);
    const tail = Math.max(0, head - BOLT_STREAK / len);
    const hx = b.x1 + (b.x2 - b.x1) * head;
    const hy = b.y1 + (b.y2 - b.y1) * head;
    const tx = b.x1 + (b.x2 - b.x1) * tail;
    const ty = b.y1 + (b.y2 - b.y1) * tail;
    const fade = k < 0.5 ? 1 : 1 - (k - 0.5) * 2;
    for (const [w, c] of [[6, `rgba(37,99,235,${0.5 * fade})`], [3, `rgba(96,165,250,${0.9 * fade})`], [1.2, `rgba(240,249,255,${fade})`]] as const) {
      ctx.strokeStyle = c;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(hx, hy);
      ctx.stroke();
    }
    if (head >= 1) {
      const g = ctx.createRadialGradient(b.x2, b.y2, 0, b.x2, b.y2, 10);
      g.addColorStop(0, `rgba(220,240,255,${fade})`);
      g.addColorStop(1, 'rgba(59,130,246,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x2, b.y2, 10, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** The bomb: a glowing red orb falling from where the lead ship let it go, onto the target. */
function drawBomb(d: Draw, s: AirStrike): void {
  const { ctx } = d;
  const from = shipAt(s, 0, STRIKE.drop)!;
  const k = (s.t - STRIKE.drop) / (STRIKE.bomb - STRIKE.drop);
  const ty = s.y - TANK_BODY_HEIGHT / 2;
  const x = from.x + (s.x - from.x) * k;
  const y = from.y + (ty - from.y) * k * k;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const pulse = 1 + 0.25 * Math.sin(d.time * 40);
  const g = ctx.createRadialGradient(x, y, 0, x, y, 9 * pulse);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,90,90,0.9)');
  g.addColorStop(1, 'rgba(220,20,60,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, 9 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** The Star Fox bomb going off (`k`: 0 to 1): a flash, a swelling red sphere, and spinning wireframe shapes. */
function drawBlast(d: Draw, s: AirStrike, k: number): void {
  if (k >= 1) return;
  const { ctx } = d;
  const x = s.x;
  const y = s.y - TANK_BODY_HEIGHT / 2;
  const grow = 1 - (1 - Math.min(1, k * 1.6)) ** 3;
  const r = BLAST_SIZE * grow;
  const fade = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // The sphere: white-hot in the middle, red to its rim, a bright edge.
  const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, r));
  g.addColorStop(0, `rgba(255,255,255,${fade})`);
  g.addColorStop(0.3, `rgba(255,180,200,${0.85 * fade})`);
  g.addColorStop(0.75, `rgba(239,68,68,${0.6 * fade})`);
  g.addColorStop(0.95, `rgba(255,120,120,${0.8 * fade})`);
  g.addColorStop(1, 'rgba(255,60,60,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(1, r), 0, Math.PI * 2);
  ctx.fill();
  // The wireframe: two triangles (a star) one way, a hexagon the other, and an outer ring of spokes.
  ctx.lineJoin = 'miter';
  const spin = k * 5;
  shape(ctx, x, y, r * 0.9, 3, spin, `rgba(255,255,255,${fade})`, 2);
  shape(ctx, x, y, r * 0.9, 3, spin + Math.PI, `rgba(255,255,255,${fade})`, 2);
  shape(ctx, x, y, r * 1.1, 6, -spin * 0.7, `rgba(255,140,160,${0.9 * fade})`, 1.6);
  shape(ctx, x, y, r * 0.55, 6, spin * 1.3, `rgba(253,224,71,${0.8 * fade})`, 1.4);
  ctx.strokeStyle = `rgba(255,220,230,${0.7 * fade})`;
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - spin * 0.4;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 1.15, y + Math.sin(a) * r * 1.15);
    ctx.lineTo(x + Math.cos(a) * r * (1.3 + 0.2 * Math.sin(i * 2.3 + k * 9)), y + Math.sin(a) * r * (1.3 + 0.2 * Math.sin(i * 2.3 + k * 9)));
    ctx.stroke();
  }
  // The flash as it goes off.
  if (k < 0.15) {
    ctx.fillStyle = `rgba(255,255,255,${0.6 * (1 - k / 0.15)})`;
    ctx.beginPath();
    ctx.arc(x, y, BLAST_SIZE * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A regular polygon's outline: `n` corners on a circle of `r` round (x, y), turned by `turn`. */
function shape(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, n: number, turn: number, colour: string, width: number): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = turn + (i / n) * Math.PI * 2;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.stroke();
}

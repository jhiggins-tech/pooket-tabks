import { canDriveNow } from '../../game/game';
import { TANK_BODY_HEIGHT, TANK_HALF_WIDTH } from '../../game/constants';
import type { GameState, Player } from '../../game/state';
import type { Draw, Exhaust } from './context';

/**
 * ShotDownBoyz's rig (game/digger.ts): the diesel exhaust stack on the back of his hull, and with the
 * Digger on, tracks and the bulldozer blade out front; while the digger moves, black fumes puff out of the
 * stack. Moving is worked out from the tank's position frame to frame (cosmetic, like the scooter, so it
 * shows the same for a phone watching his previews).
 */

/** How long a puff of fumes hangs about (s), how often one comes out while moving, and how fast it rises (px/s). */
const PUFF_LIFE = 1.2;
const PUFF_EVERY = 0.07;
const PUFF_RISE = 20;

/** Where the stack's top is, facing `dir`: the back of the hull, pointing straight up. */
function stackTop(p: { x: number; y: number }, dir: number): { x: number; y: number } {
  return { x: p.x - dir * 8, y: p.y - TANK_BODY_HEIGHT - 10 };
}

/**
 * Draws ShotDownBoyz's rig on his tank (`p`, where this copy of `owner`'s tank is drawn): the stack always,
 * the tracks and blade only on the tank itself with the Digger on.
 */
export function drawDiggerRig(d: Draw, owner: Player, p: Player, state: GameState, copy: boolean): void {
  const digging = !copy && owner.diggerActive;
  const dir = digging ? owner.diggerFacing : Math.cos((p.angle * Math.PI) / 180) >= 0 ? 1 : -1;
  const moving = !copy && dieselMoving(d, owner, state);
  const { ctx } = d;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(dir, 1); // forward is +x
  drawStack(ctx, d.time, moving);
  if (digging) {
    drawTracks(ctx, p.x * dir);
    drawBlade(ctx, moving ? Math.sin(d.time * 40) * 0.35 : 0);
  }
  ctx.restore();
}

/**
 * Whether `p`'s digger is moving now (with a little grace, so it doesn't flicker between ticks), and on the
 * way, a puff of fumes out of the stack every so often.
 */
function dieselMoving(d: Draw, p: Player, state: GameState): boolean {
  let ex: Exhaust | undefined = d.exhausts.get(p.id);
  if (!ex) {
    ex = { x: p.x, until: 0, lastPuff: 0, puffs: [] };
    d.exhausts.set(p.id, ex);
  }
  const dx = p.x - ex.x;
  ex.x = p.x;
  // Only digging along while aiming (not a jump to a new match or snapshot).
  if (p.diggerActive && canDriveNow(state) && Math.abs(dx) > 0.05 && Math.abs(dx) < 30) ex.until = d.time + 0.2;
  const moving = p.alive && p.diggerActive && d.time < ex.until;
  if (moving && d.time - ex.lastPuff >= PUFF_EVERY) {
    ex.lastPuff = d.time;
    const way = p.diggerFacing;
    const top = stackTop(p, way);
    const jitter = Math.sin(d.time * 91.7);
    ex.puffs.push({ x: top.x, y: top.y, vx: -way * (8 + 5 * jitter), born: d.time });
  }
  return moving;
}

/** The fumes: black diesel smoke, billowing up and back off the stack, greying and thinning out. */
export function drawFumes(d: Draw, _state: GameState): void {
  const { ctx } = d;
  for (const ex of d.exhausts.values()) {
    ex.puffs = ex.puffs.filter((f) => d.time - f.born < PUFF_LIFE);
    for (const f of ex.puffs) {
      const t = d.time - f.born;
      const k = t / PUFF_LIFE;
      const x = f.x + f.vx * t + Math.sin(f.born * 13 + t * 4) * 1.5;
      const y = f.y - PUFF_RISE * t - 6 * k * k;
      const r = 1.6 + 5 * Math.sqrt(k);
      const grey = Math.round(40 + 110 * k);
      ctx.fillStyle = `rgba(${grey},${grey},${grey + 6},${0.7 * (1 - k)})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.arc(x + r * 0.6, y + r * 0.25, r * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** The exhaust stack: a little vertical pipe off the back of the hull, its rain flap popping while it runs. */
function drawStack(ctx: CanvasRenderingContext2D, time: number, running: boolean): void {
  const x = -8;
  const top = -TANK_BODY_HEIGHT - 10;
  // Mounting bracket on the hull.
  ctx.fillStyle = '#27272a';
  ctx.fillRect(x - 2.2, -TANK_BODY_HEIGHT - 1.5, 4.4, 2);
  // The pipe, with a little shine down one side.
  ctx.fillStyle = '#3f3f46';
  ctx.strokeStyle = '#18181b';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.rect(x - 1.3, top, 2.6, 10);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#a1a1aa';
  ctx.fillRect(x - 0.7, top + 1, 0.7, 7.5);
  // The rain flap, hinged at the back: shut at rest, rattling open while the engine works.
  const open = running ? 0.9 + 0.35 * Math.sin(time * 38) : 0;
  ctx.save();
  ctx.translate(x - 1.5, top);
  ctx.rotate(-open);
  ctx.fillStyle = '#71717a';
  ctx.strokeStyle = '#18181b';
  ctx.beginPath();
  ctx.rect(0, -1, 3.4, 1.2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Dozer tracks along the bottom of the hull, their treads rolling as the tank moves (`roll`: how far). */
function drawTracks(ctx: CanvasRenderingContext2D, roll: number): void {
  const w = TANK_HALF_WIDTH + 1;
  ctx.fillStyle = '#27272a';
  ctx.strokeStyle = '#09090b';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.roundRect(-w, -3.6, w * 2, 4.4, 2.2);
  ctx.fill();
  ctx.stroke();
  // Road wheels.
  ctx.fillStyle = '#71717a';
  for (const wx of [-8, -3, 2, 7]) {
    ctx.beginPath();
    ctx.arc(wx, -1.4, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Tread lugs, sliding along with the distance driven.
  ctx.strokeStyle = '#52525b';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  const off = ((roll % 3) + 3) % 3;
  for (let tx = -w + 1 + off; tx < w - 1; tx += 3) {
    ctx.moveTo(tx, 0.4);
    ctx.lineTo(tx - 0.8, 0.8);
  }
  ctx.stroke();
}

/** The bulldozer: a yellow push frame and a hydraulic ram out to a curved blade with a steel cutting edge and teeth. */
function drawBlade(ctx: CanvasRenderingContext2D, shake: number): void {
  ctx.save();
  ctx.translate(shake, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Push frame, from a pivot on the tracks to the foot of the blade.
  for (const [style, width] of [['#3b2a07', 3.8], ['#e0a000', 2.4]] as const) {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(3, -2.4);
    ctx.lineTo(14, -2.8);
    ctx.stroke();
  }
  ctx.fillStyle = '#3b2a07';
  ctx.beginPath();
  ctx.arc(3, -2.4, 1, 0, Math.PI * 2);
  ctx.fill();

  // Hydraulic ram: a dark cylinder off the front of the hull, its chrome rod pushing the top of the blade.
  ctx.strokeStyle = '#18181b';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(6.5, -TANK_BODY_HEIGHT - 0.5);
  ctx.lineTo(10.5, -TANK_BODY_HEIGHT - 2.6);
  ctx.stroke();
  ctx.strokeStyle = '#e4e4e7';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(10.5, -TANK_BODY_HEIGHT - 2.6);
  ctx.lineTo(14, -TANK_BODY_HEIGHT - 4.2);
  ctx.stroke();

  // The blade: a tall moldboard, curved like a scoop (its back bowed, its face hollowed out).
  ctx.fillStyle = '#f5b301';
  ctx.strokeStyle = '#3b2a07';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(14, 1);
  ctx.quadraticCurveTo(12, -7, 14.5, -15.5);
  ctx.lineTo(20.5, -17.5);
  ctx.quadraticCurveTo(15.5, -8, 21, 1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Shade in the hollow, and a highlight along the top lip.
  ctx.fillStyle = 'rgba(140,80,0,0.4)';
  ctx.beginPath();
  ctx.moveTo(20.5, -17.5);
  ctx.quadraticCurveTo(15.5, -8, 21, 1);
  ctx.lineTo(19.2, 1);
  ctx.quadraticCurveTo(15, -8, 18.6, -16.6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#fde68a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(15, -15.2);
  ctx.lineTo(20, -16.9);
  ctx.stroke();
  // Hazard stripes across the back.
  ctx.strokeStyle = '#1c1917';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const sy of [-12, -8, -4]) {
    ctx.moveTo(13.1, sy + 1.2);
    ctx.lineTo(15.4, sy - 0.8);
  }
  ctx.stroke();

  // Steel cutting edge, and teeth biting forward.
  ctx.strokeStyle = '#9ca3af';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(14, 0.4);
  ctx.lineTo(21.3, 0.4);
  ctx.stroke();
  ctx.fillStyle = '#e5e7eb';
  ctx.strokeStyle = '#374151';
  ctx.lineWidth = 0.6;
  for (const ty of [-2.4, 0.4]) {
    ctx.beginPath();
    ctx.moveTo(19.8, ty - 1.1);
    ctx.lineTo(24, ty + 0.2);
    ctx.lineTo(20.4, ty + 1.1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

import { STRIKE } from '../../game/game';
import type { GameState } from '../../game/state';
import { COMMS, PILOTS, TYPE_RATE, type PilotLook } from '../../weapons/comms';

/**
 * doctorfox's Air Strike: the comm, Star Fox 64 style. Bottom left of the screen (drawn in screen pixels,
 * over everything), a portrait of whoever's calling in (weapons/comms.ts: drawn from their `PilotLook`)
 * flickers on, their mouth flapping while their line types out in blue beside them, and it switches off
 * when the run is over. Its clock is the strike's (game/airstrike.ts `STRIKE`).
 */

/** The portrait's size and the gap round it (CSS px), how wide the caption gets, and how far up it sits. */
const SIZE = 64;
const MARGIN = 12;
const CAPTION_W = 250;
const LIFT = 128;
/** How long it takes to switch on and off (s). */
const SWITCH = 0.16;
/** The caption's colour. */
const CAPTION = '#7cc4ff';

/** The comm, if one's up: drawn in backing-store pixels (`dpr` per CSS px) on a canvas `h` tall. */
export function drawComm(ctx: CanvasRenderingContext2D, state: GameState, h: number, dpr: number, time: number): void {
  const s = state.airstrike;
  if (!s || s.t < STRIKE.comm || s.t > STRIKE.commEnd) return;
  const comm = COMMS[s.pilot];
  if (!comm) return;
  const look = PILOTS[comm.pilot];
  const since = s.t - STRIKE.comm;
  const open = Math.min(1, since / SWITCH, (STRIKE.commEnd - s.t) / SWITCH);
  const typed = Math.min(comm.line.length, Math.floor(Math.max(0, since - SWITCH) * TYPE_RATE));
  const talking = typed < comm.line.length;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const x = MARGIN + 4;
  const y = h / dpr - LIFT - SIZE;
  // The frame, opening from a line in the middle like an old screen.
  ctx.save();
  ctx.translate(x, y + SIZE / 2);
  ctx.scale(1, Math.max(0.04, open));
  ctx.translate(0, -SIZE / 2);
  ctx.fillStyle = 'rgba(8,16,40,0.9)';
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(0, 0, SIZE, SIZE);
  ctx.fill();
  ctx.save();
  ctx.clip();
  drawFace(ctx, look, talking ? Math.abs(Math.sin(time * 19)) : 0, time);
  // Scan lines, and a flicker of static while it switches on.
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let yy = 0; yy < SIZE; yy += 3) ctx.fillRect(0, yy, SIZE, 1);
  if (since < SWITCH * 2) {
    ctx.fillStyle = `rgba(200,220,255,${0.5 * (1 - since / (SWITCH * 2))})`;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }
  ctx.restore();
  ctx.stroke();
  ctx.restore();

  if (open >= 1) {
    ctx.font = '800 11px system-ui, -apple-system, sans-serif';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(4,8,24,0.9)';
    ctx.lineWidth = 3;
    const tx = x + SIZE + 8;
    ctx.strokeText(look.name.toUpperCase(), tx, y + 2);
    ctx.fillStyle = '#e0f2fe';
    ctx.fillText(look.name.toUpperCase(), tx, y + 2);
    ctx.font = '700 14px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = CAPTION;
    lines(ctx, comm.line.slice(0, typed), CAPTION_W).forEach((line, i) => {
      ctx.strokeText(line, tx, y + 18 + i * 17);
      ctx.fillText(line, tx, y + 18 + i * 17);
    });
  }
  ctx.restore();
}

/** `text` broken into lines no wider than `w` (at the current font), at spaces. */
function lines(ctx: CanvasRenderingContext2D, text: string, w: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > w) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** A pilot's face, filling the SIZE × SIZE portrait; `mouth` (0–1) how far open it is. */
function drawFace(ctx: CanvasRenderingContext2D, look: PilotLook, mouth: number, time: number): void {
  const cx = SIZE / 2;
  const cy = 38;
  // The cockpit behind them.
  const bg = ctx.createLinearGradient(0, 0, 0, SIZE);
  bg.addColorStop(0, '#1e3a8a');
  bg.addColorStop(1, '#0b1330');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Shoulders (the flight suit).
  ctx.fillStyle = look.muzzle === 'robot' ? '#475569' : '#e5e7eb';
  ctx.beginPath();
  ctx.ellipse(cx, SIZE + 6, 26, 16, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#16a34a';
  ctx.fillRect(cx - 4, SIZE - 10, 8, 10);

  drawEars(ctx, look, cx, cy);
  // The head.
  ctx.fillStyle = look.fur;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (look.muzzle === 'robot') ctx.roundRect(cx - 15, cy - 19, 30, 34, 5);
  else if (look.muzzle === 'toad') ctx.ellipse(cx, cy, 19, 15, 0, 0, Math.PI * 2);
  else ctx.ellipse(cx, cy, 16, 17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  drawMuzzle(ctx, look, cx, cy, mouth, time);
  drawEyes(ctx, look, cx, cy, time);
  drawWear(ctx, look, cx, cy);
}

function drawEars(ctx: CanvasRenderingContext2D, look: PilotLook, cx: number, cy: number): void {
  ctx.fillStyle = look.fur;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    if (look.ears === 'pointed') {
      ctx.moveTo(cx + side * 5, cy - 14);
      ctx.lineTo(cx + side * 16, cy - 30);
      ctx.lineTo(cx + side * 16, cy - 8);
    } else if (look.ears === 'long') {
      ctx.ellipse(cx + side * 7, cy - 26, 4.5, 14, side * 0.15, 0, Math.PI * 2);
    } else if (look.ears === 'round') {
      ctx.ellipse(cx + side * 13, cy - 13, 6, 6, 0, 0, Math.PI * 2);
    } else continue;
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // The inside of the ear.
    ctx.fillStyle = look.light;
    ctx.beginPath();
    if (look.ears === 'pointed') {
      ctx.moveTo(cx + side * 8, cy - 14);
      ctx.lineTo(cx + side * 14, cy - 24);
      ctx.lineTo(cx + side * 14, cy - 12);
    } else if (look.ears === 'long') {
      ctx.ellipse(cx + side * 7, cy - 26, 2, 10, side * 0.15, 0, Math.PI * 2);
    } else {
      ctx.ellipse(cx + side * 13, cy - 13, 3, 3, 0, 0, Math.PI * 2);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = look.fur;
  }
}

function drawMuzzle(ctx: CanvasRenderingContext2D, look: PilotLook, cx: number, cy: number, mouth: number, time: number): void {
  const open = 1 + mouth * 4.5;
  if (look.muzzle === 'robot') {
    // A grille that lights up as it talks.
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(cx - 9, cy + 4, 18, 7);
    ctx.fillStyle = `rgba(250,204,21,${0.25 + 0.75 * mouth})`;
    for (let i = 0; i < 4; i++) ctx.fillRect(cx - 8 + i * 4.5, cy + 5, 3, 5);
    return;
  }
  if (look.muzzle === 'beak') {
    // A beak, its lower half dropping open.
    ctx.fillStyle = '#facc15';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.moveTo(cx - 7, cy + 1);
    ctx.lineTo(cx + 7, cy + 1);
    ctx.lineTo(cx, cy + 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#eab308';
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy + 4 + open * 0.6);
    ctx.lineTo(cx + 5, cy + 4 + open * 0.6);
    ctx.lineTo(cx, cy + 10 + open);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    return;
  }
  // A light muzzle patch, a nose, and the mouth.
  ctx.fillStyle = look.light;
  ctx.beginPath();
  if (look.muzzle === 'fox') {
    ctx.moveTo(cx - 12, cy - 1);
    ctx.quadraticCurveTo(cx, cy + 22, cx + 12, cy - 1);
    ctx.quadraticCurveTo(cx, cy + 6, cx - 12, cy - 1);
  } else if (look.muzzle === 'toad') {
    ctx.ellipse(cx, cy + 6, 14, 7, 0, 0, Math.PI * 2);
  } else {
    ctx.ellipse(cx, cy + 6, 9, 7.5, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  if (look.muzzle !== 'toad') {
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.ellipse(cx, cy + (look.muzzle === 'fox' ? 5 : 3), 2.6, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#3f0d12';
  ctx.beginPath();
  const w = look.muzzle === 'toad' ? 9 : 4;
  ctx.ellipse(cx, cy + 10, w, open * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  if (look.muzzle === 'toad' && mouth < 0.2) {
    ctx.strokeStyle = '#3f0d12';
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy + 9);
    ctx.quadraticCurveTo(cx, cy + 13 + Math.sin(time) * 0.3, cx + 10, cy + 9);
    ctx.stroke();
  }
}

function drawEyes(ctx: CanvasRenderingContext2D, look: PilotLook, cx: number, cy: number, time: number): void {
  // A blink every few seconds.
  const blink = time % 3.7 < 0.12;
  const big = look.muzzle === 'toad';
  const ey = big ? cy - 9 : cy - 5;
  for (const side of [-1, 1]) {
    const ex = cx + side * (big ? 8 : 6);
    if (look.muzzle === 'robot') {
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(ex - 3.5, ey - 3, 7, 4);
      continue;
    }
    if (look.muzzle === 'beak') {
      // Falco's red markings round his eyes.
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.ellipse(ex, ey, 5, 3.6, side * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(ex, ey, big ? 4.5 : 3.2, blink ? 0.5 : big ? 4.5 : 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!blink) {
      ctx.fillStyle = look.muzzle === 'fox' ? '#065f46' : '#111827';
      ctx.beginPath();
      ctx.arc(ex + side * 0.4, ey + 0.4, big ? 2.2 : 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawWear(ctx: CanvasRenderingContext2D, look: PilotLook, cx: number, cy: number): void {
  ctx.strokeStyle = '#111827';
  ctx.fillStyle = '#111827';
  ctx.lineWidth = 1.6;
  if (look.wear === 'headset') {
    // An earpiece and the mic's boom round to the mouth.
    ctx.fillRect(cx + 13, cy - 4, 5, 8);
    ctx.beginPath();
    ctx.moveTo(cx + 15, cy + 3);
    ctx.quadraticCurveTo(cx + 15, cy + 13, cx + 7, cy + 13);
    ctx.stroke();
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(cx + 5, cy + 11.5, 3, 3);
  } else if (look.wear === 'cap') {
    // General Pepper's peaked cap with its badge.
    ctx.fillStyle = '#7f1d1d';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 14, 18, 8, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#111827';
    ctx.fillRect(cx - 19, cy - 15, 38, 4);
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(cx, cy - 19, 2.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (look.wear === 'eyepatch') {
    // Wolf's patch over his left eye, its strap across his head.
    ctx.beginPath();
    ctx.moveTo(cx - 15, cy - 12);
    ctx.lineTo(cx + 15, cy - 1);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx - 6, cy - 5, 4.5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // James's shades.
    ctx.fillRect(cx - 11, cy - 8, 9, 5);
    ctx.fillRect(cx + 2, cy - 8, 9, 5);
    ctx.fillRect(cx - 2, cy - 7, 4, 1.5);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(cx - 9, cy - 7, 3, 1);
    ctx.fillRect(cx + 4, cy - 7, 3, 1);
  }
}

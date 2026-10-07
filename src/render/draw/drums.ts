import { DRUM_OUTRO, muzzle, noteSide, noteTimes, tankCentre } from '../../game/game';
import type { DrumSet, GameState, Player } from '../../game/state';
import { weaponOf } from '../../weapons/registry';
import type { Draw } from './context';

/**
 * kiwicore's Band Aid: the drum kit round his tank (a snare on the left, a floor tom on the right, a
 * hi-hat), the notes falling in one stream onto a hit line above the tank, the drumstick out of his barrel, and the verdicts. His turret
 * swinging over to each drum is `drumStick` (draw/tank.ts draws the barrel at that angle).
 */

/** How far each drum's head is from the barrel's pivot (px across, and down). */
const DRUM_X = 24;
const DRUM_DOWN = 3;
/** The hit line's height above the barrel's pivot; how long before its time a note shows, falling onto it (s), and how fast it falls (px/s). */
const HIT_LINE = 26;
const NOTE_LEAD = 1.1;
const NOTE_FALL = 75;
/** How long the turret takes to swing from one drum to the other (s), and the words stay up (s). */
const SWING = 0.09;
const VERDICT = 0.45;
/** The stick's length past the barrel's end. */
const STICK = 9;

/** The angle (degrees, the aim's convention) the barrel points at a drum: −1 the left one, +1 the right. */
function atDrum(side: number): number {
  const down = (Math.atan2(DRUM_DOWN, DRUM_X) * 180) / Math.PI;
  return side < 0 ? 180 + down : -down;
}

/** How far into the kit's coming and going it is: 0 → 1 as it appears, 1 → 0 as it packs away. */
function presence(k: DrumSet): number {
  if (k.outro !== null) return Math.max(0, 1 - k.outro / DRUM_OUTRO);
  return Math.min(1, k.t / 0.25);
}

/**
 * Where `p`'s barrel points while they drum: straight up through the count-in (tapping time), then swung
 * over the top to whichever drum the stick last went to, with a little dip as it lands. Null: not drumming.
 */
export function drumStick(state: GameState, p: Player): number | null {
  const k = state.drums;
  if (!k || k.playerId !== p.id) return null;
  if (k.swungAt < 0) {
    const { drum } = weaponOf(k.weaponId, 'drum');
    const beat = 60 / drum.bpm;
    return 90 + 8 * Math.max(0, 1 - ((k.t % beat) / beat) * 4);
  }
  // (Left is ~187°, right ~−7°: going between them goes over the top.)
  const to = atDrum(k.side);
  const from = atDrum(-k.side);
  const u = Math.min(1, (k.t - k.swungAt) / SWING);
  const eased = 1 - (1 - u) ** 2;
  const dip = u >= 1 ? 7 * Math.max(0, 1 - (k.t - k.swungAt - SWING) / 0.08) : 0;
  return from + (to - from) * eased - k.side * dip; // the dip: a little further down, into the drum
}

/** One drum: a sparkly red shell, a cream head, lit up just after it's hit. */
function drawDrum(ctx: CanvasRenderingContext2D, x: number, head: number, ground: number, glow: number): void {
  const rx = 7;
  ctx.fillStyle = '#b91c1c';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(x - rx, head, rx * 2, ground - head);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fca5a5';
  ctx.fillRect(x - rx + 1.5, head + 1.5, 2, ground - head - 3); // shine
  ctx.strokeStyle = '#e5e7eb'; // the hoop
  ctx.beginPath();
  ctx.moveTo(x - rx, ground - 1.5);
  ctx.lineTo(x + rx, ground - 1.5);
  ctx.stroke();
  ctx.fillStyle = glow > 0 ? `rgb(255,${250 - 40 * glow},${200 - 120 * glow})` : '#fef3c7';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  ctx.ellipse(x, head, rx, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

export function drawDrums(d: Draw, state: GameState): void {
  const k = state.drums;
  const p = k && state.players[k.playerId];
  if (!k || !p) return;
  const { ctx } = d;
  const { drum } = weaponOf(k.weaponId, 'drum');
  const c = tankCentre(p);
  const head = c.y + DRUM_DOWN;
  const show = presence(k);
  if (show <= 0) return;
  const times = noteTimes(drum);
  const beat = 60 / drum.bpm;
  ctx.save();
  ctx.globalAlpha = show;

  // The hi-hat, on its stand behind the left drum.
  const hx = c.x - DRUM_X - 9;
  const hy = c.y - 10;
  ctx.strokeStyle = '#9ca3af';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx, p.y);
  ctx.stroke();
  const chick = k.t < drum.countIn * beat ? 0 : Math.max(0, 1 - ((k.t % (beat / 2)) / (beat / 2)) * 3);
  ctx.fillStyle = '#facc15';
  ctx.strokeStyle = 'rgba(80,60,0,0.8)';
  for (const off of [chick, -1]) {
    ctx.beginPath();
    ctx.ellipse(hx, hy + off, 7, 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // The drums, lit up for a moment when hit.
  for (const side of [-1, 1]) {
    const lastHit = k.beats.reduce((at, b, i) => ((b === 1 || b === 2) && noteSide(i) === side ? Math.max(at, times[i]!) : at), -Infinity);
    const glow = Math.max(0, 1 - Math.abs(k.t - lastHit) / 0.18);
    drawDrum(ctx, c.x + side * DRUM_X, head, p.y + 1, glow);
  }

  // The drumstick, out of the end of the barrel.
  const angle = drumStick(state, p) ?? p.angle;
  const a = (angle * Math.PI) / 180;
  const m = muzzle({ ...p, angle });
  const tip = { x: m.x + Math.cos(a) * STICK, y: m.y - Math.sin(a) * STICK };
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#d6a76a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(m.x - Math.cos(a) * 3, m.y + Math.sin(a) * 3);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();
  ctx.fillStyle = '#f5deb3';
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, 1.6, 0, Math.PI * 2);
  ctx.fill();

  if (k.outro === null) {
    // The notes still to come: one stream falling onto the hit line above the tank (which drum each
    // goes to is automatic, alternating).
    const line = c.y - HIT_LINE;
    const pulse = Math.max(0, 1 - ((k.t % beat) / beat) * 3) * (k.t >= drum.countIn * beat - beat ? 1 : 0);
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(255,255,255,${0.55 + 0.4 * pulse})`;
    ctx.lineWidth = 2 + pulse;
    ctx.beginPath();
    ctx.moveTo(c.x - 14, line);
    ctx.lineTo(c.x + 14, line);
    ctx.stroke();
    // A faint track for the notes to come down.
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(c.x, line - NOTE_LEAD * NOTE_FALL);
    ctx.lineTo(c.x, line);
    ctx.stroke();
    times.forEach((at, i) => {
      if (k.beats[i] !== 0) return;
      const due = at - k.t;
      if (due > NOTE_LEAD || due < -drum.close) return;
      const y = line - due * NOTE_FALL;
      ctx.globalAlpha = show * Math.min(1, (NOTE_LEAD - due) / 0.2) * (due < 0 ? 0.5 : 1);
      ctx.fillStyle = '#facc15';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(c.x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.globalAlpha = show;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const say = (text: string, x: number, y: number, size: number, colour: string) => {
      ctx.font = `bold ${size}px system-ui, sans-serif`;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = 3;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = colour;
      ctx.fillText(text, x, y);
    };
    // Beside the hit line: the count-in (1, 2, 3, 4) and the misses on the left, the latest verdict on the right.
    if (k.t < drum.countIn * beat) say(String(Math.floor(k.t / beat) + 1), c.x - 30, line, 16, '#fde68a');
    else if (k.misses > 0) say('✖'.repeat(k.misses), c.x - 32, line, 8, '#f87171');
    if (k.last && k.t - k.last.at < VERDICT) {
      const age = (k.t - k.last.at) / VERDICT;
      const [text, colour] = k.last.beat === 1 ? ['PERFECT!', '#86efac'] : k.last.beat === 2 ? ['CLOSE', '#fde68a'] : ['MISS', '#f87171'];
      say(text, c.x + 40, line - age * 6, 9, colour);
    }
    // What it's healed so far.
    if (k.healed > 0) say(`+${k.healed}`, c.x, c.y + 16, 8, '#86efac');
  }
  ctx.restore();
}

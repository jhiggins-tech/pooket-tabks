import type { GameState, Runner } from '../../game/state';
import type { Draw } from './context';

/** ciarra's Marathon runner. */

/**
 * Marathon: a short little runner with tan skin and a swinging rose ponytail, in a crop singlet (the
 * owner's colour) with a race bib, running shorts and white trainers, arms and legs pumping.
 */
export function drawRunner(d: Draw, r: Runner, state: GameState): void {
  const { ctx } = d;
  const colour = state.players[r.ownerId]?.colour ?? '#f472b6';
  const SKIN = '#c68a5c';
  const SKIN_SHADE = '#a26a42';
  const HAIR = '#d23f6b';
  const HAIR_LIGHT = '#f07a9c';
  const HIPS = 2.4; // she's short: legs and torso are cut down, the head stays full size
  const moving = r.legLeft > 0;
  const phase = r.distance * 0.35;
  const s = moving ? Math.sin(phase) : 0.15;
  const bounce = moving ? Math.abs(Math.cos(phase)) * 1.5 : 0;
  ctx.save();
  ctx.translate(r.x, r.y - 1 - bounce);
  ctx.scale(r.dir, 1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // One leg: hip → knee → foot, with a white trainer. `k` is its stride (−1…1).
  const leg = (k: number, skin: string) => {
    const knee = { x: 2.4 * k + 0.8, y: -3.6 };
    const foot = { x: 2.9 * k - (k < 0 ? 1.4 : 0.3), y: -0.6 };
    ctx.strokeStyle = skin;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(0, -6.6);
    ctx.lineTo(knee.x, knee.y);
    ctx.lineTo(foot.x, foot.y);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(foot.x - 0.6, foot.y + 0.2);
    ctx.lineTo(foot.x + 1.6, foot.y + 0.2);
    ctx.stroke();
  };
  // One arm, bent at the elbow, swinging opposite its leg.
  const arm = (k: number, skin: string) => {
    ctx.strokeStyle = skin;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(0.3, -14.2 + HIPS);
    ctx.lineTo(-2.2 * k, -12 + HIPS);
    ctx.lineTo(-2.2 * k + 1.6, -11 + HIPS - Math.max(0, k) * 1.1);
    ctx.stroke();
  };

  // Far side first, in shade.
  leg(-s, SKIN_SHADE);
  arm(-s, SKIN_SHADE);

  // Rose ponytail streaming behind, swinging with the stride.
  const sway = moving ? Math.cos(phase * 2) * 1.1 : 0.6;
  ctx.fillStyle = HAIR;
  ctx.beginPath();
  ctx.moveTo(-1.4, -20.4 + HIPS);
  ctx.quadraticCurveTo(-5.2, -20.7 + HIPS + sway * 0.4, -6.2, -16.4 + HIPS + sway);
  ctx.quadraticCurveTo(-4.2, -17.4 + HIPS + sway * 0.5, -1.9, -17.8 + HIPS);
  ctx.closePath();
  ctx.fill();

  // Shorts and crop singlet with a race bib.
  ctx.fillStyle = '#1f2437';
  ctx.fillRect(-2.2, -10.4 + HIPS, 4.4, 2.6);
  ctx.fillStyle = SKIN; // a sliver of midriff
  ctx.fillRect(-1.9, -11.2 + HIPS, 3.8, 0.9);
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(-2.1, -15.4 + HIPS);
  ctx.lineTo(2.5, -15.4 + HIPS);
  ctx.lineTo(2.2, -11.1 + HIPS);
  ctx.lineTo(-2.0, -11.1 + HIPS);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-1.3, -14.1 + HIPS, 2.9, 2);

  // Near side.
  leg(s, SKIN);
  arm(s, SKIN);

  // Head, then rose hair over the crown and the back.
  ctx.fillStyle = SKIN;
  ctx.fillRect(-0.2, -16.6 + HIPS, 1.3, 1.4); // neck
  ctx.beginPath();
  ctx.arc(0.6, -18.5 + HIPS, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = HAIR;
  ctx.beginPath();
  ctx.arc(0.4, -18.8 + HIPS, 2.8, Math.PI * 0.62, Math.PI * 2.02);
  ctx.quadraticCurveTo(1.2, -19.4 + HIPS, -0.6, -19 + HIPS);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = HAIR_LIGHT;
  ctx.fillRect(-0.9, -21.2 + HIPS, 2.2, 0.7); // shine
  ctx.fillStyle = '#2b1d14';
  ctx.fillRect(1.9, -18.6 + HIPS, 0.7, 0.8); // eye
  ctx.restore();
}

export function drawRunners(d: Draw, state: GameState): void {
  for (const r of state.runners) drawRunner(d, r, state);
}

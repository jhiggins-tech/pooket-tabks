import { TANK_BODY_HEIGHT } from '../../game/constants';
import type { GameState, Player } from '../../game/state';
import { withAlpha } from './colour';
import type { Draw } from './context';

/**
 * doctorfox's Arwing (game/movement.ts): taking off, the tank lifts on a jet of thrust and folds out into the
 * ship in a flash; flying, the ship with its booster lit and speed lines; landing, the same in reverse. All
 * from `Player.flight`, so a phone watching his previews sees it too.
 */

/** How far into the ship it is: 0 a tank, 1 the Arwing (eased). */
export function arwingAmount(p: Player): number {
  const f = p.flight;
  if (!f) return 0;
  if (f.stage === 'cruise') return 1;
  const t = f.stage === 'takeoff' ? f.t : 1 - f.t;
  return t * t * (3 - 2 * t);
}

/** Draws doctorfox in the air: `drawTank` draws the tank itself (faded) while it's turning into the ship or back. */
export function drawArwingFlight(d: Draw, p: Player, state: GameState, drawTank: (alpha: number) => void): void {
  const f = p.flight;
  if (!f) return;
  const k = arwingAmount(p);
  const { ctx } = d;
  const cx = p.x;
  const cy = p.y - TANK_BODY_HEIGHT;
  // Thrust: straight down while it lifts off or sets down, swinging back behind it as it flies.
  if (f.stage !== 'cruise') drawLiftJet(d, cx, p.y, 1 - Math.abs(k - 0.5) * 1.2);
  // The tank, fading as the ship folds out of it (first half), or back in (landing's second half).
  const tankAlpha = Math.max(0, 1 - k * 2);
  if (tankAlpha > 0) drawTank(tankAlpha);
  const shipK = Math.max(0, Math.min(1, k * 2 - 0.4));
  if (shipK > 0) {
    ctx.save();
    ctx.translate(cx, cy + Math.sin(d.time * 5) * 1.2 * shipK);
    ctx.scale(f.dir * 1.3, 1.3);
    ctx.rotate(f.stage === 'cruise' ? -0.06 : (1 - shipK) * -0.5);
    ctx.globalAlpha *= Math.min(1, shipK * 1.5);
    if (f.stage === 'cruise') drawSpeedLines(d);
    drawArwing(d, p.colour, shipK);
    ctx.restore();
  }
  // The transformation flash: a white burst and a ring, peaking halfway through.
  const flash = f.stage === 'cruise' ? 0 : Math.max(0, 1 - Math.abs(k - 0.5) * 4);
  if (flash > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 26);
    g.addColorStop(0, `rgba(255,255,255,${0.9 * flash})`);
    g.addColorStop(0.4, `rgba(140,200,255,${0.5 * flash})`);
    g.addColorStop(1, 'rgba(140,200,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${flash})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 10 + (1 - flash) * 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (tankAlpha <= 0 && state.players[state.current] === p && state.phase === 'aiming') drawMarker(d, cx, cy - 22);
}

/** The ship, nose to +x, centred on its body, a stripe of `colour` down its side; `unfold` (0–1) opens its wings. */
export function drawArwing(d: Draw, colour: string, unfold = 1): void {
  const { ctx } = d;
  const outline = 'rgba(20,24,40,0.85)';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1;
  // Booster flame out of the back.
  const flick = 0.75 + 0.25 * Math.sin(d.time * 47) * Math.sin(d.time * 31);
  const flame = ctx.createLinearGradient(-14, 0, -14 - 14 * flick, 0);
  flame.addColorStop(0, '#ffffff');
  flame.addColorStop(0.35, '#7dd3fc');
  flame.addColorStop(1, 'rgba(59,130,246,0)');
  ctx.fillStyle = flame;
  ctx.beginPath();
  ctx.moveTo(-13, -3.5);
  ctx.lineTo(-14 - 14 * flick, -0.5);
  ctx.lineTo(-13, 2.5);
  ctx.closePath();
  ctx.fill();
  // Far wing (behind the body): darker, angled up to its blue fin.
  ctx.save();
  ctx.scale(1, unfold);
  ctx.fillStyle = '#9ca3af';
  ctx.strokeStyle = outline;
  ctx.beginPath();
  ctx.moveTo(2, -2);
  ctx.lineTo(-10, -11);
  ctx.lineTo(-13, -11);
  ctx.lineTo(-8, -2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#2563eb';
  ctx.beginPath();
  ctx.moveTo(-10, -11);
  ctx.lineTo(-15, -16);
  ctx.lineTo(-13, -11);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  // Body: a long wedge to a pointed nose, the engine block at the back.
  ctx.fillStyle = '#e5e7eb';
  ctx.strokeStyle = outline;
  ctx.beginPath();
  ctx.moveTo(19, 0.5);
  ctx.lineTo(3, -4.5);
  ctx.lineTo(-13, -4.5);
  ctx.lineTo(-14, 3);
  ctx.lineTo(4, 3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // A stripe in the player's colour down the side, and the engine's intake.
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(13, 0.5);
  ctx.lineTo(-12, -0.8);
  ctx.lineTo(-12, 1.2);
  ctx.lineTo(10, 1.6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#6b7280';
  ctx.fillRect(-14, -4, 3, 6.5);
  // The cockpit canopy.
  ctx.fillStyle = '#38bdf8';
  ctx.strokeStyle = outline;
  ctx.beginPath();
  ctx.ellipse(1, -4.5, 5.5, 2.6, 0, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillRect(-0.5, -6.2, 2.5, 1);
  // Near wing (in front of the body): swept back and down to its blue fin, which tips up.
  ctx.save();
  ctx.scale(1, unfold);
  ctx.fillStyle = '#d1d5db';
  ctx.strokeStyle = outline;
  ctx.beginPath();
  ctx.moveTo(5, 1.5);
  ctx.lineTo(-11, 9);
  ctx.lineTo(-15, 9);
  ctx.lineTo(-8, 1.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#3b82f6';
  ctx.beginPath();
  ctx.moveTo(-11, 9);
  ctx.lineTo(-17, 2);
  ctx.lineTo(-15, 9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** A jet of thrust straight down from under the tank while it lifts off or sets down. */
function drawLiftJet(d: Draw, x: number, groundY: number, strength: number): void {
  if (strength <= 0) return;
  const { ctx } = d;
  const len = (10 + 6 * Math.sin(d.time * 53)) * strength;
  ctx.save();
  const g = ctx.createLinearGradient(x, groundY, x, groundY + len);
  g.addColorStop(0, withAlpha('#ffffff', 0.9 * strength));
  g.addColorStop(0.4, withAlpha('#7dd3fc', 0.7 * strength));
  g.addColorStop(1, 'rgba(59,130,246,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - 6, groundY);
  ctx.lineTo(x + 6, groundY);
  ctx.lineTo(x, groundY + len);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Speed lines streaming off behind the ship. */
function drawSpeedLines(d: Draw): void {
  const { ctx } = d;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  for (const [k, y] of [[0, -9], [1, 0], [2, 7]] as const) {
    const off = (d.time * 120 + k * 9) % 16;
    ctx.beginPath();
    ctx.moveTo(-26 - off, y);
    ctx.lineTo(-34 - off - k * 3, y);
    ctx.stroke();
  }
  ctx.restore();
}

/** The bobbing white arrow over the current player, as over a tank (tank.ts). */
function drawMarker(d: Draw, x: number, y0: number): void {
  const { ctx } = d;
  const y = y0 + Math.sin(d.time * 6) * 3;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(x - 7, y - 8);
  ctx.lineTo(x + 7, y - 8);
  ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
}

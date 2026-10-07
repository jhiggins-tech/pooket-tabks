import { getCharacter } from '../../characters/roster';
import { BARREL_LENGTH, TANK_BODY_HEIGHT, TANK_HALF_WIDTH } from '../../game/constants';
import { canPickDecoy, capSpot, currentPlayer, HOLOGRAM_PHASE_IN, hologramsOf, isAimless, isSpewing, muzzle, pendingTwinSpot, tankCentre, wearsCap } from '../../game/game';
import type { Burn, GameState, Player } from '../../game/state';
import { glow, noise, withAlpha } from './colour';
import type { Draw } from './context';
import { drawFlatCap } from './boomerang';
import { drawJet } from './jetpack';

/**
 * Tanks (and their hologram, twin and ghost copies; kiwicore's flat cap: boomerang.ts), garyoldmancorp's scooter, the spew gush, the swap
 * marker and the aim guide (the jetpack's charge and flame: jetpack.ts).
 */

/** Where a copy of a player's tank is drawn instead of the tank: their twin (its own burn and aim), a hologram, a ghost. */
export interface TankCopy {
  x: number;
  y: number;
  /** Its own burn (null: none); else the player's. */
  burn?: Burn | null;
  /** Its own aim; else the player's. */
  angle?: number;
}

/**
 * Draws player p's tank, or (with `at`) a copy of it at another spot: their twin (with its own burn), or
 * a hologram (looking just like the real tank, statuses and all).
 */
export function drawTank(d: Draw, owner: Player, state: GameState, at?: TankCopy): void {
  const { ctx } = d;
  const p: Player = at ? { ...owner, x: at.x, y: at.y, burn: at.burn === undefined ? owner.burn : at.burn, angle: at.angle ?? owner.angle } : owner;
  const c = tankCentre(p);
  const isCurrent = !at && state.players[state.current] === owner && state.phase !== 'gameover';

  if (p.cooked && p.alive) {
    // Cooked: an orange heat glow and wisps of steam rising off the hull.
    glow(ctx, c.x, c.y + 4, 20, [[0, `rgba(255,140,40,${0.35 + 0.15 * Math.sin(d.time * 6)})`], [1, 'rgba(255,120,30,0)']], 2);
    ctx.save();
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const k = (d.time * 0.8 + i / 3) % 1;
      const x0 = c.x - 6 + i * 6;
      ctx.strokeStyle = `rgba(240,240,255,${0.6 * (1 - k)})`;
      ctx.beginPath();
      for (let j = 0; j <= 6; j++) {
        const y = c.y - 8 - j * 2 - k * 10;
        const x = x0 + Math.sin(j * 1.3 + d.time * 5 + i) * 1.6;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  if (p.burn && p.alive) {
    // Pulsing glow while a Hyperfixate burn is still ticking.
    const pulse = 0.55 + 0.45 * Math.sin(d.time * 8);
    glow(ctx, c.x, c.y, 22, [[0, withAlpha(p.burn.colour, 0.55 * pulse)], [1, withAlpha(p.burn.colour, 0)]], 2);
  }

  ctx.save();
  ctx.globalAlpha *= p.alive ? 1 : 0.35;

  // Barrel
  const m = muzzle(p);
  ctx.strokeStyle = '#1c1c1c';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(c.x, c.y);
  ctx.lineTo(m.x, m.y);
  ctx.stroke();

  // Dome + hull
  ctx.fillStyle = p.colour;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(c.x, c.y, 7, Math.PI, 0);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(p.x - TANK_HALF_WIDTH, p.y - TANK_BODY_HEIGHT, TANK_HALF_WIDTH * 2, TANK_BODY_HEIGHT, 3);
  ctx.fill();
  ctx.stroke();
  if (p.tattoo && p.alive) {
    // Tattooed: a little ink heart and flash lines on the hull.
    ctx.fillStyle = '#1e2a4a';
    ctx.beginPath();
    const hx = p.x - 4;
    const hy = p.y - 4.5;
    ctx.moveTo(hx, hy + 2.2);
    ctx.bezierCurveTo(hx - 3, hy, hx - 2, hy - 2.4, hx, hy - 1);
    ctx.bezierCurveTo(hx + 2, hy - 2.4, hx + 3, hy, hx, hy + 2.2);
    ctx.fill();
    ctx.strokeStyle = '#1e2a4a';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(p.x + 1, p.y - 6);
    ctx.lineTo(p.x + 7, p.y - 6);
    ctx.moveTo(p.x + 2, p.y - 3.5);
    ctx.lineTo(p.x + 8, p.y - 3.5);
    ctx.stroke();
  }
  if (p.pinned && p.alive) {
    // Pinned: pink cross-stitches over the hull.
    ctx.strokeStyle = '#f472b6';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (const sx of [-7, 0, 7]) {
      ctx.moveTo(p.x + sx - 2.5, p.y - TANK_BODY_HEIGHT - 1);
      ctx.lineTo(p.x + sx + 2.5, p.y + 1);
      ctx.moveTo(p.x + sx + 2.5, p.y - TANK_BODY_HEIGHT - 1);
      ctx.lineTo(p.x + sx - 2.5, p.y + 1);
    }
    ctx.stroke();
  }
  if (wearsCap(state, owner)) {
    // kiwicore's flat cap, peak the way he's aiming (off while his béretta M2 is flying).
    const cap = capSpot(p);
    drawFlatCap(ctx, cap.x, cap.y + 2, Math.cos((p.angle * Math.PI) / 180) >= 0 ? 1 : -1);
  }
  ctx.restore();

  if (isCurrent && state.phase === 'aiming') drawTurnMarker(d, c);
}

/** The bobbing white arrow over the current player's tank, `c` its centre. */
function drawTurnMarker(d: Draw, c: { x: number; y: number }): void {
  const { ctx } = d;
  const y = c.y - BARREL_LENGTH - 16 + Math.sin(d.time * 6) * 3;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(c.x - 7, y - 8);
  ctx.lineTo(c.x + 7, y - 8);
  ctx.lineTo(c.x, y);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draws a tank through a hologram glitch: horizontal slices jitter sideways, it flickers and
 * gets cyan scan lines. `build` (0–1) reveals it from the ground up; `squash` flattens it.
 */
export function drawGlitchedTank(
  d: Draw,
  owner: Player,
  state: GameState,
  at: TankCopy | undefined,
  glitch: number,
  build: number,
  alpha: number,
  squash = 1,
): void {
  const { ctx } = d;
  const pos = at ?? owner;
  if (glitch < 0.02 && build >= 1 && alpha >= 1 && squash >= 1) {
    drawTank(d, owner, state, at);
    return;
  }
  const top = pos.y - 34;
  const height = 36;
  const slices = 7;
  const tick = Math.floor(d.time * 24);
  ctx.save();
  // Squash towards the ground line.
  ctx.translate(pos.x, pos.y);
  ctx.scale(1 + (1 - squash) * 0.6, squash);
  ctx.translate(-pos.x, -pos.y);
  for (let i = 0; i < slices; i++) {
    const y0 = top + (i * height) / slices;
    if (y0 + height / slices < pos.y + 2 - height * build) continue; // not built yet
    const jitter = (noise(i * 13.1 + tick) - 0.5) * 10 * glitch;
    ctx.save();
    ctx.beginPath();
    ctx.rect(pos.x - 40, Math.max(y0, pos.y + 2 - height * build), 80, height / slices + 0.5);
    ctx.clip();
    ctx.translate(jitter, 0);
    ctx.globalAlpha = alpha * (1 - glitch * 0.45 * noise(i * 5.7 + tick * 3.3));
    drawTank(d, owner, state, at);
    ctx.restore();
  }
  if (glitch > 0.02) {
    ctx.globalAlpha = alpha * Math.min(1, glitch) * 0.55;
    ctx.fillStyle = '#7cf7d4';
    const off = (d.time * 30) % 3;
    for (let y = top + off; y < pos.y + 2; y += 3) {
      if (y < pos.y + 2 - height * build) continue;
      ctx.fillRect(pos.x - 13 + (noise(y + tick) - 0.5) * 6 * glitch, y, 26, 1);
    }
  }
  ctx.restore();
}

/** A wobbling gush at the barrel while ten-3 is spewing. */
export function drawSpewGush(d: Draw, p: Player): void {
  const { ctx } = d;
  const m = muzzle(p);
  const a = (p.angle * Math.PI) / 180;
  const wob = Math.sin(d.time * 30);
  ctx.save();
  ctx.translate(m.x, m.y);
  ctx.rotate(-a);
  ctx.fillStyle = '#6b4a16';
  ctx.beginPath();
  ctx.ellipse(5, 0, 7 + wob, 4.5 - wob * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e8b84e';
  ctx.beginPath();
  ctx.ellipse(5, 0, 6 + wob, 3.5 - wob * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Subtle dashed ring on the hologram the current player will swap to. */
export function drawSwapMarker(d: Draw, at: { x: number; y: number }): void {
  const { ctx } = d;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 4]);
  ctx.lineDashOffset = -d.time * 12;
  ctx.beginPath();
  ctx.arc(at.x, at.y - TANK_BODY_HEIGHT, 17, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function drawAimGuide(d: Draw, p: Player, faint = false): void {
  const { ctx } = d;
  const m = muzzle(p);
  const a = (p.angle * Math.PI) / 180;
  const len = 20 + p.power * 1.2;
  ctx.save();
  ctx.strokeStyle = faint ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.moveTo(m.x, m.y);
  ctx.lineTo(m.x + Math.cos(a) * len, m.y - Math.sin(a) * len);
  ctx.stroke();
  ctx.restore();
}

/**
 * Every player's tanks: holograms (drawn exactly like the real tank, so there's no tell: the shared shimmer
 * glitches every copy, real one included, at the same moment), the twin (phasing in when it appears), the
 * tank itself (with a jetpack's charge and flame) and a spew's gush.
 */
export function drawTanks(d: Draw, state: GameState): void {
  for (const p of state.players) {
    const shimmer = state.fx.shimmers.find((s) => s.ownerId === p.id);
    const shimmerAmt = shimmer ? Math.sin(Math.PI * (shimmer.age / shimmer.duration)) : 0;
    for (const h of hologramsOf(state, p.id)) {
      const phaseIn = Math.min(1, h.age / HOLOGRAM_PHASE_IN);
      drawGlitchedTank(d, p, state, h, Math.max(shimmerAmt, 1 - phaseIn), phaseIn, 1);
      if (state.swapTargetId === h.id && canPickDecoy(state) && currentPlayer(state) === p) drawSwapMarker(d, h);
    }
    if (p.twin && p.alive) {
      const phaseIn = Math.min(1, p.twin.age / HOLOGRAM_PHASE_IN);
      drawGlitchedTank(d, p, state, p.twin, 1 - phaseIn, phaseIn, 1);
    }
    const ride = scooterRide(d, p, state);
    if (ride) drawScooter(d, p, state, ride);
    else drawJet(d, p, state, () => drawGlitchedTank(d, p, state, undefined, shimmerAmt, 1, 1));
    if (isSpewing(state, p.id)) drawSpewGush(d, p);
  }
}

/**
 * The aim guide, while the current player is aiming something that aims: with a twin, one from each tank
 * (the one being aimed bright, the other faint). And while placing a twin, a ghost of it where it'll go.
 */
export function drawAim(d: Draw, state: GameState): void {
  const p = currentPlayer(state);
  const spot = pendingTwinSpot(state);
  if (spot !== null) drawTwinGhost(d, state, p, spot);
  if (state.phase !== 'aiming' || isAimless(state)) return;
  if (p.twin) drawAimGuide(d, { ...p, x: p.twin.x, y: p.twin.y, angle: p.twin.angle, power: p.twin.power }, !p.aimTwin);
  drawAimGuide(d, p, !!p.twin && p.aimTwin);
}

/** Where the twin will appear: a see-through tank and a dashed ring, pulsing. */
function drawTwinGhost(d: Draw, state: GameState, p: Player, x: number): void {
  const { ctx } = d;
  const y = state.terrain.surfaceY(x);
  const pulse = 0.5 + 0.5 * Math.sin(d.time * 4);
  drawGlitchedTank(d, p, state, { x, y, burn: null }, 0.15, 1, 0.55 + 0.2 * pulse);
  ctx.save();
  ctx.strokeStyle = withAlpha(p.colour, 0.55 + 0.3 * pulse);
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.arc(x, y - TANK_BODY_HEIGHT, TANK_HALF_WIDTH + 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * garyoldmancorp rides a scooter while he moves: this works it out from the tank's position frame to
 * frame (cosmetic, so it shows the same for a phone watching his previews), and says which way he's going.
 */
function scooterRide(d: Draw, p: Player, state: GameState): { dir: number } | null {
  if (getCharacter(p.characterId).movement !== 'scooter') return null;
  const last = d.rides.get(p.id);
  const dx = last ? p.x - last.x : 0;
  // Only driving along the ground while aiming (not a jetpack, nor a jump to a new match or snapshot).
  const riding = state.phase === 'aiming' && !p.hop && Math.abs(dx) > 0.05 && Math.abs(dx) < 30;
  const r = { x: p.x, until: riding ? d.time + 0.25 : (last?.until ?? 0), dir: riding ? Math.sign(dx) : (last?.dir ?? 1) };
  d.rides.set(p.id, r);
  return p.alive && state.phase === 'aiming' && d.time < r.until ? { dir: r.dir } : null;
}

/** The scooter: two little wheels, a deck in the rider's colour, the stem and bars, and his dome riding on it. */
function drawScooter(d: Draw, p: Player, state: GameState, ride: { dir: number }): void {
  const { ctx } = d;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(ride.dir, 1); // forward is +x
  const lean = Math.sin(d.time * 30) * 0.6;
  // Speed lines streaming off the back.
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  for (const [k, y] of [[0, -6], [1, -11], [2, -16]] as const) {
    const off = (d.time * 90 + k * 7) % 12;
    ctx.beginPath();
    ctx.moveTo(-13 - off, y);
    ctx.lineTo(-20 - off - k * 2, y);
    ctx.stroke();
  }
  // Wheels.
  for (const wx of [-8, 8]) {
    ctx.fillStyle = '#1c1c1c';
    ctx.beginPath();
    ctx.arc(wx, -3.2, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9aa3b2';
    ctx.beginPath();
    ctx.arc(wx, -3.2, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  // Deck.
  ctx.fillStyle = p.colour;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(-10, -7.5, 17, 3, 1.5);
  ctx.fill();
  ctx.stroke();
  // Stem and handlebars.
  ctx.strokeStyle = '#9aa3b2';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(8, -3.2);
  ctx.lineTo(6, -19);
  ctx.moveTo(3, -19);
  ctx.lineTo(9, -19.5);
  ctx.stroke();
  // The rider: the tank's dome, leaning into it, barrel tucked forward.
  ctx.strokeStyle = '#1c1c1c';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-1, -13 + lean);
  ctx.lineTo(5, -16 + lean);
  ctx.stroke();
  ctx.fillStyle = p.colour;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(-2, -8 + lean, 6, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  if (state.players[state.current] === p) drawTurnMarker(d, tankCentre(p));
}

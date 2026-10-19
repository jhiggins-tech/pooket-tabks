import { BEACON_TIME, LASER_TIME, SENTRY_HEIGHT } from '../../game/game';
import type { Crate, GameState, Sentry, StratagemDrop } from '../../game/state';
import { stratagemOf, type StratagemDef } from '../../weapons/stratagems';
import type { Draw } from './context';

/**
 * ShotDownBoyz's stratagems in the world (game/stratagems.ts): the beacon blinking where it landed with
 * its column of light up into the sky (red for ordnance, blue for a weapon, green for supplies, amber for
 * a turret, as in Helldivers), the Orbital Laser burning down, pods falling, sentries on their tripods
 * (rounds left as lights) and pods on the ground waiting to be picked up.
 */

/** The beacon's colour for each kind of stratagem. */
function hue(def: StratagemDef): string {
  return def.category === 'ordnance' ? '#ef4444' : def.category === 'weapon' ? '#60a5fa' : def.category === 'supply' ? '#4ade80' : '#fbbf24';
}

/** Behind the tanks: sentries and pods on the ground. */
export function drawStratagemGround(d: Draw, state: GameState): void {
  for (const c of state.crates) drawCrate(d, c, state);
  for (const s of state.sentries) drawSentry(d, s, state);
}

/** Over the shots: beacons, the laser, falling pods. */
export function drawStratagemDrops(d: Draw, state: GameState): void {
  for (const drop of state.drops) drawDrop(d, drop);
}

function drawDrop(d: Draw, drop: StratagemDrop): void {
  const { ctx } = d;
  const def = stratagemOf(drop.stratagem);
  const colour = hue(def);
  const lit = drop.t < BEACON_TIME || def.category !== 'ordnance';
  // The beacon: a little spike in the ground with a blinking light, and its column of light.
  ctx.save();
  if (lit) {
    const fade = def.category === 'ordnance' ? 1 : Math.max(0, 1 - Math.max(0, drop.t - BEACON_TIME) * 2);
    const g = ctx.createLinearGradient(0, drop.y, 0, 0);
    g.addColorStop(0, withAlpha(colour, 0.55 * fade));
    g.addColorStop(1, withAlpha(colour, 0));
    ctx.fillStyle = g;
    ctx.fillRect(drop.x - 2.5, 0, 5, drop.y);
  }
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(drop.x - 1, drop.y - 6, 2, 6);
  if (Math.floor(d.time * 6) % 2 === 0) {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(drop.x, drop.y - 7, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  if (def.category === 'ordnance' && def.strike === 'laser' && drop.t >= BEACON_TIME) drawLaser(d, drop);
  if (drop.podY !== null) drawPod(d, drop.x, drop.podY, colour, true);
}

/** The Orbital Laser: a searing red beam from the top of the sky to where it's burning, glowing at the foot. */
function drawLaser(d: Draw, drop: StratagemDrop): void {
  const { ctx } = d;
  const k = Math.min(1, (drop.t - BEACON_TIME) / 0.2, (BEACON_TIME + LASER_TIME - drop.t) / 0.3);
  if (k <= 0) return;
  const flicker = 0.85 + 0.15 * Math.sin(d.time * 50);
  const foot = drop.beamY;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = `rgba(244,63,94,${0.35 * k})`;
  ctx.fillRect(drop.beamX - 7 * flicker, 0, 14 * flicker, foot);
  ctx.fillStyle = `rgba(255,228,230,${0.9 * k})`;
  ctx.fillRect(drop.beamX - 2, 0, 4, foot);
  const g = ctx.createRadialGradient(drop.beamX, foot, 0, drop.beamX, foot, 16);
  g.addColorStop(0, `rgba(255,255,255,${k})`);
  g.addColorStop(0.4, `rgba(251,113,133,${0.7 * k})`);
  g.addColorStop(1, 'rgba(244,63,94,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(drop.beamX, foot, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A drop pod: a dark capsule with a light band in its colour; falling, with a streak of fire above it. */
function drawPod(d: Draw, x: number, y: number, colour: string, falling: boolean): void {
  const { ctx } = d;
  ctx.save();
  if (falling) {
    const g = ctx.createLinearGradient(0, y - 60, 0, y - 12);
    g.addColorStop(0, 'rgba(251,146,60,0)');
    g.addColorStop(1, 'rgba(253,224,71,0.8)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 3, y - 60, 6, 48);
  }
  ctx.fillStyle = '#374151';
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - 6, y - 13, 12, 13, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colour;
  ctx.fillRect(x - 6, y - 8, 12, 2.5);
  ctx.fillStyle = '#9ca3af';
  ctx.fillRect(x - 3, y - 15, 6, 2);
  ctx.restore();
}

/** A pod on the ground, its light pulsing so it's easy to spot (his to pick up). */
function drawCrate(d: Draw, c: Crate, state: GameState): void {
  const def = stratagemOf(c.stratagem);
  const colour = hue(def);
  drawPod(d, c.x, c.y, colour, false);
  const { ctx } = d;
  const pulse = 0.5 + 0.5 * Math.sin(d.time * 4 + c.id);
  ctx.save();
  ctx.globalAlpha = 0.35 + 0.4 * pulse;
  ctx.strokeStyle = state.players[c.ownerId]?.colour ?? colour;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(c.x, c.y - 7, 10 + 2 * pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * A sentry: a tripod and a turret head in its owner's colour, with its gun (a rocket pod, an autocannon
 * barrel, or the Tesla's coil and sparks), and a light for each round it has left.
 */
function drawSentry(d: Draw, s: Sentry, state: GameState): void {
  const { ctx } = d;
  const def = stratagemOf(s.stratagem);
  if (def.category !== 'turret') return;
  const colour = state.players[s.ownerId]?.colour ?? '#f87171';
  const up = Math.min(1, s.age / 0.5);
  const h = SENTRY_HEIGHT * up;
  ctx.save();
  ctx.translate(s.x, s.y);
  // Tripod.
  ctx.strokeStyle = '#4b5563';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.lineTo(0, -h + 4);
  ctx.lineTo(6, 0);
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -h + 4);
  ctx.stroke();
  if (def.sentry === 'tesla') {
    // A coil with copper rings and a crackling ball on top.
    ctx.fillStyle = '#b45309';
    for (let i = 0; i < 3; i++) ctx.fillRect(-3.5 + i * 0.5, -h + 4 - i * 3.2, 7 - i, 2);
    const g = ctx.createRadialGradient(0, -h - 2, 0, 0, -h - 2, 6);
    g.addColorStop(0, '#f0f9ff');
    g.addColorStop(1, 'rgba(125,211,252,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, -h - 2, 5 + Math.sin(d.time * 20) * 1, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // The head, turned toward where it last fired.
    ctx.save();
    ctx.translate(0, -h + 3);
    ctx.fillStyle = colour;
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-5, -4, 10, 7, 2);
    ctx.fill();
    ctx.stroke();
    ctx.rotate((-s.aim * Math.PI) / 180);
    ctx.fillStyle = '#1f2937';
    if (def.sentry === 'rocket') {
      ctx.fillRect(1, -4, 9, 3.5);
      ctx.fillRect(1, 0.5, 9, 3.5);
    } else ctx.fillRect(2, -1.2, 13, 2.4);
    ctx.restore();
  }
  // Rounds left.
  for (let i = 0; i < def.shots; i++) {
    ctx.fillStyle = i < s.shots ? '#a3e635' : '#374151';
    ctx.fillRect(-5 + i * 4, 2, 2.5, 2);
  }
  ctx.restore();
}

/** '#rrggbb' as an rgba() at `a`. */
function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

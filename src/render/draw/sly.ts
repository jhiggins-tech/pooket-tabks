import type { GameState, Player } from '../../game/state';
import { BARREL_LENGTH } from '../../game/constants';
import { noise } from './colour';
import type { Draw } from './context';

/**
 * doctorfox's Sly (game/sly.ts): the smokescreens, and how a hidden tank shows. The other players don't
 * see it at all; he sees a faint ghost of himself (online, on his own phone; on a shared phone, only while
 * he's sneaking off, since that's when he needs to see where he's going).
 */

/** How solid a hidden tank's ghost is, for the one who's hiding. */
const GHOST = 0.35;

/** How much of `p`'s tank this phone shows: 1 all of it, a ghost, or 0 (hidden, from this viewer). */
export function tankShown(d: Draw, state: GameState, p: Player): number {
  if (!p.hidden || !p.alive || state.phase === 'gameover') return 1;
  const sneaking = state.phase === 'sneaking' && state.current === p.id;
  return d.viewer === p.id || (d.viewer === null && sneaking) ? GHOST : 0;
}

/** How long "STEALTH POWERUP ACTIVATED" shows (s). */
const STEALTH_UP = 2;

/**
 * "STEALTH POWERUP ACTIVATED" over his ghost when he first moves under the smoke: for his eyes only (where
 * his ghost shows), popping in big and floating up as it fades.
 */
export function drawStealthUp(d: Draw, state: GameState): void {
  const k = state.phase === 'sneaking' ? state.sneak : null;
  const p = k && state.players[k.playerId];
  if (!k || !p || k.movedAt === null || tankShown(d, state, p) <= 0 || tankShown(d, state, p) >= 1) return;
  const age = k.t - k.movedAt;
  if (age < 0 || age >= STEALTH_UP) return;
  const { ctx } = d;
  const pop = age < 0.15 ? 0.6 + (0.4 * age) / 0.15 + 0.15 * Math.sin((Math.PI * age) / 0.15) : 1;
  const fade = age < STEALTH_UP - 0.5 ? 1 : (STEALTH_UP - age) / 0.5;
  ctx.save();
  ctx.translate(p.x, p.y - BARREL_LENGTH - 30 - age * 8);
  ctx.scale(pop, pop);
  ctx.globalAlpha = fade;
  ctx.font = '800 11px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(20,20,30,0.85)';
  ctx.fillStyle = '#fdba74';
  for (const [line, y] of [['STEALTH POWERUP', -7], ['ACTIVATED', 7]] as const) {
    ctx.strokeText(line, 0, y);
    ctx.fillText(line, 0, y);
  }
  ctx.restore();
}

/** Puffs per smokescreen. */
const PUFFS = 14;

/** Grey puffs billowing out from where he was, then thinning away. */
export function drawSmokes(d: Draw, state: GameState): void {
  const { ctx } = d;
  for (const s of state.fx.smokes) {
    const k = s.age / s.duration;
    const grow = 1 - (1 - Math.min(1, s.age / 0.5)) ** 3; // out fast, then hangs
    const fade = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    const size = s.duration > 2 ? 1 : 0.5; // the smokescreen, or the little puff when he's spotted
    ctx.save();
    for (let i = 0; i < PUFFS; i++) {
      const a = noise(i * 7.3 + s.x) * Math.PI * 2;
      const reach = (10 + noise(i * 3.1 + s.y) * 34) * size * grow;
      const drift = s.age * (4 + noise(i * 1.7) * 6);
      const x = s.x + Math.cos(a) * reach * 1.4 + Math.sin(d.time * 0.8 + i) * 2;
      const y = s.y - 6 + Math.sin(a) * reach * 0.7 - drift;
      const r = (10 + noise(i * 9.9) * 10) * size * (0.5 + 0.5 * grow);
      const grey = 150 + Math.round(noise(i * 4.4) * 70);
      ctx.globalAlpha = 0.85 * fade;
      ctx.fillStyle = `rgb(${grey},${grey},${grey + 8})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

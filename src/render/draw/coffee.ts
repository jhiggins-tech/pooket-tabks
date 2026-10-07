import { TANK_BODY_HEIGHT } from '../../game/constants';
import { COFFEE_SIP, COFFEE_SPIN } from '../../game/game';
import type { GameState } from '../../game/state';
import type { Draw } from './context';
import { spriteReady } from '../sprites';

/**
 * Diced Coffee: the iced coffee by the tank while the spinner spins. Lactose free: the tank lifts it,
 * tips it back and drains it through the straw (the level drops), then it's gone. Full cream: it topples
 * over and spills (the little jetpack is the tank's own: draw/jetpack.ts `drawJet`).
 */
export function drawCoffee(d: Draw, state: GameState): void {
  const c = state.coffee;
  const p = c && state.players[c.playerId];
  if (!c || !p) return;
  const sprite = d.sprites['iced-coffee'];
  if (!spriteReady(sprite)) return;
  const { ctx } = d;
  const { width: w, height: h } = sprite;
  // On the side the barrel isn't pointing, sitting on the ground by the tracks.
  const side = Math.cos((p.angle * Math.PI) / 180) >= 0 ? -1 : 1;
  const after = c.t - COFFEE_SPIN;
  let x = p.x + side * 17;
  let y = p.y;
  let tilt = 0;
  let level = 1;
  let alpha = 1;
  if (after > 0 && !c.fail) {
    // Up to the hatch, tipped back towards the tank, drained, then gone.
    const k = Math.min(1, after / (COFFEE_SIP * 0.25));
    x = p.x + side * (17 - 8 * k);
    y = p.y - TANK_BODY_HEIGHT * 1.6 * k;
    tilt = -side * 0.5 * k + Math.sin(d.time * 18) * 0.04 * k;
    level = Math.max(0, 1 - Math.max(0, after - COFFEE_SIP * 0.25) / (COFFEE_SIP * 0.55));
    alpha = Math.min(1, Math.max(0, (COFFEE_SIP - after) / 0.25));
  } else if (after > 0) {
    // Knocked over, spilling, fading.
    tilt = side * Math.min(Math.PI / 2, after * 6);
    alpha = Math.min(1, Math.max(0, 1 - (after - 0.6) / 0.5));
  } else {
    // A little jiggle while the wheel spins (it's full of ice).
    tilt = Math.sin(d.time * 9) * 0.05;
  }
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.drawImage(sprite.image, -w / 2, -h, w, h);
  // Drained: the empty part of the cup is clear plastic again (the coffee is the lower 26/48 of the art).
  if (level < 1) {
    const top = -h + h * (21 / 48);
    const coffee = h * (25 / 48);
    ctx.fillStyle = 'rgba(233, 246, 255, 0.92)';
    ctx.fillRect(-w * 0.32, top, w * 0.64, coffee * (1 - level));
  }
  ctx.restore();
}

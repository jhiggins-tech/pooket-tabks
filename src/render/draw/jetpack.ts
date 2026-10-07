import { jetCharge, tankCentre } from '../../game/game';
import type { GameState, Player } from '../../game/state';
import { glow, noise, withAlpha } from './colour';
import type { Draw } from './context';

/** tones2's ten-2 jetpack on the tank (game/jetpack.ts): the charge's shake and haze, and the flame in flight. */

/**
 * ten-2: while charging the tank shakes harder and harder in a growing dust haze; once airborne it
 * blasts a plume of mud out of the back. `draw` renders the tank itself.
 */
export function drawJet(d: Draw, p: Player, state: GameState, draw: () => void): void {
  const { ctx } = d;
  const jet = state.jets.find((j) => j.playerId === p.id);
  if (!jet) return draw();
  const c = tankCentre(p);
  const charge = jetCharge(state, p.id);
  if (charge !== null) {
    const amp = 0.4 + 3.6 * charge * charge;
    const t = Math.floor(d.time * 45);
    // Dusty haze kicked up around the tracks.
    glow(ctx, p.x, p.y, 10 + 18 * charge, [[0, withAlpha('#8a6440', 0.1 + 0.45 * charge)], [1, withAlpha('#8a6440', 0)]]);
    ctx.save();
    ctx.translate((noise(t) - 0.5) * 2 * amp, (noise(t * 1.7 + 3) - 0.5) * amp);
    draw();
    ctx.restore();
    return;
  }
  if (jet.burnLeft > 0) {
    // Exhaust out of the back, flickering, pointing against the launch direction.
    const back = jet.heading + Math.PI;
    const len = 18 + 12 * noise(Math.floor(d.time * 40));
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(-back);
    // Teardrop reaching well past the hull (half-width 11) so it isn't hidden behind the tank.
    const tip = len + 8;
    // A mud blast: a small hot core at the nozzle, then a plume of brown dirt.
    const g = ctx.createLinearGradient(6, 0, tip, 0);
    g.addColorStop(0, 'rgba(255,214,150,0.95)');
    g.addColorStop(0.14, 'rgba(150,104,62,0.95)');
    g.addColorStop(0.55, 'rgba(96,64,36,0.8)');
    g.addColorStop(1, 'rgba(70,46,26,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(6, -5.5);
    ctx.quadraticCurveTo(tip * 0.6, -4.5, tip, 0);
    ctx.quadraticCurveTo(tip * 0.6, 4.5, 6, 5.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  draw();
}

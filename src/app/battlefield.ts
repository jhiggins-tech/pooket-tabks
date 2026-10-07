import { aimTwin, currentPlayer, hologramAt, pendingTwinSpot, placeTwin, tankCentre, toggleSwapTarget } from '../game/game';
import type { GameState } from '../game/state';
import type { Renderer } from '../render/canvas';

/**
 * Touches on the battlefield that pick something on it (input/controls.ts says when; this says what): where
 * the screen point is in the world, and what's under a finger there.
 */

/** A tap: placing torikloud's twin (where the ground was tapped), or picking the decoy to swap into. */
export function tapBattlefield(state: GameState, renderer: Renderer, x: number, y: number): void {
  const w = renderer.screenToWorld(x, y);
  // Placing torikloud's twin: wherever the ground was tapped (if it's allowed there).
  if (pendingTwinSpot(state) !== null) return void placeTwin(state, w.x);
  // Generous finger-sized radius (~30 CSS px).
  const holo = hologramAt(state, w.x, w.y, 30 / renderer.cssScale);
  if (holo) toggleSwapTarget(state, holo.id);
}

/** torikloud with a twin: a drag that starts near one of the tanks aims that one. */
export function aimFromNear(state: GameState, renderer: Renderer, x: number, y: number): void {
  const p = currentPlayer(state);
  if (!p.twin) return;
  const w = renderer.screenToWorld(x, y);
  const near = 60 / renderer.cssScale;
  const main = tankCentre(p);
  const twin = tankCentre({ ...p, x: p.twin.x, y: p.twin.y });
  const dMain = Math.hypot(w.x - main.x, w.y - main.y);
  const dTwin = Math.hypot(w.x - twin.x, w.y - twin.y);
  if (Math.min(dMain, dTwin) < near) aimTwin(state, dTwin < dMain);
}

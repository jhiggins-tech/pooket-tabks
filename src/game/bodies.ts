import type { Terrain } from '../core/terrain';
import { BARREL_LENGTH, TANK_BODY_HEIGHT, TANK_HALF_WIDTH } from './constants';
import type { GameState, Player, TankBody } from './state';

/**
 * Where the tanks are: whose turn it is, a tank's centre and muzzle, and resting hulls on the ground. A leaf
 * (it imports nothing else from the game), so any module can use these without an import cycle; tanks.ts
 * and movement.ts re-export them.
 */

export function currentPlayer(state: GameState): Player {
  return state.players[state.current]!;
}

export function tankCentre(p: Player): { x: number; y: number } {
  return { x: p.x, y: p.y - TANK_BODY_HEIGHT };
}

export function muzzle(p: Player): { x: number; y: number } {
  const c = tankCentre(p);
  const a = (p.angle * Math.PI) / 180;
  return { x: c.x + Math.cos(a) * BARREL_LENGTH, y: c.y - Math.sin(a) * BARREL_LENGTH };
}

/** A player's tanks, in order: the main tank (the player itself), then the twin if there is one. */
export function bodiesOf(p: Player): TankBody[] {
  return p.twin ? [p, p.twin] : [p];
}

/** y where a tank's hull would rest at x: the highest ground under it, searching down from fromY. */
export function hullRest(terrain: Terrain, x: number, fromY: number): number {
  let ground = terrain.height;
  for (let dx = -TANK_HALF_WIDTH + 2; dx <= TANK_HALF_WIDTH - 2; dx += 2) {
    ground = Math.min(ground, terrain.groundBelow(x + dx, fromY));
  }
  return ground;
}

/** Drop tanks (and holograms) onto whatever ground is left beneath them: main tanks, holograms, then twins. */
export function settleTanks(state: GameState): void {
  const { terrain } = state;
  const twins = state.players.flatMap((p) => (p.twin ? [p.twin] : []));
  for (const t of [...state.players, ...state.holograms, ...twins]) t.y = hullRest(terrain, t.x, t.y);
}

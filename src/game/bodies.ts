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

/**
 * Is another body in the way of `self`'s main tank as it moves? Tries `near(x, y)` (where each body's hull
 * rests) on every living tank but `self`'s main tank itself (its own twin counts), player by player, main
 * tank then twin; then, with `holograms`, on every hologram. Returns the x of the first it holds for, or
 * null. Driving and hopping bump into holograms (`holograms: true`); a jetpacking tank doesn't (false): it
 * flies past them, and can land beside one. No allocations: it runs for every pixel of a drive or a flight.
 */
export function otherBodyNear(state: GameState, self: Player, near: (x: number, y: number) => boolean, opts: { holograms: boolean }): number | null {
  for (const p of state.players) {
    if (!p.alive) continue;
    if (p !== self && near(p.x, p.y)) return p.x;
    if (p.twin && near(p.twin.x, p.twin.y)) return p.twin.x;
  }
  if (opts.holograms) for (const h of state.holograms) if (near(h.x, h.y)) return h.x;
  return null;
}

/**
 * A tank body (TankBody) at (x, y) with `hp`: fresh (no burn, soak or toxin) unless `t` brings its own,
 * as a twin does when it takes over from the main tank. Only the TankBody fields are taken from `t`.
 */
export function tankBody(t: Pick<TankBody, 'x' | 'y' | 'hp'> & Partial<TankBody>): TankBody {
  return { x: t.x, y: t.y, hp: t.hp, burn: t.burn ?? null, soak: t.soak ?? 0, soakColour: t.soakColour ?? '#ffffff', toxin: t.toxin ?? 0, toxinRate: t.toxinRate ?? 0 };
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

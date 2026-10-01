import { getCharacter } from '../characters/roster';
import { DRIVE_CLIMB, DRIVE_LOOKAHEAD, DRIVE_MAX_SLOPE, DRIVE_SCRAMBLE, DRIVE_SCRAMBLE_REACH, DRIVE_SPEED, TANK_HALF_WIDTH } from './constants';
import { sound, spawnDust } from './fx';
import type { GameState, Hop, Player } from './state';
import { canMove } from './statuses';
import { currentPlayer, someTankBody } from './tanks';
import { clamp, hash } from './util';

/** Driving (◀ ▶, one tank of fuel per match) and ciarra's frog hops; tanks settling onto the ground. */

/**
 * Drive the current player's tank along the ground for dt seconds in direction `dir` (−1 / +1),
 * spending fuel per pixel from a tank that has to last the whole match. It rolls over bumps and lips up to DRIVE_CLIMB px and climbs slopes up to
 * DRIVE_MAX_SLOPE (steeper only when the climb is short, like a crater wall: see shortClimb), rolls down slopes and drops off ledges; walls, other tanks (and holograms), and the map edges stop it. Only before firing.
 * Returns the distance moved.
 */
export function drive(state: GameState, dir: number, dt: number): number {
  if (state.phase !== 'aiming') return 0;
  const p = currentPlayer(state);
  if (getCharacter(p.characterId).movement === 'hop') return hopDrive(state, p, dir, dt);
  if (dir === 0 || !canMove(p)) return 0;
  const { terrain } = state;
  let budget = Math.min(p.fuel, DRIVE_SPEED * dt);
  let moved = 0;
  while (budget > 0) {
    const stepX = Math.min(1, budget);
    const nx = p.x + Math.sign(dir) * stepX;
    if (nx < TANK_HALF_WIDTH || nx > terrain.width - TANK_HALF_WIDTH) break;
    // Another tank (or a decoy) we'd be driving into.
    const inTheWay = (qx: number) => Math.abs(qx - nx) < TANK_HALF_WIDTH * 2 && Math.abs(qx - nx) < Math.abs(qx - p.x);
    const blocked =
      someTankBody(state, (qx, _qy, owner, twin) => !(owner === p && !twin) && inTheWay(qx)) || state.holograms.some((h) => inTheWay(h.x));
    if (blocked) break;
    // Compare where the hull would rest at nx with where it rests now. A wall the hull is overlapping
    // behind it (a tank that dropped into a crater against its steep side) doesn't hold it back.
    const here = p.y;
    const ground = driveRest(state, nx, here - DRIVE_CLIMB - 1, Math.sign(dir));
    if (ground < here - DRIVE_CLIMB) break; // a wall
    if (ground < here) {
      // Climbing: a bump is fine, but not if the ground keeps rising steeply beyond it (a steep hill).
      const aheadX = clamp(nx + Math.sign(dir) * DRIVE_LOOKAHEAD, TANK_HALF_WIDTH, terrain.width - TANK_HALF_WIDTH);
      const limit = Math.max(DRIVE_CLIMB, DRIVE_MAX_SLOPE * Math.abs(aheadX - p.x));
      const steep = driveRest(state, aheadX, here - limit - 1, Math.sign(dir)) < here - limit;
      if (steep && !shortClimb(state, nx, Math.sign(dir), here) && !inHollow(state, p.x, Math.sign(dir), here)) break;
    }
    p.x = nx;
    p.y = ground;
    budget -= stepX;
    moved += stepX;
  }
  p.fuel = Math.max(0, p.fuel - moved);
  if (moved > 0 && hash(state.fxSeq * 0.37 + p.x) < 0.25) spawnDust(state, p.x - Math.sign(dir) * 9, p.y, 0.15);
  return moved;
}

/**
 * True when the ground behind the tank (within DRIVE_SCRAMBLE_REACH px) also rises above it: it's down
 * in a pit or crater, so any climb that isn't a sheer wall is a way out, not a steep hill.
 */
function inHollow(state: GameState, x: number, dir: number, here: number): boolean {
  const { width } = state.terrain;
  for (let k = TANK_HALF_WIDTH; k <= DRIVE_SCRAMBLE_REACH; k += 2) {
    const bx = x - dir * k;
    if (bx < 0 || bx >= width) break;
    if (state.terrain.groundBelow(bx, here - DRIVE_SCRAMBLE * 2) < here - DRIVE_CLIMB) return true;
  }
  return false;
}

/**
 * True when the climb ahead tops out within DRIVE_SCRAMBLE px of `here` (the ground over the next
 * DRIVE_SCRAMBLE_REACH px never rises higher than that), so even a steep one can be scrambled up:
 * crater walls and short banks, as opposed to a steep hill that keeps going.
 */
function shortClimb(state: GameState, x: number, dir: number, here: number): boolean {
  const cap = here - DRIVE_SCRAMBLE;
  const { width } = state.terrain;
  for (let k = 0; k <= DRIVE_SCRAMBLE_REACH; k += 2) {
    const ax = clamp(x + dir * k, TANK_HALF_WIDTH, width - TANK_HALF_WIDTH);
    if (driveRest(state, ax, cap - 1, dir) < cap) return false;
  }
  return true;
}

/**
 * How far one frog hop goes, how high it jumps (well over the DRIVE_SCRAMBLE a driving tank manages), and
 * how long it takes.
 */
export const HOP_DISTANCE = 44;

export const HOP_HEIGHT = 64;

export const HOP_TIME = 0.5;

/** Fuel per px hopped: frogs go twice as far as a tank on the same fuel. */
export const HOP_FUEL = 0.5;

/**
 * Hop movement: while ◀ / ▶ is held the tank makes big frog leaps, each spending HOP_FUEL per px. A hop
 * clears walls and cliffs up to HOP_HEIGHT that would stop a driving tank. Returns px moved this step.
 */
function hopDrive(state: GameState, p: Player, dir: number, dt: number): number {
  if (p.hop) {
    const h = p.hop;
    const before = p.x;
    h.t = Math.min(1, h.t + dt / HOP_TIME);
    p.x = h.x0 + (h.x1 - h.x0) * h.t;
    p.y = h.y0 + (h.y1 - h.y0) * h.t - 4 * hopBulge(h) * h.t * (1 - h.t);
    if (h.t >= 1) {
      p.x = h.x1;
      p.y = h.y1;
      p.hop = null;
      spawnDust(state, p.x, p.y, 0.4);
    }
    return Math.abs(p.x - before);
  }
  if (dir === 0 || !canMove(p)) return 0;
  const hop = planHop(state, p, Math.sign(dir));
  if (!hop) return 0;
  p.fuel = Math.max(0, p.fuel - Math.abs(hop.x1 - hop.x0) * HOP_FUEL);
  p.hop = hop;
  sound(state, 'hop');
  spawnDust(state, p.x, p.y, 0.4);
  return 0;
}

/** How far a hop arcs above the straight line from take-off to landing: more for a big climb or drop, so it clears the edge. */
function hopBulge(h: Hop): number {
  return HOP_HEIGHT * 0.5 + Math.abs(h.y1 - h.y0) * 0.75;
}

/** Plan the longest hop (up to HOP_DISTANCE, limited by fuel) that clears everything in the way. */
function planHop(state: GameState, p: Player, dir: number): Hop | null {
  const { terrain } = state;
  const apex = p.y - HOP_HEIGHT;
  const maxDist = Math.min(HOP_DISTANCE, p.fuel / HOP_FUEL);
  for (let dist = Math.floor(maxDist); dist >= 4; dist -= 2) {
    const x1 = p.x + dir * dist;
    if (x1 < TANK_HALF_WIDTH || x1 > terrain.width - TANK_HALF_WIDTH) continue;
    // Nothing along the way pokes above the top of the hop…
    let clear = true;
    for (let d = 1; d <= dist && clear; d++) {
      for (const dx of [-TANK_HALF_WIDTH + 2, TANK_HALF_WIDTH - 2]) {
        if (terrain.isSolid(p.x + dir * d + dx, apex)) clear = false;
      }
    }
    if (!clear) continue;
    // …it lands on solid ground no higher than the apex (searching from just above it, so the hull
    // never lands sunk into a bank), and not on top of another tank.
    const y1 = hullRest(state, x1, apex - 1);
    if (y1 < apex) continue;
    const near = (qx: number) => Math.abs(qx - x1) < TANK_HALF_WIDTH * 2;
    const bump = someTankBody(state, (qx, _qy, owner, twin) => !(owner === p && !twin) && near(qx)) || state.holograms.some((h) => near(h.x));
    if (bump) continue;
    return { x0: p.x, y0: p.y, x1, y1, t: 0 };
  }
  return null;
}

/**
 * Like hullRest for a tank driving in direction `dir`: columns on the trailing half that are solid right
 * up to fromY are walls it's pulling away from, so they don't count. Returns fromY - 1 (a wall) if
 * nothing under the hull can hold it.
 */
function driveRest(state: GameState, x: number, fromY: number, dir: number): number {
  let ground = Infinity;
  for (let dx = -TANK_HALF_WIDTH + 2; dx <= TANK_HALF_WIDTH - 2; dx += 2) {
    const g = state.terrain.groundBelow(x + dx, fromY);
    if (g <= fromY && dx * dir < 0) continue; // embedded in a wall behind
    ground = Math.min(ground, g);
  }
  return Number.isFinite(ground) ? ground : fromY - 1;
}

/** y where a tank's hull would rest at x: the highest ground under it, searching down from fromY. */
function hullRest(state: GameState, x: number, fromY: number): number {
  let ground = state.terrain.height;
  for (let dx = -TANK_HALF_WIDTH + 2; dx <= TANK_HALF_WIDTH - 2; dx += 2) {
    ground = Math.min(ground, state.terrain.groundBelow(x + dx, fromY));
  }
  return ground;
}

/** Drop tanks (and holograms) onto whatever ground is left beneath them. */
export function settleTanks(state: GameState): void {
  const { terrain } = state;
  const twins = state.players.flatMap((p) => (p.twin ? [p.twin] : []));
  for (const t of [...state.players, ...state.holograms, ...twins]) {
    let ground = terrain.height;
    for (let dx = -TANK_HALF_WIDTH + 2; dx <= TANK_HALF_WIDTH - 2; dx += 2) {
      ground = Math.min(ground, terrain.groundBelow(t.x + dx, t.y));
    }
    t.y = ground;
  }
}

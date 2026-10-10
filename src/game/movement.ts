import { getCharacter } from '../characters/roster';
import { DRIVE_CLIMB, DRIVE_LOOKAHEAD, DRIVE_MAX_SLOPE, DRIVE_SCRAMBLE, DRIVE_SCRAMBLE_REACH, DRIVE_SPEED, HOP_DISTANCE, HOP_FUEL, HOP_HEIGHT, HOP_TIME, SCOOTER_CRASH, SCOOTER_FUEL, SCOOTER_SPEED, TANK_BODY_HEIGHT, TANK_HALF_WIDTH } from './constants';
import { sound, spawnDust, spawnFloater } from './fx';
import type { GameState, Hop, Player, TankBody } from './state';
import { canMove } from './statuses';
import { currentPlayer, hullRest, otherBodyNear } from './bodies';
import { hurt } from './tanks';
import { clamp, hash } from './util';

/**
 * Driving (◀ ▶, one tank of fuel per match), ciarra's frog hops and garyoldmancorp's scooter (driving, faster
 * and further, but terrain that would stop a tank is a crash); tanks settling onto the ground. With a twin
 * (torikloud's Twins), ◀ ▶ drive whichever tank is being aimed (the 🎯 switch: `Player.aimTwin`), both on
 * the one tank of fuel; a twin just drives (no hops or scooter of its own).
 */

/**
 * Drive the current player's tank along the ground for dt seconds in direction `dir` (−1 / +1),
 * spending fuel per pixel from a tank that has to last the whole match. It rolls over bumps and lips up to DRIVE_CLIMB px and climbs slopes up to
 * DRIVE_MAX_SLOPE (steeper only when the climb is short, like a crater wall: see shortClimb), rolls down slopes and drops off ledges; walls, other tanks (and holograms), and the map edges stop it. Only before firing.
 * Returns the distance moved.
 */
export function drive(state: GameState, dir: number, dt: number): number {
  if (state.phase !== 'aiming') return 0;
  const p = currentPlayer(state);
  if (p.aimTwin && p.twin) return driveTwin(state, p, p.twin, dir, dt);
  const movement = getCharacter(p.characterId).movement;
  if (movement === 'hop') return hopDrive(state, p, dir, dt);
  if (dir === 0 || !canMove(p)) return 0;
  const scooter = movement === 'scooter';
  // Still up against what the scooter crashed into: it takes a fresh run (moving off first) to crash again.
  if (scooter && Math.sign(dir) === p.scooterCrash) return 0;
  const perPx = scooter ? SCOOTER_FUEL : 1;
  const { moved, stopped } = roll(state, p, Math.sign(dir), Math.min(p.fuel / perPx, (scooter ? SCOOTER_SPEED : DRIVE_SPEED) * dt));
  p.fuel = Math.max(0, p.fuel - moved * perPx);
  if (moved > 0) p.scooterCrash = 0;
  if (moved > 0 && hash(state.fxSeq * 0.37 + p.x) < (scooter ? 0.6 : 0.25)) spawnDust(state, p.x - Math.sign(dir) * 9, p.y, scooter ? 0.3 : 0.15);
  if (scooter && moved > 0) sound(state, 'scoot');
  if (scooter && stopped === 'terrain' && p.fuel > 0) crash(state, p, Math.sign(dir));
  return moved;
}

/** Drive `p`'s twin (the tank being aimed) like any tank, on `p`'s fuel. Returns the distance moved. */
function driveTwin(state: GameState, p: Player, twin: TankBody, dir: number, dt: number): number {
  if (dir === 0 || !canMove(p)) return 0;
  const { moved } = roll(state, twin, Math.sign(dir), Math.min(p.fuel, DRIVE_SPEED * dt));
  p.fuel = Math.max(0, p.fuel - moved);
  if (moved > 0 && hash(state.fxSeq * 0.37 + twin.x) < 0.25) spawnDust(state, twin.x - Math.sign(dir) * 9, twin.y, 0.15);
  return moved;
}

/**
 * Move `body` along the ground up to `budget` px in direction `dir` (±1), a pixel at a time, until
 * something stops it: returns how far it went, and what stopped it (terrain, another tank or the edge).
 */
function roll(state: GameState, body: TankBody, dir: number, budget: number): { moved: number; stopped: 'terrain' | 'other' | null } {
  let moved = 0;
  while (budget > 0) {
    const stepX = Math.min(1, budget);
    const nx = body.x + dir * stepX;
    const ground = driveTo(state, body, nx, dir);
    if (typeof ground !== 'number') return { moved, stopped: ground };
    body.x = nx;
    body.y = ground;
    budget -= stepX;
    moved += stepX;
  }
  return { moved, stopped: null };
}

/**
 * Where the hull would rest one step on, at `nx` (moving `dir`), or why it can't go there: the map edge or
 * another tank or decoy in the way ('other'), or terrain it can't cross: a wall or a steep hill ('terrain').
 */
function driveTo(state: GameState, p: TankBody, nx: number, dir: number): number | 'terrain' | 'other' {
  const { terrain } = state;
  if (nx < TANK_HALF_WIDTH || nx > terrain.width - TANK_HALF_WIDTH) return 'other';
  // Another tank (or a decoy) we'd be driving into.
  const inTheWay = (qx: number) => Math.abs(qx - nx) < TANK_HALF_WIDTH * 2 && Math.abs(qx - nx) < Math.abs(qx - p.x);
  if (otherBodyNear(state, p, inTheWay, { holograms: true }) !== null) return 'other';
  // Compare where the hull would rest at nx with where it rests now. A wall the hull is overlapping
  // behind it (a tank that dropped into a crater against its steep side) doesn't hold it back.
  const here = p.y;
  const ground = driveRest(state, nx, here - DRIVE_CLIMB - 1, dir);
  if (ground < here - DRIVE_CLIMB) return 'terrain'; // a wall
  if (ground < here) {
    // Climbing: a bump is fine, but not if the ground keeps rising steeply beyond it (a steep hill).
    const aheadX = clamp(nx + dir * DRIVE_LOOKAHEAD, TANK_HALF_WIDTH, terrain.width - TANK_HALF_WIDTH);
    const limit = Math.max(DRIVE_CLIMB, DRIVE_MAX_SLOPE * Math.abs(aheadX - p.x));
    const steep = driveRest(state, aheadX, here - limit - 1, dir) < here - limit;
    if (steep && !shortClimb(state, nx, dir, here) && !inHollow(state, p.x, dir, here)) return 'terrain';
  }
  return ground;
}

/**
 * The scooter ran into terrain it can't cross: a crash. It stops there, the rider takes SCOOTER_CRASH (but
 * never the last of their health: a crash between shots can't end the match), and holding on into the
 * same wall does nothing more until it's moved off.
 */
function crash(state: GameState, p: Player, dir: number): void {
  p.scooterCrash = dir;
  const at = { x: p.x + dir * TANK_HALF_WIDTH, y: p.y - TANK_BODY_HEIGHT };
  spawnFloater(state, at.x, at.y - 14, 'CRASH!', '#ffd166');
  spawnDust(state, at.x, p.y, 0.9);
  state.fx.explosions.push({ x: at.x, y: at.y, radius: 7, age: 0, duration: 0.3 });
  sound(state, 'crash');
  hurt(state, p, p, Math.min(SCOOTER_CRASH, p.hp - 1), '#ffd166', { by: p.id, weaponId: '' });
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
    const y1 = hullRest(terrain, x1, apex - 1);
    if (y1 < apex) continue;
    const near = (qx: number) => Math.abs(qx - x1) < TANK_HALF_WIDTH * 2;
    if (otherBodyNear(state, p, near, { holograms: true }) !== null) continue;
    return { x0: p.x, y0: p.y, x1, y1, t: 0 };
  }
  return null;
}

/**
 * Like hullRest (bodies.ts) for a tank driving in direction `dir`: columns on the trailing half that are solid right
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

// (Tanks settling onto the ground: bodies.ts.)
export { settleTanks } from './bodies';

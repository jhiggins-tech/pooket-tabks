import { getWeapon } from '../weapons/registry';
import type { WeaponDef } from '../weapons/types';
import { TANK_BODY_HEIGHT, TANK_HIT_RADIUS } from './constants';
import type { GameState, Projectile } from './state';
import { sound } from './fx';
import { allTargets, explode, gone, targetOwner, targetPos } from './tanks';

/** Walkers (kie's Weasel Pop): land, scurry towards the nearest enemy, pop. */

/** How high a walker's body sits above its feet, for hit-testing and drawing. */
export const WALKER_BODY = 7;

/** Land a walker at (x, y), stand it on the ground and point it at the nearest enemy. */
export function startWalking(state: GameState, pr: Projectile, x: number, y: number): void {
  const { terrain } = state;
  pr.x = Math.min(terrain.width - 1, Math.max(0, x));
  pr.y = terrain.groundBelow(pr.x, y);
  pr.vx = 0;
  pr.vy = 0;
  pr.walkDir = directionToNearestEnemy(state, pr);
  pr.fuseDist = undefined;
  // The first one to land strikes up the band.
  const weapon = getWeapon(pr.weaponId);
  if (weapon.tune && !state.tunes.includes(weapon.id)) {
    state.tunes.push(weapon.id);
    sound(state, 'tune', weapon.id);
  }
}

/** A walker tune stops dead the moment the last of its walkers is gone. */
export function stopFinishedTunes(state: GameState): void {
  for (const id of state.tunes) {
    if (state.phase === 'flying' && state.projectiles.some((pr) => pr.weaponId === id)) continue;
    state.tunes = state.tunes.filter((t) => t !== id);
    sound(state, 'tune-end', id);
  }
}

/** −1 / +1 towards the nearest target (tank or hologram) not owned by the walker's owner. */
function directionToNearestEnemy(state: GameState, pr: Projectile): number {
  let best: number | null = null;
  for (const t of allTargets(state)) {
    if (targetOwner(t) === pr.ownerId) continue;
    const tx = targetPos(t).x;
    if (best === null || Math.abs(tx - pr.x) < Math.abs(best - pr.x)) best = tx;
  }
  return best === null || best >= pr.x ? 1 : -1;
}

/**
 * One walking step: scurry along the surface (climbing small steps, stepping down small drops,
 * falling off real ledges), popping on contact with a target or when the walk time runs out.
 * Returns true once it has exploded.
 */
export function stepWalker(state: GameState, pr: Projectile, weapon: WeaponDef, dt: number): boolean {
  const { terrain } = state;
  const walk = weapon.walk!;
  pr.walkTime += dt;
  if (pr.walkTime >= walk.duration) {
    explode(state, pr.x, pr.y - 3, weapon, pr.ownerId);
    return true;
  }
  let budget = walk.speed * dt;
  while (budget > 0) {
    const stepX = Math.min(1, budget);
    budget -= stepX;
    const nx = pr.x + pr.walkDir * stepX;
    if (nx < 0 || nx > terrain.width - 1) break; // stands at the map edge
    let ny = pr.y;
    if (terrain.isSolid(nx, ny - 1)) {
      // Step up if it's low enough, otherwise it's a wall: wait here.
      let up = 1;
      while (up <= walk.climb && terrain.isSolid(nx, ny - 1 - up)) up++;
      if (up > walk.climb) break;
      ny -= up;
    } else {
      // Step down small drops; a bigger drop means it tumbles off the ledge.
      let down = 0;
      while (down <= walk.climb && !terrain.isSolid(nx, ny + down)) down++;
      if (down > walk.climb) {
        pr.x = nx;
        pr.vx = pr.walkDir * walk.speed;
        pr.vy = 0;
        pr.walkDir = 0;
        return false;
      }
      ny += down;
    }
    pr.x = nx;
    pr.y = ny;
    // Right under an enemy: the best spot there is. Pop.
    if (nearestEnemyDist(state, pr) <= walk.fuse) {
      explode(state, pr.x, pr.y - WALKER_BODY, weapon, pr.ownerId);
      return true;
    }
  }
  // Within blast range but not getting any closer (a wall, a ledge, or it's walking past): pop now.
  const d = nearestEnemyDist(state, pr);
  const closing = pr.fuseDist === undefined || d < pr.fuseDist - 1e-6;
  pr.fuseDist = d;
  if (!closing && d < weapon.blastRadius + TANK_HIT_RADIUS) {
    explode(state, pr.x, pr.y - WALKER_BODY, weapon, pr.ownerId);
    return true;
  }
  return false;
}

/** Distance from a walker's body to the centre of the nearest enemy target (tank, twin or decoy). */
function nearestEnemyDist(state: GameState, pr: Projectile): number {
  let best = Infinity;
  for (const t of allTargets(state)) {
    if (gone(t) || targetOwner(t) === pr.ownerId) continue;
    const pos = targetPos(t);
    best = Math.min(best, Math.hypot(pos.x - pr.x, pos.y - TANK_BODY_HEIGHT - (pr.y - WALKER_BODY)));
  }
  return best;
}

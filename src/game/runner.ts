import { getWeapon } from '../weapons/registry';
import type { WeaponDef } from '../weapons/types';
import { TANK_BODY_HEIGHT } from './constants';
import type { GameState, Runner } from './state';
import { sound, spawnFloater } from './fx';
import { allTargets, explode, targetAt, targetOwner, targetPos } from './tanks';

/** ciarra's Marathon runner. */

/** Run the current leg towards the nearest enemy, over any hill. Returns true once it's finished. */
export function stepRunner(state: GameState, r: Runner, dt: number): boolean {
  const owner = state.players[r.ownerId];
  if (!owner?.alive || r.out) return true;
  if (r.legLeft <= 0) return false; // waiting for the next shot to set it off again
  const spec = getWeapon(r.weaponId).runner!;
  const { terrain } = state;
  let targetX: number | null = null;
  for (const t of allTargets(state)) {
    if (targetOwner(t) === r.ownerId) continue;
    const x = targetPos(t).x;
    if (targetX === null || Math.abs(x - r.x) < Math.abs(targetX - r.x)) targetX = x;
  }
  if (targetX === null) {
    r.legLeft = 0;
    return false;
  }
  r.dir = targetX >= r.x ? 1 : -1;
  let budget = Math.min(r.legLeft, spec.speed * dt);
  while (budget > 0) {
    const stepX = Math.min(1, budget);
    budget -= stepX;
    r.legLeft -= stepX;
    r.distance += stepX;
    r.x = Math.min(terrain.width - 1, Math.max(0, r.x + r.dir * stepX));
    r.y = terrain.surfaceY(r.x); // up and over anything
    const hit = targetAt(state, r.x, r.y - 6);
    if (hit && targetOwner(hit) !== r.ownerId) {
      // Finish line: a big hit.
      const finish: WeaponDef = { ...getWeapon(r.weaponId), kind: 'ballistic', blastRadius: spec.radius, damage: spec.damage };
      r.out = true; // it's done: don't DNF itself in its own blast
      // Full force at the finish line: the blast goes off right on the tank it reached.
      const at = targetPos(hit);
      explode(state, at.x, at.y - TANK_BODY_HEIGHT, finish, r.ownerId);
      spawnFloater(state, r.x, r.y - 30, 'FINISH!', '#f472b6');
      sound(state, 'finish');
      return true;
    }
  }
  if (r.legLeft < 0) r.legLeft = 0;
  return false;
}

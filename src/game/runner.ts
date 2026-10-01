import { weaponOf } from '../weapons/registry';
import type { WeaponDef } from '../weapons/types';
import { TANK_BODY_HEIGHT } from './constants';
import { sound, spawnFloater } from './fx';
import type { Stepper } from './mechanics';
import type { GameState, Player, Runner } from './state';
import { explode, nearestEnemyX, targetAt, targetOwner, targetPos } from './tanks';

/** ciarra's Marathon runner. */

/** Run the current leg towards the nearest enemy, over any hill. Returns true once it's finished. */
export function stepRunner(state: GameState, r: Runner, dt: number): boolean {
  const owner = state.players[r.ownerId];
  if (!owner?.alive || r.out) return true;
  if (r.legLeft <= 0) return false; // waiting for the next shot to set it off again
  const weapon = weaponOf(r.weaponId, 'runner');
  const spec = weapon.runner;
  const { terrain } = state;
  const targetX = nearestEnemyX(state, r.x, r.ownerId);
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
      // Finish line: a big hit, full force: the blast goes off right on the tank it reached.
      r.out = true; // it's done: don't DNF itself in its own blast
      const at = targetPos(hit);
      explode(state, at.x, at.y - TANK_BODY_HEIGHT, weapon, r.ownerId, { radius: spec.radius, damage: spec.damage });
      spawnFloater(state, r.x, r.y - 30, 'FINISH!', '#f472b6');
      sound(state, 'finish');
      return true;
    }
  }
  if (r.legLeft < 0) r.legLeft = 0;
  return false;
}

/** The marathon goes on: every shot fired (by anyone) sends every runner off on another leg. */
export function runLegs(state: GameState): void {
  for (const r of state.runners) r.legLeft += weaponOf(r.weaponId, 'runner').runner.leg;
  if (state.runners.some((r) => !r.out)) sound(state, 'leg');
}

/** Marathon: a runner lines up at the firer's tank (and runs a leg with every shot, this one included). */
export function fireRunner(state: GameState, p: Player, weapon: WeaponDef): void {
  state.runners.push({ ownerId: p.id, weaponId: weapon.id, x: p.x, y: p.y, dir: 1, legLeft: 0, distance: 0, out: false });
}

/** Runners hold the turn only while running a leg; between shots they wait. */
export const runnerStepper: Stepper = {
  step(state, dt) {
    state.runners = state.runners.filter((r) => !stepRunner(state, r, dt));
  },
  busy: (state) => state.runners.some((r) => r.legLeft > 0),
};

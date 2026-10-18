/** ShotDownBoyz's free Digger bonus: drive sideways through terrain, then refill once from a reserve tank. */
import { DRIVE_SPEED, FUEL_PER_MATCH, TANK_BODY_HEIGHT, TANK_HALF_WIDTH } from './constants';
import { tankCentre } from './bodies';
import { sound, spawnFloater } from './fx';
import type { GameState, Player } from './state';
import { kindOf } from '../weapons/registry';
import { weaponForTier } from './loadout';
import { canMove } from './statuses';

/** Whether this tier is ShotDownBoyz's Activate Digger bonus. */
export function isDigger(p: Player, tier: number): boolean {
  return p.loadout[tier] !== undefined && kindOf(weaponForTier(p, tier)) === 'digger';
}

/** Activate horizontal tunnelling mode for the rest of this turn. */
export function activateDigger(state: GameState, p: Player, tier: number): boolean {
  if (!isDigger(p, tier) || p.diggerTurn === state.turn) return false;
  p.diggerTurn = state.turn;
  p.diggerActive = true;
  const c = tankCentre(p);
  spawnFloater(state, c.x, c.y - 18, 'DIGGER ON!', '#fbbf24');
  sound(state, 'fire', p.loadout[tier]);
  return true;
}

/** ShotDownBoyz's second diesel tank: one full refill, when a turn starts with no fuel. */
export function refillDiesel(state: GameState, p: Player): void {
  if (p.characterId !== 'shotdownboyz' || !p.dieselAvailable || p.fuel > 0) return;
  p.fuel = FUEL_PER_MATCH;
  p.dieselAvailable = false;
  p.dieselCanTime = 2.4;
  const c = tankCentre(p);
  spawnFloater(state, c.x, c.y - 18, '2ND DIESEL!', '#a3e635');
  sound(state, 'refuel');
}

/** Move a digger tank sideways at its current height, carving a round tunnel as it goes. */
export function diggerDrive(state: GameState, p: Player, dir: number, dt: number): number {
  if (dir === 0 || p.fuel <= 0 || !canMove(p)) return 0;
  const way = Math.sign(dir);
  let budget = Math.min(p.fuel, DRIVE_SPEED * dt);
  let moved = 0;
  const radius = TANK_HALF_WIDTH + 2;
  const centreY = p.y - TANK_BODY_HEIGHT / 2;

  while (budget > 0) {
    const step = Math.min(1, budget);
    const nx = p.x + way * step;
    if (nx < TANK_HALF_WIDTH || nx > state.terrain.width - TANK_HALF_WIDTH) break;
    if (otherBodyNear(state, p, nx, centreY, radius)) break;

    state.terrain.carveCircle(nx, centreY, radius);
    p.x = nx;
    moved += step;
    budget -= step;
  }

  p.fuel = Math.max(0, p.fuel - moved);
  if (moved > 0) {
    p.diggerFacing = way;
    sound(state, 'digger');
  }
  return moved;
}

function otherBodyNear(state: GameState, self: Player, x: number, centreY: number, radius: number): boolean {
  for (const p of state.players) {
    if (!p.alive) continue;
    if (p !== self && nearTunnel(x, centreY, radius, p.x, p.y)) return true;
    if (p.twin && nearTunnel(x, centreY, radius, p.twin.x, p.twin.y)) return true;
  }
  for (const h of state.holograms) {
    if (nearTunnel(x, centreY, radius, h.x, h.y)) return true;
  }
  return false;
}

function nearTunnel(x: number, centreY: number, radius: number, bodyX: number, bodyY: number): boolean {
  return Math.abs(bodyX - x) < TANK_HALF_WIDTH * 2
    && bodyY + 2 > centreY - radius
    && bodyY - TANK_BODY_HEIGHT - 7 < centreY + radius;
}

/**
 * ShotDownBoyz's free Digger bonus: drive sideways through terrain at his current height, and over air on
 * a flat bed of dirt he lays as he goes (the spray of dirt off the back is just the look; his exhaust
 * and its fumes: render/draw/digger.ts); and his jerry cans of diesel in reserve, each a full refill.
 */
import { DRIVE_SPEED, FUEL_PER_MATCH, TANK_BODY_HEIGHT, TANK_HALF_WIDTH } from './constants';
import { tankCentre } from './bodies';
import { sound, spawnFloater } from './fx';
import type { GameState, Player } from './state';
import { hash } from './util';
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

/** ShotDownBoyz's jerry cans of diesel: one full refill each, when a turn starts with no fuel. */
export function refillDiesel(state: GameState, p: Player): void {
  if (p.dieselCans <= 0 || p.fuel > 0) return;
  p.fuel = FUEL_PER_MATCH;
  p.dieselCans--;
  p.dieselCanTime = 2.4;
  const c = tankCentre(p);
  spawnFloater(state, c.x, c.y - 18, 'DIESEL REFILL!', '#a3e635');
  sound(state, 'refuel');
}

/** The colour of the dirt the digger lays down. */
const DIGGER_DIRT = [112, 76, 46] as const;

/**
 * Move a digger tank sideways at its current height, carving a round tunnel as it goes and filling in
 * the ground under it flat (bridging gaps and levelling the tunnel floor).
 */
export function diggerDrive(state: GameState, p: Player, dir: number, dt: number): number {
  if (dir === 0 || p.fuel <= 0 || !canMove(p)) return 0;
  const way = Math.sign(dir);
  let budget = Math.min(p.fuel, DRIVE_SPEED * dt);
  let moved = 0;
  let filled = 0;
  const radius = TANK_HALF_WIDTH + 2;
  const centreY = p.y - TANK_BODY_HEIGHT / 2;

  while (budget > 0) {
    const step = Math.min(1, budget);
    const nx = p.x + way * step;
    if (nx < TANK_HALF_WIDTH || nx > state.terrain.width - TANK_HALF_WIDTH) break;
    if (otherBodyNear(state, p, nx, centreY, radius)) break;

    state.terrain.carveCircle(nx, centreY, radius);
    filled += levelUnder(state, p, nx, radius);
    p.x = nx;
    moved += step;
    budget -= step;
  }

  p.fuel = Math.max(0, p.fuel - moved);
  if (moved > 0) {
    p.diggerFacing = way;
    sound(state, 'digger');
    if (filled > 0) spewDirt(state, p, way);
  }
  return moved;
}

/**
 * Fill the ground flat at the hull's base, under the tunnel's width at x. A column with another tank (or
 * hologram) below stops short of burying it. Returns pixels added.
 */
function levelUnder(state: GameState, self: Player, x: number, radius: number): number {
  const top = self.y;
  let added = 0;
  for (let cx = Math.floor(x - radius); cx <= Math.ceil(x + radius); cx++) {
    added += state.terrain.fillDown(cx, top, bodyTopBelow(state, self, cx, top), DIGGER_DIRT);
  }
  return added;
}

/** The highest top of another tank (or hologram) under column x below `top`, else the map's bottom. */
function bodyTopBelow(state: GameState, self: Player, x: number, top: number): number {
  let bottom = state.terrain.height;
  for (const p of state.players) {
    if (p !== self) bottom = roofOver(bottom, p.x, p.y, x, top);
    if (p.twin) bottom = roofOver(bottom, p.twin.x, p.twin.y, x, top);
  }
  for (const h of state.holograms) bottom = roofOver(bottom, h.x, h.y, x, top);
  return bottom;
}

/** `bottom`, or just over the tank at (bx, by) if that's under column x, below `top`, and higher. */
function roofOver(bottom: number, bx: number, by: number, x: number, top: number): number {
  if (Math.abs(bx - x) > TANK_HALF_WIDTH + 1 || by <= top) return bottom;
  return Math.min(bottom, Math.max(top, by - TANK_BODY_HEIGHT - 8));
}

/** Now and then a clod of dirt kicked out from under the back of the tank onto the new ground. Cosmetic. */
function spewDirt(state: GameState, p: Player, way: number): void {
  if (hash(state.fxSeq++ * 0.43 + p.x) > 0.55) return;
  const h = hash(state.fxSeq++);
  state.fx.splashes.push({
    x: p.x - way * (TANK_HALF_WIDTH - 3 + h * 6),
    y: p.y - 1.5,
    vx: -way * (25 + hash(h * 17) * 70),
    vy: -(25 + hash(h * 29) * 60),
    age: 0,
    life: 0.45 + hash(h * 5) * 0.35,
    colour: hash(h * 41) < 0.5 ? '#7a5230' : '#563820',
    size: 1.2 + hash(h * 11) * 1.1,
    opaque: true,
  });
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

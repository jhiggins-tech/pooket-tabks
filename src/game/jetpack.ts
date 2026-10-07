import { randRange } from '../core/rng';
import { jetSpec } from '../weapons/registry';
import type { WeaponOf } from '../weapons/types';
import { hullRest, otherBodyNear } from './bodies';
import { GRAVITY, MAX_SPEED, TANK_BODY_HEIGHT, TANK_HALF_WIDTH } from './constants';
import { sound, spawnDust } from './fx';
import type { Stepper } from './mechanics';
import type { GameState, Jet, Player } from './state';
import { hash } from './util';

/** tones' ten-2 (and a spilt Diced Coffee, a little one straight up): the charge, the flight and the landing. */

/** Radius of the circle used for a flying tank's collisions (centred on the body). */
const JET_BODY_RADIUS = 7.5;

const JET_MAX_FLIGHT = 8; // s

/** How far through its charge-up a player's jet is (0–1), or null if they aren't charging. */
export function jetCharge(state: GameState, playerId: number): number | null {
  const j = state.jets.find((x) => x.playerId === playerId);
  if (!j || j.launched) return null;
  return Math.min(1, j.elapsed / jetSpec(j.weaponId).chargeTime);
}

function jetBodyHits(state: GameState, x: number, y: number, self: Player): boolean {
  const cy = y - TANK_BODY_HEIGHT;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    if (state.terrain.isSolid(x + Math.cos(a) * JET_BODY_RADIUS, cy + Math.sin(a) * JET_BODY_RADIUS)) return true;
  }
  // (Holograms don't count: a flying tank passes them.)
  return otherBodyNear(state, self, (qx, qy) => Math.hypot(qx - x, qy - y) < TANK_HALF_WIDTH * 2, { holograms: false }) !== null;
}

/** Charge, launch, fly, land. Returns true once the tank has landed. */
export function stepJet(state: GameState, j: Jet, dt: number): boolean {
  const p = state.players[j.playerId]!;
  const spec = jetSpec(j.weaponId);
  const { terrain } = state;
  j.elapsed += dt;

  if (!j.launched) {
    if (j.elapsed < spec.chargeTime) {
      // Dust shaken loose, more and more as the charge builds.
      const k = j.elapsed / spec.chargeTime;
      if (hash(j.elapsed * 97.13) < k * k * 0.6) spawnDust(state, p.x, p.y, k);
      return false;
    }
    const a = ((j.angle ?? p.angle) * Math.PI) / 180;
    const speed = ((j.power ?? p.power) / 100) * MAX_SPEED * spec.thrust;
    j.vx = Math.cos(a) * speed;
    j.vy = -Math.sin(a) * speed;
    j.heading = a;
    j.launched = true;
    j.burnLeft = spec.burnTime;
    sound(state, 'launch', j.weaponId);
    // Lift clear of the ground it's sitting on (a few px) so it can leave.
    for (let lift = 0; lift < 14 && jetBodyHits(state, p.x, p.y, p); lift++) p.y -= 1;
  }

  // Exhaust
  if (j.burnLeft > 0) {
    j.burnLeft -= dt;
    j.emitCarry += spec.particlesPerSecond * dt;
    const back = j.heading + Math.PI;
    while (j.emitCarry >= 1) {
      j.emitCarry -= 1;
      const spread = (spec.exhaustSpreadDeg * Math.PI) / 180;
      const a = back + randRange(state.rng, -spread, spread);
      const v = spec.exhaustSpeed * randRange(state.rng, spec.exhaustSpeedRange[0], spec.exhaustSpeedRange[1]);
      state.sludge.push({
        x: p.x - Math.cos(j.heading) * 9,
        y: p.y - TANK_BODY_HEIGHT + Math.sin(j.heading) * 9,
        vx: j.vx * 0.25 + Math.cos(a) * v,
        vy: j.vy * 0.25 - Math.sin(a) * v,
        ownerId: p.id,
        weaponId: j.weaponId,
        look: hash(state.fxSeq++ * 1.618),
        age: 0,
      });
    }
  }

  // Flight
  j.flightTime += dt;
  j.vy += GRAVITY * dt;
  const nx = p.x + j.vx * dt;
  const ny = p.y + j.vy * dt;
  const steps = Math.max(1, Math.ceil(Math.hypot(nx - p.x, ny - p.y)));
  const x0 = p.x;
  const y0 = p.y;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    let x = x0 + (nx - x0) * t;
    const y = y0 + (ny - y0) * t;
    // Invisible walls at the map edges.
    const minX = TANK_HALF_WIDTH;
    const maxX = terrain.width - TANK_HALF_WIDTH;
    if (x < minX || x > maxX) {
      x = Math.min(maxX, Math.max(minX, x));
      j.vx = 0;
    }
    if (jetBodyHits(state, x, y, p)) {
      if (j.vy > 0 || j.flightTime > JET_MAX_FLIGHT) {
        land(state, p);
        return true;
      }
      // Hit a wall or overhang on the way up: lose the sideways push and drop.
      j.vx = 0;
      j.vy = Math.max(0, j.vy);
      return false;
    }
    p.x = x;
    p.y = y;
  }
  if (j.flightTime > JET_MAX_FLIGHT) {
    land(state, p);
    return true;
  }
  return false;
}

/** Settle a jetpacking tank onto the ground and nudge it off any tank it came down beside. */
function land(state: GameState, p: Player): void {
  const { terrain } = state;
  for (let guard = 0; guard < 60; guard++) {
    const otherX = otherBodyNear(state, p, (qx) => Math.abs(qx - p.x) < TANK_HALF_WIDTH * 2, { holograms: false });
    if (otherX === null) break;
    const dir = p.x >= otherX ? 1 : -1;
    const nx = p.x + dir;
    p.x = nx < TANK_HALF_WIDTH || nx > terrain.width - TANK_HALF_WIDTH ? p.x - dir * 2 * TANK_HALF_WIDTH : nx;
  }
  p.x = Math.round(p.x);
  // Rest on the highest supporting column under the hull.
  p.y = hullRest(terrain, p.x, Math.max(0, p.y - TANK_BODY_HEIGHT * 2));
  spawnDust(state, p.x, p.y, 1);
}

/**
 * A jet about to charge: player `playerId`'s tank, with `weaponId`'s jetpack, drawn heading `heading`
 * (radians) until it launches; along the player's aim, or along `aim` if it's given.
 */
export function newJet(playerId: number, weaponId: string, heading: number, aim?: { angle: number; power: number }): Jet {
  return { playerId, weaponId, elapsed: 0, launched: false, vx: 0, vy: 0, burnLeft: 0, emitCarry: 0, flightTime: 0, heading, ...aim };
}

/** ten-2: the tank starts charging, and launches along its aim once charged. */
export function fireJetpack(state: GameState, p: Player, weapon: WeaponOf<'jetpack'>): void {
  state.jets.push(newJet(p.id, weapon.id, (p.angle * Math.PI) / 180));
}

export const jetStepper: Stepper = {
  step(state, dt) {
    state.jets = state.jets.filter((j) => !stepJet(state, j, dt));
  },
  busy: (state) => state.jets.length > 0,
};

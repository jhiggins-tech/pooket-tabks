import { randRange } from '../core/rng';
import { DICTIONARIES } from '../weapons/dictionaries';
import { getWeapon } from '../weapons/registry';
import type { WeaponDef } from '../weapons/types';
import { GRAVITY, MAX_SPEED, TANK_BODY_HEIGHT } from './constants';
import { twinGun } from './copies';
import { sound, spawnFloater } from './fx';
import type { Stepper } from './mechanics';
import { settleTanks } from './movement';
import type { Burst, GameState, Player, Projectile } from './state';
import { allTargets, damageTarget, explode, muzzle, scaled, tankCentre, type Target, targetAt, targetOwner, targetPos } from './tanks';
import { startWalking, stepWalker, stopFinishedTunes } from './walkers';

/** Projectiles: shells, volleys and bursts (with homing and bounces), beams and rain. */

const BEAM_DURATION = 0.6;

const PROJECTILE_MAX_AGE = 12; // s; anything still bouncing around by then just pops

const DEFAULT_BEAM_COLOUR = '#ff3df2';

function spawnProjectile(state: GameState, owner: Player, weapon: WeaponDef, x: number, y: number, vx: number, vy: number, variant = 0): void {
  state.projectiles.push({ x, y, vx, vy, weaponId: weapon.id, ownerId: owner.id, trail: [], bounces: 0, age: 0, walkDir: 0, walkTime: 0, variant });
}

function fireBallistic(state: GameState, p: Player, weapon: WeaponDef): void {
  const speed = (p.power / 100) * MAX_SPEED;
  const m = muzzle(p);
  volleyOffsets(weapon).forEach((offset, i) => {
    const a = ((p.angle + offset) * Math.PI) / 180;
    spawnProjectile(state, p, weapon, m.x, m.y, Math.cos(a) * speed, -Math.sin(a) * speed, i);
  });
}

/** Ballistic rounds from the main tank or the twin: a single shot/volley, a burst, or a word. */
export function fireRounds(state: GameState, p: Player, weapon: WeaponDef, origin: 'main' | 'twin'): void {
  const gun = origin === 'twin' ? twinGun(p) : p;
  if (!weapon.burst) {
    fireBallistic(state, gun, weapon);
    return;
  }
  let word: string | null = null;
  let wordColour = '#ffffff';
  if (weapon.words) {
    const list = DICTIONARIES[origin === 'twin' ? weapon.words.twin : weapon.words.main];
    word = list[Math.floor(state.rng() * list.length)]!;
    wordColour = origin === 'twin' ? weapon.words.twinColour : weapon.words.mainColour;
    const c = tankCentre(gun);
    spawnFloater(state, c.x, c.y - 18, `“${word}”`, wordColour);
  }
  state.bursts.push({ playerId: p.id, weaponId: weapon.id, origin, angle: p.angle, power: p.power, fired: 0, elapsed: 0, word, wordColour });
}

/** Straight line from the barrel until it meets ground, a tank or the edge of the map. */
export function traceBeam(state: GameState, p: Player): { x: number; y: number; hit: Target | 'ground' | null } {
  const { terrain } = state;
  const m = muzzle(p);
  const a = (p.angle * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = -Math.sin(a);
  const maxLen = Math.hypot(terrain.width, terrain.height) * 1.2;
  for (let d = 0; d <= maxLen; d += 1) {
    const x = m.x + dx * d;
    const y = m.y + dy * d;
    if (x < 0 || x >= terrain.width || y < 0) return { x, y, hit: null };
    const target = targetAt(state, x, y);
    if (target) return { x, y, hit: target };
    if (terrain.isSolid(x, y)) return { x, y: Math.min(y, terrain.height), hit: 'ground' };
  }
  return { x: m.x + dx * maxLen, y: m.y + dy * maxLen, hit: null };
}

export function fireBeam(state: GameState, p: Player, weapon: WeaponDef): void {
  const m = muzzle(p);
  const end = traceBeam(state, p);
  const colour = weapon.colour ?? DEFAULT_BEAM_COLOUR;
  state.beams.push({ x1: m.x, y1: m.y, x2: end.x, y2: end.y, colour, hitTank: end.hit !== null && end.hit !== 'ground', age: 0, duration: BEAM_DURATION });
  if (end.hit === 'ground') {
    state.terrain.carveCircle(end.x, end.y, weapon.blastRadius);
    settleTanks(state);
  } else if (end.hit) {
    const hit = end.hit;
    // The tank it hit burns (a twin as much as a main tank; not a hologram), if it's still there.
    const standing = damageTarget(state, hit, scaled(state, p.id, weapon.damage));
    if (weapon.dot && hit.kind === 'tank' && standing) {
      // A fresh hit refreshes the burn rather than stacking it.
      hit.tank.burn = { damagePerTurn: scaled(state, p.id, weapon.dot.damagePerTurn), turnsLeft: weapon.dot.turns, colour };
    }
  }
}

export function fireRain(state: GameState, p: Player, weapon: WeaponDef): void {
  const { rng, terrain } = state;
  const count = weapon.rainCount ?? 1;
  for (let i = 0; i < count; i++) {
    // Staggered heights above the screen make it arrive as a downpour rather than a wall.
    const x = randRange(rng, 4, terrain.width - 4);
    const y = -10 - rng() * terrain.height * 0.9;
    spawnProjectile(state, p, weapon, x, y, randRange(rng, -50, 50), randRange(rng, 0, 80));
  }
}

/** Angle offsets (degrees) for each projectile in a round, spread evenly across ±spreadDeg. */
export function volleyOffsets(weapon: WeaponDef): number[] {
  const count = weapon.volley?.count ?? 1;
  const spread = weapon.volley?.spreadDeg ?? 0;
  if (count <= 1) return [0];
  return Array.from({ length: count }, (_, i) => -spread + (2 * spread * i) / (count - 1));
}

/** Moves one projectile. Returns true when it is finished (exploded or left the map). */
export function stepProjectile(state: GameState, pr: Projectile, dt: number): boolean {
  const { terrain } = state;
  const weapon = getWeapon(pr.weaponId);
  pr.age += dt;
  if (pr.age > PROJECTILE_MAX_AGE) {
    explode(state, pr.x, pr.y, weapon, pr.ownerId);
    return true;
  }
  if (pr.walkDir !== 0) return stepWalker(state, pr, weapon, dt);
  if (weapon.homing) steerHoming(state, pr, weapon.homing, dt);
  if (!pr.homing) pr.vy += GRAVITY * dt;
  const nx = pr.x + pr.vx * dt;
  const ny = pr.y + pr.vy * dt;

  // Sweep the segment in ~1px increments so fast shells can't tunnel through thin ground.
  const dist = Math.hypot(nx - pr.x, ny - pr.y);
  const steps = Math.max(1, Math.ceil(dist));
  let lastX = pr.x;
  let lastY = pr.y;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = pr.x + (nx - pr.x) * t;
    const y = pr.y + (ny - pr.y) * t;
    if (targetAt(state, x, y)) {
      explode(state, x, y, weapon, pr.ownerId);
      return true;
    }
    if (terrain.isSolid(x, y)) {
      if (weapon.walk) {
        startWalking(state, pr, lastX, lastY);
        return false;
      }
      if (pr.bounces < (weapon.bounces ?? 0)) {
        bounce(state, pr, weapon, x, y, lastX, lastY);
        return false;
      }
      explode(state, x, Math.min(y, terrain.height), weapon, pr.ownerId);
      return true;
    }
    lastX = x;
    lastY = y;
  }

  pr.x = nx;
  pr.y = ny;
  if (weapon.trail ?? true) {
    pr.trail.push({ x: nx, y: ny });
    if (pr.trail.length > 40) pr.trail.shift();
  }

  const margin = 200;
  return pr.x < -margin || pr.x > terrain.width + margin;
}

/** Fire the next rounds of a burst as their time comes. Returns true once all are away. */
export function stepBurst(state: GameState, b: Burst, dt: number): boolean {
  const weapon = getWeapon(b.weaponId);
  const spec = weapon.burst!;
  const p = state.players[b.playerId]!;
  const count = b.word ? b.word.length : spec.count;
  // A twin destroyed mid-burst (or a dead player) stops firing.
  if (!p.alive || (b.origin === 'twin' && !p.twin)) return true;
  const gun = b.origin === 'twin' ? twinGun(p) : p;
  b.elapsed += dt;
  while (b.fired < count && b.elapsed >= b.fired * spec.interval) {
    const m = muzzle({ ...gun, angle: b.angle });
    const a = ((b.angle + randRange(state.rng, -1, 1)) * Math.PI) / 180;
    const speed = (b.power / 100) * MAX_SPEED * (1 + randRange(state.rng, -spec.powerJitter, spec.powerJitter));
    spawnProjectile(state, p, weapon, m.x, m.y, Math.cos(a) * speed, -Math.sin(a) * speed, b.fired);
    sound(state, 'round', weapon.id);
    if (b.word) {
      const pr = state.projectiles[state.projectiles.length - 1]!;
      pr.glyph = b.word[b.fired]!;
      pr.glyphColour = b.wordColour;
    }
    b.fired++;
  }
  return b.fired >= count;
}

/** Reflect off the ground at the contact point and back up to the last free position. */
function bounce(state: GameState, pr: Projectile, weapon: WeaponDef, hitX: number, hitY: number, freeX: number, freeY: number): void {
  const n = state.terrain.normalAt(hitX, hitY);
  const e = weapon.restitution ?? 0.5;
  const vn = pr.vx * n.x + pr.vy * n.y;
  if (vn < 0) {
    // Lose (1 - e) of the normal component, and a little of the tangential one to friction.
    const tx = pr.vx - vn * n.x;
    const ty = pr.vy - vn * n.y;
    pr.vx = tx * 0.85 - e * vn * n.x;
    pr.vy = ty * 0.85 - e * vn * n.y;
  }
  pr.x = freeX + n.x * 0.5;
  pr.y = freeY + n.y * 0.5;
  pr.bounces++;
}

/** Homing: lock on to the nearest enemy within range, then turn towards it (keeping up speed). */
function steerHoming(state: GameState, pr: Projectile, spec: NonNullable<WeaponDef['homing']>, dt: number): void {
  let best: { x: number; y: number } | null = null;
  let bestD = pr.homing ? Infinity : spec.radius;
  for (const t of allTargets(state)) {
    if (targetOwner(t) === pr.ownerId) continue;
    const p = targetPos(t);
    const c = { x: p.x, y: p.y - TANK_BODY_HEIGHT / 2 };
    const d = Math.hypot(c.x - pr.x, c.y - pr.y);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  if (!best) return; // (locked on, but there's nobody left to chase: carry straight on)
  if (!pr.homing) {
    pr.homing = true;
    sound(state, 'lock-on', pr.weaponId);
  }
  const speed = Math.max(Math.hypot(pr.vx, pr.vy), spec.minSpeed);
  const have = Math.atan2(pr.vy, pr.vx);
  const want = Math.atan2(best.y - pr.y, best.x - pr.x);
  const diff = ((((want - have) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  const max = ((spec.turnRate * Math.PI) / 180) * dt;
  const a = have + Math.max(-max, Math.min(max, diff));
  pr.vx = Math.cos(a) * speed;
  pr.vy = Math.sin(a) * speed;
}

export const projectileStepper: Stepper = {
  step(state, dt) {
    state.projectiles = state.projectiles.filter((pr) => !stepProjectile(state, pr, dt));
    if (state.tunes.length > 0) stopFinishedTunes(state);
  },
  busy: (state) => state.projectiles.length > 0,
};

export const beamStepper: Stepper = {
  step(state, dt) {
    for (const b of state.beams) b.age += dt;
    state.beams = state.beams.filter((b) => b.age < b.duration);
  },
  busy: (state) => state.beams.length > 0,
};

export const burstStepper: Stepper = {
  step(state, dt) {
    state.bursts = state.bursts.filter((b) => !stepBurst(state, b, dt));
  },
  busy: (state) => state.bursts.length > 0,
};

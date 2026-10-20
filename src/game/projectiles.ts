import { randRange } from '../core/rng';
import { DICTIONARIES } from '../weapons/dictionaries';
import { projectileWeapon } from '../weapons/registry';
import type { WeaponOf } from '../weapons/types';
import { GRAVITY, MAX_SPEED, TANK_BODY_HEIGHT } from './constants';
import { gunOf } from './copies';
import { sound, spawnFloater } from './fx';
import type { Stepper } from './mechanics';
import { settleTanks, type Gun } from './bodies';
import type { Burst, GameState, Origin, Player, Projectile } from './state';
import { applyHit, explode, forEachTargetPos, muzzle, runnerAt, scaled, tankCentre, targetAt, type Target } from './tanks';
import { startWalking, stepWalker, stopFinishedTunes } from './walkers';
import { landBeacon } from './stratagems';

/** Weapons that fire projectiles. */
type Projectiles = WeaponOf<'ballistic' | 'rain'>;

/** Projectiles: shells, volleys and bursts (with homing and bounces), beams and rain. */

const BEAM_DURATION = 0.6;

const PROJECTILE_MAX_AGE = 12; // s; anything still bouncing around by then just pops

const DEFAULT_BEAM_COLOUR = '#ff3df2';

function spawnProjectile(state: GameState, owner: Player, weapon: Projectiles, x: number, y: number, vx: number, vy: number, variant = 0): void {
  state.projectiles.push({ x, y, vx, vy, weaponId: weapon.id, ownerId: owner.id, trail: [], bounces: 0, age: 0, walkDir: 0, walkTime: 0, variant });
}

function fireBallistic(state: GameState, p: Player, gun: Gun, weapon: Projectiles): void {
  const speed = (gun.power / 100) * MAX_SPEED;
  const m = muzzle(gun);
  volleyOffsets(weapon).forEach((offset, i) => {
    const a = ((gun.angle + offset) * Math.PI) / 180;
    spawnProjectile(state, p, weapon, m.x, m.y, Math.cos(a) * speed, -Math.sin(a) * speed, i);
  });
  // Calculated's tracers, fanned out either side.
  for (const offset of tracerOffsets(weapon)) {
    const a = ((gun.angle + offset) * Math.PI) / 180;
    spawnProjectile(state, p, weapon, m.x, m.y, Math.cos(a) * speed, -Math.sin(a) * speed);
    state.projectiles[state.projectiles.length - 1]!.tracer = offset;
  }
}

/** A weapon's tracers' offsets from the aim (degrees): −30, −20, −10, +10, +20, +30 for 3 at 10°. */
export function tracerOffsets(weapon: Projectiles): number[] {
  const t = weapon.tracers;
  if (!t) return [];
  return Array.from({ length: t.count }, (_, i) => (i + 1) * t.stepDeg).flatMap((d) => [-d, d]);
}

/** A tracer has landed (or hit a tank): it leaves its offset there for the firer, and goes. Harmless. */
function landTracer(state: GameState, pr: Projectile, x: number, y: number): void {
  state.fx.marks.push({ ownerId: pr.ownerId, x, y, offset: pr.tracer!, age: 0 });
  sound(state, 'tracer', pr.weaponId);
}

/** Ballistic rounds from the main tank or the twin: a single shot/volley, a burst, or a word. */
export function fireRounds(state: GameState, p: Player, weapon: Projectiles, origin: Origin): void {
  const gun = gunOf(p, origin);
  if (!weapon.burst) {
    fireBallistic(state, p, gun, weapon);
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
  state.bursts.push({ playerId: p.id, weaponId: weapon.id, origin, angle: gun.angle, power: gun.power, fired: 0, elapsed: 0, word, wordColour });
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

export function fireBeam(state: GameState, p: Player, weapon: WeaponOf<'beam'>): void {
  const m = muzzle(p);
  const end = traceBeam(state, p);
  const colour = weapon.colour ?? DEFAULT_BEAM_COLOUR;
  state.beams.push({ x1: m.x, y1: m.y, x2: end.x, y2: end.y, colour, hitTank: end.hit !== null && end.hit !== 'ground', age: 0, duration: BEAM_DURATION });
  if (end.hit === 'ground') {
    state.terrain.carveCircle(end.x, end.y, weapon.blastRadius);
    settleTanks(state);
  } else if (end.hit) {
    applyHit(state, end.hit, weapon, p.id, scaled(state, p.id, weapon.damage));
  }
}

export function fireRain(state: GameState, p: Player, weapon: WeaponOf<'rain'>): void {
  const { rng, terrain } = state;
  const count = weapon.rainCount;
  for (let i = 0; i < count; i++) {
    // Staggered heights above the screen make it arrive as a downpour rather than a wall.
    const x = randRange(rng, 4, terrain.width - 4);
    const y = -10 - rng() * terrain.height * 0.9;
    spawnProjectile(state, p, weapon, x, y, randRange(rng, -50, 50), randRange(rng, 0, 80));
  }
}

/** Angle offsets (degrees) for each projectile in a round, spread evenly across ±spreadDeg. */
export function volleyOffsets(weapon: Projectiles): number[] {
  const count = weapon.volley?.count ?? 1;
  const spread = weapon.volley?.spreadDeg ?? 0;
  if (count <= 1) return [0];
  return Array.from({ length: count }, (_, i) => -spread + (2 * spread * i) / (count - 1));
}

/** Moves one projectile. Returns true when it is finished (exploded or left the map). */
export function stepProjectile(state: GameState, pr: Projectile, dt: number): boolean {
  const { terrain } = state;
  const weapon = projectileWeapon(pr.weaponId);
  if (pr.wait !== undefined) {
    pr.wait -= dt;
    if (pr.wait > 0) return false;
    delete pr.wait;
  }
  pr.age += dt;
  const tracer = pr.tracer !== undefined;
  // A stratagem beacon calls its stratagem in where it lands, rather than going off.
  const goOff = (x: number, y: number) => (pr.stratagem ? landBeacon(state, pr, x, y) : explode(state, x, y, weapon, pr.ownerId));
  if (pr.age > PROJECTILE_MAX_AGE) {
    if (!tracer) goOff(pr.x, pr.y);
    return true;
  }
  if (pr.walkDir !== 0) return stepWalker(state, pr, weapon, dt);
  if (weapon.topAttack && !tracer) topAttack(state, pr, weapon.topAttack);
  if (weapon.homing && !tracer && !pr.attack) steerHoming(state, pr, weapon.homing, dt);
  if ((!pr.homing || weapon.homing?.soft || pr.attack === 'pop') && !weapon.straight && pr.attack !== 'slam') pr.vy += GRAVITY * dt;
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
    if (tracer) {
      if (targetAt(state, x, y) || terrain.isSolid(x, y)) {
        landTracer(state, pr, x, Math.min(y, terrain.height));
        return true;
      }
      lastX = x;
      lastY = y;
      continue;
    }
    if (targetAt(state, x, y) || runnerAt(state, x, y, pr.ownerId)) {
      goOff(x, y);
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
      goOff(x, Math.min(y, terrain.height));
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
  const weapon = projectileWeapon(b.weaponId);
  const spec = weapon.burst!; // (only burst weapons have bursts)
  const p = state.players[b.playerId]!;
  const count = b.word ? b.word.length : spec.count;
  // A twin destroyed mid-burst (or a dead player) stops firing.
  if (!p.alive || (b.origin === 'twin' && !p.twin)) return true;
  const gun = gunOf(p, b.origin);
  b.elapsed += dt;
  while (b.fired < count && b.elapsed >= b.fired * spec.interval) {
    const m = muzzle({ ...gun, angle: b.angle });
    const jitter = spec.aimJitterDeg ?? 1;
    const a = ((b.angle + randRange(state.rng, -jitter, jitter)) * Math.PI) / 180;
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
function bounce(state: GameState, pr: Projectile, weapon: Projectiles, hitX: number, hitY: number, freeX: number, freeY: number): void {
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

/**
 * A top attack (the Spear): right over an enemy (and well above them), it stops dead and fires its motor
 * up; at the top of that, it turns and comes slamming straight down.
 */
function topAttack(state: GameState, pr: Projectile, spec: NonNullable<Projectiles['topAttack']>): void {
  if (pr.attack === 'pop') {
    if (pr.vy < 0) return;
    pr.attack = 'slam';
    pr.vx = 0;
    pr.vy = spec.slam;
    sound(state, 'slam', pr.weaponId);
    return;
  }
  if (pr.attack === 'slam') return;
  let over = false;
  forEachTargetPos(state, (x, y, owner) => {
    if (owner !== pr.ownerId && Math.abs(x - pr.x) <= spec.reach && y - pr.y >= spec.above) over = true;
  }, true);
  if (!over) return;
  pr.attack = 'pop';
  pr.homing = false;
  pr.vx = 0;
  pr.vy = -spec.pop;
  sound(state, 'pop-up', pr.weaponId);
}

/** Homing: lock on to the nearest enemy within range (that can be seen: not one hidden by Sly), then turn towards it (keeping up speed). */
function steerHoming(state: GameState, pr: Projectile, spec: NonNullable<Projectiles['homing']>, dt: number): void {
  let found = false;
  let bestX = 0;
  let bestY = 0;
  let bestD = pr.homing ? Infinity : spec.radius;
  forEachTargetPos(state, (x, y, owner) => {
    if (owner === pr.ownerId) return;
    const cy = y - TANK_BODY_HEIGHT / 2;
    const d = Math.hypot(x - pr.x, cy - pr.y);
    if (d < bestD) {
      [found, bestX, bestY, bestD] = [true, x, cy, d];
    }
  }, true);
  if (!found) return; // (locked on, but there's nobody left to chase: carry straight on)
  if (!pr.homing) {
    pr.homing = true;
    sound(state, 'lock-on', pr.weaponId);
  }
  const speed = Math.max(Math.hypot(pr.vx, pr.vy), spec.minSpeed);
  const have = Math.atan2(pr.vy, pr.vx);
  const want = Math.atan2(bestY - pr.y, bestX - pr.x);
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

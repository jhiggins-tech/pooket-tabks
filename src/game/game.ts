import { createRng, randRange } from '../core/rng';
import { Terrain } from '../core/terrain';
import { flattenAround, generateHeights } from '../core/terrainGen';
import { AMMO_PER_TIER, getCharacter } from '../characters/roster';
import { getWeapon } from '../weapons/registry';
import type { WeaponDef } from '../weapons/types';
import {
  BARREL_LENGTH,
  GRAVITY,
  MAX_HP,
  MAX_SPEED,
  SETTLE_TIME,
  TANK_BODY_HEIGHT,
  TANK_HALF_WIDTH,
  TANK_HIT_RADIUS,
  WORLD_H,
  WORLD_W,
} from './constants';
import type { GameState, Player, PlayerConfig, Projectile } from './state';

const BEAM_DURATION = 0.6;
const FLOATER_DURATION = 1.6;
const MAX_FLOATERS = 40;
const PROJECTILE_MAX_AGE = 12; // s; anything still bouncing around by then just pops
const DEFAULT_BEAM_COLOUR = '#ff3df2';

export interface GameConfig {
  seed: number;
  players: PlayerConfig[];
  width?: number;
  height?: number;
}

export function createGame(cfg: GameConfig): GameState {
  if (cfg.players.length < 2) throw new Error('Need at least 2 players');
  const width = cfg.width ?? WORLD_W;
  const height = cfg.height ?? WORLD_H;
  const rng = createRng(cfg.seed);

  const heights = generateHeights(rng, width, height);
  const n = cfg.players.length;
  // Keep spawns out of the bottom corners, where the phone thumb controls sit.
  const xs = cfg.players.map((_, i) => {
    const base = width * (0.24 + (0.52 * i) / (n - 1));
    return Math.round(base + randRange(rng, -1, 1) * width * 0.02);
  });
  for (const x of xs) flattenAround(heights, x, TANK_HALF_WIDTH + 4);
  const terrain = Terrain.fromHeights(heights, width, height, rng);

  const players: Player[] = cfg.players.map((p, i) => {
    const x = xs[i]!;
    const character = getCharacter(p.characterId);
    return {
      id: i,
      name: p.name,
      colour: p.colour,
      x,
      y: terrain.surfaceY(x),
      hp: MAX_HP,
      angle: x < width / 2 ? 45 : 135,
      power: 60,
      alive: true,
      characterId: character.id,
      loadout: [...character.loadout],
      ammo: [...AMMO_PER_TIER],
      selectedTier: 0,
      burn: null,
    };
  });

  return {
    seed: cfg.seed,
    terrain,
    players,
    current: 0,
    turn: 1,
    phase: 'aiming',
    projectiles: [],
    beams: [],
    explosions: [],
    floaters: [],
    rng,
    fxSeq: 0,
    settleTimer: 0,
    winner: null,
  };
}

export function currentPlayer(state: GameState): Player {
  return state.players[state.current]!;
}

export function tankCentre(p: Player): { x: number; y: number } {
  return { x: p.x, y: p.y - TANK_BODY_HEIGHT };
}

export function muzzle(p: Player): { x: number; y: number } {
  const c = tankCentre(p);
  const a = (p.angle * Math.PI) / 180;
  return { x: c.x + Math.cos(a) * BARREL_LENGTH, y: c.y - Math.sin(a) * BARREL_LENGTH };
}

/** True when the current player's selected weapon ignores angle and power. */
export function isAimless(state: GameState): boolean {
  const p = currentPlayer(state);
  return (weaponForTier(p, p.selectedTier).kind ?? 'ballistic') === 'rain';
}

export function setAim(state: GameState, angle: number, power: number): void {
  if (state.phase !== 'aiming' || isAimless(state)) return;
  const p = currentPlayer(state);
  p.angle = clamp(Math.round(angle), 0, 180);
  p.power = clamp(Math.round(power), 0, 100);
}

export function adjustAim(state: GameState, dAngle: number, dPower: number): void {
  const p = currentPlayer(state);
  setAim(state, p.angle + dAngle, p.power + dPower);
}

export function hasAmmo(p: Player): boolean {
  return p.ammo.some((n) => n > 0);
}

export function weaponForTier(p: Player, tier: number): WeaponDef {
  return getWeapon(p.loadout[tier]!);
}

/** Choose which tier the current player fires next. Returns false if it has no rounds left. */
export function selectTier(state: GameState, tier: number): boolean {
  if (state.phase !== 'aiming') return false;
  const p = currentPlayer(state);
  if ((p.ammo[tier] ?? 0) <= 0) return false;
  p.selectedTier = tier;
  return true;
}

export function fire(state: GameState): boolean {
  if (state.phase !== 'aiming') return false;
  const p = currentPlayer(state);
  const tier = p.selectedTier;
  if ((p.ammo[tier] ?? 0) <= 0) return false;
  p.ammo[tier]!--;
  if (p.ammo[tier] === 0) {
    // Fall back to the lowest tier that still has rounds.
    const next = p.ammo.findIndex((n) => n > 0);
    if (next >= 0) p.selectedTier = next;
  }
  const weapon = weaponForTier(p, tier);
  switch (weapon.kind ?? 'ballistic') {
    case 'beam':
      fireBeam(state, p, weapon);
      break;
    case 'rain':
      fireRain(state, p, weapon);
      break;
    case 'ballistic':
      fireBallistic(state, p, weapon);
      break;
  }
  state.phase = 'flying';
  return true;
}

function spawnProjectile(state: GameState, owner: Player, weapon: WeaponDef, x: number, y: number, vx: number, vy: number): void {
  state.projectiles.push({ x, y, vx, vy, weaponId: weapon.id, ownerId: owner.id, trail: [], bounces: 0, age: 0 });
}

function fireBallistic(state: GameState, p: Player, weapon: WeaponDef): void {
  const speed = (p.power / 100) * MAX_SPEED;
  const m = muzzle(p);
  for (const offset of volleyOffsets(weapon)) {
    const a = ((p.angle + offset) * Math.PI) / 180;
    spawnProjectile(state, p, weapon, m.x, m.y, Math.cos(a) * speed, -Math.sin(a) * speed);
  }
}

/** Straight line from the barrel until it meets ground, a tank or the edge of the map. */
export function traceBeam(state: GameState, p: Player): { x: number; y: number; hit: Player | 'ground' | null } {
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
    const tank = tankAt(state, x, y);
    if (tank) return { x, y, hit: tank };
    if (terrain.isSolid(x, y)) return { x, y: Math.min(y, terrain.height), hit: 'ground' };
  }
  return { x: m.x + dx * maxLen, y: m.y + dy * maxLen, hit: null };
}

function fireBeam(state: GameState, p: Player, weapon: WeaponDef): void {
  const m = muzzle(p);
  const end = traceBeam(state, p);
  const colour = weapon.colour ?? DEFAULT_BEAM_COLOUR;
  state.beams.push({ x1: m.x, y1: m.y, x2: end.x, y2: end.y, colour, hitTank: typeof end.hit === 'object' && end.hit !== null, age: 0, duration: BEAM_DURATION });
  if (end.hit === 'ground') {
    state.terrain.carveCircle(end.x, end.y, weapon.blastRadius);
    settleTanks(state);
  } else if (end.hit) {
    const target = end.hit;
    damagePlayer(state, target, weapon.damage);
    if (weapon.dot && target.alive) {
      // A fresh hit refreshes the burn rather than stacking it.
      target.burn = { damagePerTurn: weapon.dot.damagePerTurn, turnsLeft: weapon.dot.turns, colour };
    }
  }
}

function fireRain(state: GameState, p: Player, weapon: WeaponDef): void {
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

/** Advance the simulation by dt seconds. Pure logic: no DOM, safe to run in tests. */
export function step(state: GameState, dt: number): void {
  for (const e of state.explosions) e.age += dt;
  state.explosions = state.explosions.filter((e) => e.age < e.duration);
  stepFloaters(state, dt);

  if (state.phase === 'flying') {
    state.projectiles = state.projectiles.filter((pr) => !stepProjectile(state, pr, dt));
    for (const b of state.beams) b.age += dt;
    state.beams = state.beams.filter((b) => b.age < b.duration);
    if (state.projectiles.length === 0 && state.beams.length === 0) {
      state.phase = 'settling';
      state.settleTimer = SETTLE_TIME;
    }
  } else if (state.phase === 'settling') {
    state.settleTimer -= dt;
    if (state.settleTimer <= 0) endTurn(state);
  }
}

/** Moves one projectile. Returns true when it is finished (exploded or left the map). */
function stepProjectile(state: GameState, pr: Projectile, dt: number): boolean {
  const { terrain } = state;
  const weapon = getWeapon(pr.weaponId);
  pr.age += dt;
  if (pr.age > PROJECTILE_MAX_AGE) {
    explode(state, pr.x, pr.y, weapon, pr.ownerId);
    return true;
  }
  pr.vy += GRAVITY * dt;
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
    if (tankAt(state, x, y)) {
      explode(state, x, y, weapon, pr.ownerId);
      return true;
    }
    if (terrain.isSolid(x, y)) {
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

function tankAt(state: GameState, x: number, y: number): Player | undefined {
  return state.players.find((p) => {
    if (!p.alive) return false;
    const c = tankCentre(p);
    return Math.hypot(x - c.x, y - c.y) <= TANK_HIT_RADIUS;
  });
}

export function explode(state: GameState, x: number, y: number, weapon: WeaponDef, ownerId?: number): void {
  const r = weapon.blastRadius;
  state.terrain.carveCircle(x, y, r);
  state.explosions.push({ x, y, radius: r, age: 0, duration: r < 15 ? 0.35 : 0.5 });

  for (const p of state.players) {
    if (!p.alive) continue;
    if (weapon.friendlyFire === false && p.id === ownerId) continue;
    const c = tankCentre(p);
    const reach = r + TANK_HIT_RADIUS;
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < reach) damagePlayer(state, p, Math.round(weapon.damage * (1 - d / reach)));
  }
  settleTanks(state);
}

/** Every source of damage goes through here so it always gets a floating number. */
export function damagePlayer(state: GameState, p: Player, amount: number, colour = '#ffffff'): void {
  if (amount <= 0 || !p.alive) return;
  p.hp = Math.max(0, p.hp - amount);
  if (p.hp === 0) p.alive = false;
  spawnFloater(state, p, `-${amount}`, colour);
}

function spawnFloater(state: GameState, p: Player, text: string, colour: string): void {
  const c = tankCentre(p);
  const seq = state.fxSeq++;
  // Alternate sides and vary the slope a little so bursts of hits fan out.
  const side = seq % 2 === 0 ? 1 : -1;
  const drift = 18 + ((seq * 7) % 5) * 6;
  state.floaters.push({ x: c.x + side * 4, y: c.y - 14, vx: side * drift, vy: -55, text, colour, age: 0, duration: FLOATER_DURATION });
  if (state.floaters.length > MAX_FLOATERS) state.floaters.shift();
}

function stepFloaters(state: GameState, dt: number): void {
  for (const f of state.floaters) {
    f.age += dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.vy *= 1 - 0.6 * dt; // ease out as it rises
  }
  state.floaters = state.floaters.filter((f) => f.age < f.duration);
}

/** Drop tanks onto whatever ground is left beneath them. */
function settleTanks(state: GameState): void {
  const { terrain } = state;
  for (const p of state.players) {
    let ground = terrain.height;
    for (let dx = -TANK_HALF_WIDTH + 2; dx <= TANK_HALF_WIDTH - 2; dx += 2) {
      ground = Math.min(ground, terrain.groundBelow(p.x + dx, p.y));
    }
    p.y = ground;
  }
}

function endTurn(state: GameState): void {
  // Hand the turn on. Each player whose turn comes up takes their burn damage first;
  // players who are dead or out of ammo are skipped.
  const n = state.players.length;
  let next = -1;
  for (let k = 1; k <= n; k++) {
    const idx = (state.current + k) % n;
    const p = state.players[idx]!;
    if (!p.alive) continue;
    tickBurn(state, p);
    if (p.alive && hasAmmo(p)) {
      next = idx;
      break;
    }
  }

  const alive = state.players.filter((p) => p.alive);
  if (alive.length <= 1) {
    state.phase = 'gameover';
    state.winner = alive[0] ?? null;
    return;
  }
  if (next < 0) {
    // Everyone is out of ammo: highest HP wins, a tie is a draw.
    const best = Math.max(...alive.map((p) => p.hp));
    const leaders = alive.filter((p) => p.hp === best);
    state.phase = 'gameover';
    state.winner = leaders.length === 1 ? leaders[0]! : null;
    return;
  }
  state.current = next;
  state.turn++;
  state.phase = 'aiming';
}

function tickBurn(state: GameState, p: Player): void {
  if (!p.burn) return;
  const { damagePerTurn, colour } = p.burn;
  p.burn.turnsLeft--;
  if (p.burn.turnsLeft <= 0) p.burn = null;
  damagePlayer(state, p, damagePerTurn, colour);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

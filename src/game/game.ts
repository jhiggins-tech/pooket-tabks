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
    explosions: [],
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

export function setAim(state: GameState, angle: number, power: number): void {
  if (state.phase !== 'aiming') return;
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
  const speed = (p.power / 100) * MAX_SPEED;
  const m = muzzle(p);
  for (const offset of volleyOffsets(weapon)) {
    const a = ((p.angle + offset) * Math.PI) / 180;
    state.projectiles.push({
      x: m.x,
      y: m.y,
      vx: Math.cos(a) * speed,
      vy: -Math.sin(a) * speed,
      weaponId: weapon.id,
      ownerId: p.id,
      trail: [],
    });
  }
  state.phase = 'flying';
  return true;
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

  if (state.phase === 'flying') {
    state.projectiles = state.projectiles.filter((pr) => !stepProjectile(state, pr, dt));
    if (state.projectiles.length === 0) {
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
  pr.vy += GRAVITY * dt;
  const nx = pr.x + pr.vx * dt;
  const ny = pr.y + pr.vy * dt;

  // Sweep the segment in ~1px increments so fast shells can't tunnel through thin ground.
  const dist = Math.hypot(nx - pr.x, ny - pr.y);
  const steps = Math.max(1, Math.ceil(dist));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = pr.x + (nx - pr.x) * t;
    const y = pr.y + (ny - pr.y) * t;
    if (terrain.isSolid(x, y) || hitsTank(state, x, y)) {
      explode(state, x, Math.min(y, terrain.height), getWeapon(pr.weaponId));
      return true;
    }
  }

  pr.x = nx;
  pr.y = ny;
  pr.trail.push({ x: nx, y: ny });
  if (pr.trail.length > 40) pr.trail.shift();

  const margin = 200;
  return pr.x < -margin || pr.x > terrain.width + margin;
}

function hitsTank(state: GameState, x: number, y: number): boolean {
  return state.players.some((p) => {
    if (!p.alive) return false;
    const c = tankCentre(p);
    return Math.hypot(x - c.x, y - c.y) <= TANK_HIT_RADIUS;
  });
}

export function explode(state: GameState, x: number, y: number, weapon: WeaponDef): void {
  const r = weapon.blastRadius;
  state.terrain.carveCircle(x, y, r);
  state.explosions.push({ x, y, radius: r, age: 0, duration: 0.5 });

  for (const p of state.players) {
    if (!p.alive) continue;
    const c = tankCentre(p);
    const reach = r + TANK_HIT_RADIUS;
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < reach) {
      p.hp = Math.max(0, p.hp - Math.round(weapon.damage * (1 - d / reach)));
      if (p.hp === 0) p.alive = false;
    }
  }
  settleTanks(state);
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
  const alive = state.players.filter((p) => p.alive);
  if (alive.length <= 1) {
    state.phase = 'gameover';
    state.winner = alive[0] ?? null;
    return;
  }
  const armed = alive.filter(hasAmmo);
  if (armed.length === 0) {
    // Everyone is out of ammo: highest HP wins, a tie is a draw.
    const best = Math.max(...alive.map((p) => p.hp));
    const leaders = alive.filter((p) => p.hp === best);
    state.phase = 'gameover';
    state.winner = leaders.length === 1 ? leaders[0]! : null;
    return;
  }
  // Next living player who still has rounds; players with no ammo are skipped.
  const n = state.players.length;
  let next = state.current;
  do next = (next + 1) % n;
  while (!state.players[next]!.alive || !hasAmmo(state.players[next]!));
  state.current = next;
  state.turn++;
  state.phase = 'aiming';
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

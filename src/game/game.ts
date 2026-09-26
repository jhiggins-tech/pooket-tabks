import { createRng, randRange } from '../core/rng';
import { Terrain } from '../core/terrain';
import { flattenAround, generateHeights } from '../core/terrainGen';
import { AMMO_PER_TIER, getCharacter } from '../characters/roster';
import { DICTIONARIES } from '../weapons/dictionaries';
import { getWeapon } from '../weapons/registry';
import type { StreamSpec, WeaponDef } from '../weapons/types';
import {
  BARREL_LENGTH,
  DRIVE_CLIMB,
  DRIVE_SPEED,
  FUEL_PER_MATCH,
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
import type {
  Hop,
  Runner,
  Stitch,
  Boom,
  Twin,
  Burst,
  Droplet,
  GameState,
  Hologram,
  Jet,
  Nap,
  Player,
  PlayerConfig,
  Projectile,
  Puddle,
  Sludge,
  Spew,
  Stream,
} from './state';

/** Something a shot can hit: a real tank or a hologram of one. */
export type Target =
  | { kind: 'player'; player: Player }
  | { kind: 'hologram'; holo: Hologram }
  | { kind: 'twin'; player: Player };

const BEAM_DURATION = 0.6;
const FLOATER_DURATION = 1.6;
const MAX_FLOATERS = 40;
const PROJECTILE_MAX_AGE = 12; // s; anything still bouncing around by then just pops
const DEFAULT_BEAM_COLOUR = '#ff3df2';
const SOAK_FLUSH_INTERVAL = 0.18; // s between batched stream-damage numbers
const MAX_SPLASHES = 220;
const HOLOGRAM_COLOUR = '#7cf7d4';
/** Share of the would-be damage a shooter takes for hitting a hologram. */
export const HOLOGRAM_PENALTY = 0.5;
const HOLOGRAM_MIN_SPACING = 70;

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
      soak: 0,
      soakColour: '#ffffff',
      cooked: null,
      tattoo: null,
      pinned: null,
      hop: null,
      twin: null,
      fuel: FUEL_PER_MATCH,
      toxin: 0,
      toxinRate: 0,
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
    holograms: [],
    swapTargetId: null,
    shimmers: [],
    ghosts: [],
    streams: [],
    jets: [],
    spews: [],
    stitches: [],
    runners: [],
    bursts: [],
    naps: [],
    booms: [],
    apparitions: [],
    sludge: [],
    puddles: [],
    droplets: [],
    splashes: [],
    soakTimer: 0,
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

/**
 * Drive the current player's tank along the ground for dt seconds in direction `dir` (−1 / +1),
 * spending fuel per pixel from a tank that has to last the whole match. It climbs steps up to DRIVE_CLIMB px, rolls down slopes and drops off
 * ledges; walls, other tanks (and holograms), and the map edges stop it. Only before firing.
 * Returns the distance moved.
 */
export function drive(state: GameState, dir: number, dt: number): number {
  if (state.phase !== 'aiming') return 0;
  const p = currentPlayer(state);
  if (getCharacter(p.characterId).movement === 'hop') return hopDrive(state, p, dir, dt);
  if (dir === 0 || p.pinned?.active) return 0;
  const { terrain } = state;
  let budget = Math.min(p.fuel, DRIVE_SPEED * dt);
  let moved = 0;
  while (budget > 0) {
    const stepX = Math.min(1, budget);
    const nx = p.x + Math.sign(dir) * stepX;
    if (nx < TANK_HALF_WIDTH || nx > terrain.width - TANK_HALF_WIDTH) break;
    const blocked = [...tankBodies(state).filter((q) => !(q.owner === p && !q.twin)), ...state.holograms].some(
      (q) => Math.abs(q.x - nx) < TANK_HALF_WIDTH * 2 && Math.abs(q.x - nx) < Math.abs(q.x - p.x),
    );
    if (blocked) break;
    // Compare where the hull would rest at nx with where it rests now (the highest supporting
    // column under it), so a tank sitting slightly into a slope isn't mistaken for hitting a wall.
    const here = hullRest(state, p.x, p.y - DRIVE_CLIMB - 1);
    const ground = hullRest(state, nx, here - DRIVE_CLIMB - 1);
    if (ground < here - DRIVE_CLIMB) break; // a wall
    p.x = nx;
    p.y = ground;
    budget -= stepX;
    moved += stepX;
  }
  p.fuel = Math.max(0, p.fuel - moved);
  if (moved > 0 && hash(state.fxSeq * 0.37 + p.x) < 0.25) spawnDust(state, p.x - Math.sign(dir) * 9, p.y, 0.15);
  return moved;
}

// ---- Frog hops (ciarra's movement) ---------------------------------------------------------------

/** How far one frog hop goes, how high it jumps, and how long it takes. */
export const HOP_DISTANCE = 24;
export const HOP_HEIGHT = 16;
export const HOP_TIME = 0.34;

/**
 * Hop movement: while ◀ / ▶ is held the tank makes little frog leaps, each spending HOP_DISTANCE of
 * fuel. A hop clears walls up to HOP_HEIGHT that would stop a driving tank. Returns px moved this step.
 */
function hopDrive(state: GameState, p: Player, dir: number, dt: number): number {
  if (p.hop) {
    const h = p.hop;
    const before = p.x;
    h.t = Math.min(1, h.t + dt / HOP_TIME);
    p.x = h.x0 + (h.x1 - h.x0) * h.t;
    p.y = h.y0 + (h.y1 - h.y0) * h.t - 4 * HOP_HEIGHT * h.t * (1 - h.t);
    if (h.t >= 1) {
      p.x = h.x1;
      p.y = h.y1;
      p.hop = null;
      spawnDust(state, p.x, p.y, 0.4);
    }
    return Math.abs(p.x - before);
  }
  if (dir === 0 || p.pinned?.active) return 0;
  const hop = planHop(state, p, Math.sign(dir));
  if (!hop) return 0;
  p.fuel = Math.max(0, p.fuel - Math.abs(hop.x1 - hop.x0));
  p.hop = hop;
  spawnDust(state, p.x, p.y, 0.4);
  return 0;
}

/** Plan the longest hop (up to HOP_DISTANCE, limited by fuel) that clears everything in the way. */
function planHop(state: GameState, p: Player, dir: number): Hop | null {
  const { terrain } = state;
  const apex = p.y - HOP_HEIGHT;
  const maxDist = Math.min(HOP_DISTANCE, p.fuel);
  for (let dist = Math.floor(maxDist); dist >= 4; dist -= 2) {
    const x1 = p.x + dir * dist;
    if (x1 < TANK_HALF_WIDTH || x1 > terrain.width - TANK_HALF_WIDTH) continue;
    // Nothing along the way pokes above the top of the hop…
    let clear = true;
    for (let d = 1; d <= dist && clear; d++) {
      for (const dx of [-TANK_HALF_WIDTH + 2, TANK_HALF_WIDTH - 2]) {
        if (terrain.isSolid(p.x + dir * d + dx, apex)) clear = false;
      }
    }
    if (!clear) continue;
    // …it lands on solid ground no higher than the apex, and not on top of another tank.
    const y1 = hullRest(state, x1, apex);
    if (y1 < apex) continue;
    const bump = [...tankBodies(state).filter((q) => !(q.owner === p && !q.twin)), ...state.holograms].some(
      (q) => Math.abs(q.x - x1) < TANK_HALF_WIDTH * 2,
    );
    if (bump) continue;
    return { x0: p.x, y0: p.y, x1, y1, t: 0 };
  }
  return null;
}

/** y where a tank's hull would rest at x: the highest ground under it, searching down from fromY. */
function hullRest(state: GameState, x: number, fromY: number): number {
  let ground = state.terrain.height;
  for (let dx = -TANK_HALF_WIDTH + 2; dx <= TANK_HALF_WIDTH - 2; dx += 2) {
    ground = Math.min(ground, state.terrain.groundBelow(x + dx, fromY));
  }
  return ground;
}

/** True when the current player's selected weapon ignores angle and power. */
export function isAimless(state: GameState): boolean {
  const p = currentPlayer(state);
  const kind = weaponForTier(p, p.selectedTier).kind ?? 'ballistic';
  return kind === 'rain' || kind === 'decoy' || kind === 'heal' || kind === 'twin' || kind === 'runner';
}

export function setAim(state: GameState, angle: number, power: number): void {
  if (state.phase !== 'aiming' || isAimless(state)) return;
  const p = currentPlayer(state);
  p.angle = normalizeAngle(Math.round(angle));
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
  if (p.hop) return false; // land first
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
    case 'stream':
      fireStream(state, p, weapon);
      break;
    case 'decoy':
      fireDecoys(state, p, weapon);
      break;
    case 'sonic':
      fireSonic(state, p, weapon, p);
      if (p.twin) fireSonic(state, p, weapon, twinGun(p));
      break;
    case 'twin':
      spawnTwin(state, p);
      break;
    case 'sew': {
      const spec = weapon.sew!;
      const m = muzzle(p);
      state.stitches.push({
        ownerId: p.id,
        weaponId: weapon.id,
        x0: m.x,
        y0: m.y,
        angle: (p.angle * Math.PI) / 180,
        range: spec.minRange + (spec.maxRange - spec.minRange) * (p.power / 100),
        travelled: 0,
        path: [{ x: m.x, y: m.y }],
        hits: [],
        linger: 1.2,
        done: false,
      });
      break;
    }
    case 'runner':
      state.runners.push({ ownerId: p.id, weaponId: weapon.id, x: p.x, y: p.y, dir: 1, legLeft: 0, distance: 0, out: false });
      break;
    case 'spew':
      state.spews.push({ playerId: p.id, weaponId: weapon.id, elapsed: 0, emitCarry: 0 });
      break;
    case 'jetpack':
      state.jets.push({
        playerId: p.id,
        weaponId: weapon.id,
        elapsed: 0,
        launched: false,
        vx: 0,
        vy: 0,
        burnLeft: 0,
        emitCarry: 0,
        flightTime: 0,
        heading: (p.angle * Math.PI) / 180,
      });
      break;
    case 'heal':
      state.naps.push({ playerId: p.id, weaponId: weapon.id, elapsed: 0, nextZ: 0 });
      break;
    case 'ballistic':
      fireRounds(state, p, weapon, 'main');
      // A twin fires the same weapon with the same trajectory and power from its own spot.
      if (p.twin) fireRounds(state, p, weapon, 'twin');
      break;
  }
  // The marathon goes on: every shot fired sends every runner off on another leg.
  for (const r of state.runners) r.legLeft += getWeapon(r.weaponId).runner!.leg;
  if (weapon.apparition) {
    const c = tankCentre(p);
    state.apparitions.push({ kind: weapon.apparition, x: c.x, y: Math.max(40, c.y - 120), age: 0, duration: 3.2 });
  }
  state.phase = 'flying';
  return true;
}

function spawnProjectile(state: GameState, owner: Player, weapon: WeaponDef, x: number, y: number, vx: number, vy: number): void {
  state.projectiles.push({ x, y, vx, vy, weaponId: weapon.id, ownerId: owner.id, trail: [], bounces: 0, age: 0, walkDir: 0, walkTime: 0 });
}

function fireBallistic(state: GameState, p: Player, weapon: WeaponDef): void {
  const speed = (p.power / 100) * MAX_SPEED;
  const m = muzzle(p);
  for (const offset of volleyOffsets(weapon)) {
    const a = ((p.angle + offset) * Math.PI) / 180;
    spawnProjectile(state, p, weapon, m.x, m.y, Math.cos(a) * speed, -Math.sin(a) * speed);
  }
}

/** The player's twin as a stand-in shooter: same aim and power, the twin's position. */
function twinGun(p: Player): Player {
  return { ...p, x: p.twin!.x, y: p.twin!.y };
}

/** Ballistic rounds from the main tank or the twin: a single shot/volley, a burst, or a word. */
function fireRounds(state: GameState, p: Player, weapon: WeaponDef, origin: 'main' | 'twin'): void {
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

function fireSonic(state: GameState, p: Player, weapon: WeaponDef, gun: Player): void {
  const spec = weapon.sonic!;
  const m = muzzle(gun);
  state.booms.push({
    ownerId: p.id,
    weaponId: weapon.id,
    x: m.x,
    y: m.y,
    angle: (p.angle * Math.PI) / 180,
    range: spec.minRange + (spec.maxRange - spec.minRange) * (p.power / 100),
    elapsed: 0,
    hits: Array.from({ length: spec.waves }, () => []),
  });
}

/** Twins: a second tank appears somewhere clear, and the player's HP is split between the two. */
function spawnTwin(state: GameState, p: Player): void {
  if (p.twin || p.hp < 2) return;
  const { terrain, rng } = state;
  const taken = [...tankBodies(state).map((q) => q.x), ...state.holograms.map((h) => h.x)];
  let x = randRange(rng, terrain.width * 0.12, terrain.width * 0.88);
  for (let tries = 0; tries < 60 && taken.some((t) => Math.abs(t - x) < HOLOGRAM_MIN_SPACING); tries++) {
    x = randRange(rng, terrain.width * 0.12, terrain.width * 0.88);
  }
  x = Math.round(x);
  const twin: Twin = { x, y: terrain.surfaceY(x), hp: Math.floor(p.hp / 2), soak: 0, soakColour: '#ffffff', age: 0 };
  p.hp -= twin.hp;
  p.twin = twin;
  ring(state, p.x, p.y - TANK_BODY_HEIGHT, p.colour);
  ring(state, twin.x, twin.y - TANK_BODY_HEIGHT, p.colour);
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

function fireBeam(state: GameState, p: Player, weapon: WeaponDef): void {
  const m = muzzle(p);
  const end = traceBeam(state, p);
  const colour = weapon.colour ?? DEFAULT_BEAM_COLOUR;
  state.beams.push({ x1: m.x, y1: m.y, x2: end.x, y2: end.y, colour, hitTank: end.hit !== null && end.hit !== 'ground', age: 0, duration: BEAM_DURATION });
  if (end.hit === 'ground') {
    state.terrain.carveCircle(end.x, end.y, weapon.blastRadius);
    settleTanks(state);
  } else if (end.hit) {
    damageTarget(state, end.hit, scaled(state, p.id, weapon.damage), p.id);
    const target = end.hit.kind === 'player' ? end.hit.player : null;
    if (weapon.dot && target?.alive) {
      // A fresh hit refreshes the burn rather than stacking it.
      target.burn = { damagePerTurn: scaled(state, p.id, weapon.dot.damagePerTurn), turnsLeft: weapon.dot.turns, colour };
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

/** Replace the firer's holograms with fresh ones at random, well-spaced spots on the ground. */
function fireDecoys(state: GameState, p: Player, weapon: WeaponDef): void {
  const { terrain, rng } = state;
  state.holograms = state.holograms.filter((h) => h.ownerId !== p.id);
  state.swapTargetId = null;
  const colour = weapon.colour ?? HOLOGRAM_COLOUR;
  ring(state, p.x, p.y - TANK_BODY_HEIGHT, colour);
  shimmer(state, p.id);
  for (let n = 0; n < (weapon.decoys ?? 2); n++) {
    const taken = [...tankBodies(state).map((q) => q.x), ...state.holograms.map((h) => h.x)];
    let x = randRange(rng, terrain.width * 0.12, terrain.width * 0.88);
    for (let tries = 0; tries < 60 && taken.some((t) => Math.abs(t - x) < HOLOGRAM_MIN_SPACING); tries++) {
      x = randRange(rng, terrain.width * 0.12, terrain.width * 0.88);
    }
    x = Math.round(x);
    const holo: Hologram = {
      id: state.fxSeq++,
      ownerId: p.id,
      x,
      y: terrain.surfaceY(x),
      hits: [],
      soak: 0,
      soakShooterId: -1,
      soakColour: '#ffffff',
      age: 0,
    };
    state.holograms.push(holo);
    ring(state, holo.x, holo.y - TANK_BODY_HEIGHT, colour);
  }
}

const SHIMMER_DURATION = 0.7;
const GHOST_DURATION = 0.8;
/** How long a new hologram takes to phase in (cosmetic). */
export const HOLOGRAM_PHASE_IN = 0.8;

function shimmer(state: GameState, ownerId: number): void {
  state.shimmers.push({ ownerId, age: 0, duration: SHIMMER_DURATION });
}

function stepPhaseFx(state: GameState, dt: number): void {
  for (const h of state.holograms) h.age += dt;
  for (const p of state.players) if (p.twin) p.twin.age += dt;
  for (const s of state.shimmers) s.age += dt;
  for (const g of state.ghosts) g.age += dt;
  state.shimmers = state.shimmers.filter((s) => s.age < s.duration);
  state.ghosts = state.ghosts.filter((g) => g.age < g.duration);
}

function ring(state: GameState, x: number, y: number, colour: string): void {
  state.explosions.push({ x, y, radius: 26, age: 0, duration: 0.7, ring: colour });
}

/** Holograms belonging to a (living) player. */
export function hologramsOf(state: GameState, playerId: number): Hologram[] {
  const owner = state.players[playerId];
  return owner?.alive ? state.holograms.filter((h) => h.ownerId === playerId) : [];
}

/** The current player's hologram nearest (x, y) within radius, if any. */
export function hologramAt(state: GameState, x: number, y: number, radius: number): Hologram | undefined {
  let best: Hologram | undefined;
  let bestD = radius;
  for (const h of hologramsOf(state, currentPlayer(state).id)) {
    const d = Math.hypot(h.x - x, h.y - TANK_BODY_HEIGHT - y);
    if (d <= bestD) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

/** Pick (or un-pick) the hologram to swap with after this turn's shot. Only on your own turn, before firing. */
export function toggleSwapTarget(state: GameState, holoId: number): boolean {
  if (state.phase !== 'aiming') return false;
  const h = state.holograms.find((x) => x.id === holoId);
  if (!h || h.ownerId !== currentPlayer(state).id) return false;
  state.swapTargetId = state.swapTargetId === holoId ? null : holoId;
  return true;
}

function fireStream(state: GameState, p: Player, weapon: WeaponDef): void {
  const m = muzzle(p);
  state.streams.push({
    id: state.fxSeq++,
    weaponId: weapon.id,
    ownerId: p.id,
    x: m.x,
    y: m.y,
    angle: p.angle,
    fullSpeed: (p.power / 100) * MAX_SPEED,
    elapsed: 0,
    emitCarry: 0,
    seed: Math.floor(state.rng() * 1e6),
    colour: weapon.colour ?? '#3fb6ff',
  });
}

/** Total time a stream runs for. */
export function streamDuration(spec: StreamSpec): number {
  return spec.rampUp + spec.hold + spec.rampDown;
}

/**
 * Pressure 0–1 at time t. It builds in uneven spurts (each surges quickly, then plateaus) with a
 * slight flutter, holds at exactly full so the jet completes the aimed arc, then sputters back
 * down the same way. `seed` makes every stream's spurts different.
 */
export function streamPressure(spec: StreamSpec, t: number, seed = 0): number {
  if (t <= 0) return 0;
  const up = spec.rampUp;
  const holdEnd = up + spec.hold;
  let base: number;
  if (t < up) base = spurts(t / up, seed);
  else if (t < holdEnd) return 1;
  else if (t < holdEnd + spec.rampDown) base = 1 - spurts((t - holdEnd) / spec.rampDown, seed + 101);
  else return 0;
  // Flutter fades out at empty and at full, so the endpoints stay exact.
  const flutter = 0.05 * Math.sin(t * 29 + seed) * Math.sin(t * 11.3 + seed * 1.7) * 4 * base * (1 - base);
  return Math.min(1, Math.max(0, base + flutter));
}

const SPURTS = 5;

/**
 * Monotonic 0→1 staircase with uneven step lengths and heights. Each step surges fast then
 * flattens (1 − (1 − f)^4). Later steps tend to be bigger, so it starts as a dribble.
 */
function spurts(u: number, seed: number): number {
  const widths = Array.from({ length: SPURTS }, (_, i) => 0.6 + hash(seed + i * 7.13) * 0.8);
  const rises = Array.from({ length: SPURTS }, (_, i) => (0.5 + hash(seed + i * 3.37 + 50)) * (i + 1));
  const wSum = widths.reduce((a, b) => a + b);
  const rSum = rises.reduce((a, b) => a + b);
  let b0 = 0;
  let h0 = 0;
  for (let i = 0; i < SPURTS; i++) {
    const b1 = b0 + widths[i]! / wSum;
    const h1 = h0 + rises[i]! / rSum;
    if (u < b1 || i === SPURTS - 1) {
      const f = Math.min(1, Math.max(0, (u - b0) / (b1 - b0)));
      return h0 + (h1 - h0) * (1 - (1 - f) ** 4);
    }
    b0 = b1;
    h0 = h1;
  }
  return 1;
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
  stepPhaseFx(state, dt);
  for (const a of state.apparitions) a.age += dt;
  state.apparitions = state.apparitions.filter((a) => a.age < a.duration);

  stepSplashes(state, dt);

  if (state.phase === 'flying') {
    state.projectiles = state.projectiles.filter((pr) => !stepProjectile(state, pr, dt));
    for (const b of state.beams) b.age += dt;
    state.beams = state.beams.filter((b) => b.age < b.duration);
    state.streams = state.streams.filter((st) => !stepStream(state, st, dt));
    state.droplets = state.droplets.filter((d) => !stepDroplet(state, d, dt));
    stepSoak(state, dt, false);
    state.jets = state.jets.filter((j) => !stepJet(state, j, dt));
    state.spews = state.spews.filter((sp) => !stepSpew(state, sp, dt));
    state.bursts = state.bursts.filter((b) => !stepBurst(state, b, dt));
    state.stitches = state.stitches.filter((st) => !stepStitch(state, st, dt));
    state.runners = state.runners.filter((r) => !stepRunner(state, r, dt));
    state.naps = state.naps.filter((n) => !stepNap(state, n, dt));
    state.booms = state.booms.filter((b) => !stepBoom(state, b, dt));
    state.sludge = state.sludge.filter((sl) => !stepSludge(state, sl, dt));
    stepPuddles(state, dt);
    drainToxin(state, dt);
    const busy =
      state.projectiles.length +
      state.beams.length +
      state.streams.length +
      state.droplets.length +
      state.jets.length +
      state.spews.length +
      state.bursts.length +
      state.stitches.length +
      state.runners.filter((r) => r.legLeft > 0).length +
      state.naps.length +
      state.booms.length +
      state.sludge.length +
      state.puddles.length +
      state.players.filter((p) => p.toxin > 0).length;
    if (busy === 0) {
      stepSoak(state, dt, true);
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
  if (pr.walkDir !== 0) return stepWalker(state, pr, weapon, dt);
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

// ---- Walkers (Weasel Pop) ----------------------------------------------------------------------

/** How high a walker's body sits above its feet, for hit-testing and drawing. */
export const WALKER_BODY = 7;

/** Land a walker at (x, y), stand it on the ground and point it at the nearest enemy. */
function startWalking(state: GameState, pr: Projectile, x: number, y: number): void {
  const { terrain } = state;
  pr.x = Math.min(terrain.width - 1, Math.max(0, x));
  pr.y = terrain.groundBelow(pr.x, y);
  pr.vx = 0;
  pr.vy = 0;
  pr.walkDir = directionToNearestEnemy(state, pr);
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
function stepWalker(state: GameState, pr: Projectile, weapon: WeaponDef, dt: number): boolean {
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
    if (nx < 0 || nx > terrain.width - 1) return false; // stands at the map edge until it pops
    if (targetAt(state, nx, pr.y - WALKER_BODY)) {
      explode(state, nx, pr.y - WALKER_BODY, weapon, pr.ownerId);
      return true;
    }
    let ny = pr.y;
    if (terrain.isSolid(nx, ny - 1)) {
      // Step up if it's low enough, otherwise it's a wall: wait here.
      let up = 1;
      while (up <= walk.climb && terrain.isSolid(nx, ny - 1 - up)) up++;
      if (up > walk.climb) return false;
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
  }
  return false;
}

/** Emits droplets for one stream. Returns true once its pressure profile has finished. */
function stepStream(state: GameState, st: Stream, dt: number): boolean {
  const spec = getWeapon(st.weaponId).stream!;
  st.elapsed += dt;
  const pressure = streamPressure(spec, st.elapsed, st.seed);
  // Flow scales with pressure: a sparse dribble at first, a solid jet at full.
  st.emitCarry += spec.dropsPerSecond * (0.2 + 0.8 * pressure) * dt;
  while (st.emitCarry >= 1) {
    st.emitCarry -= 1;
    // Just enough jitter that it isn't a laser; more than this and the drawn ribbon zigzags.
    const a = ((st.angle + randRange(state.rng, -0.12, 0.12)) * Math.PI) / 180;
    const speed = st.fullSpeed * pressure * randRange(state.rng, 0.998, 1.002);
    state.droplets.push({
      streamId: st.id,
      weaponId: st.weaponId,
      ownerId: st.ownerId,
      x: st.x,
      y: st.y,
      vx: Math.cos(a) * speed,
      vy: -Math.sin(a) * speed,
      pressure,
      colour: st.colour,
    });
  }
  return st.elapsed >= streamDuration(spec);
}

/** Moves one droplet. Returns true when it has landed, soaked a tank or left the map. */
function stepDroplet(state: GameState, d: Droplet, dt: number): boolean {
  const { terrain } = state;
  const weapon = getWeapon(d.weaponId);
  d.vy += GRAVITY * dt;
  const nx = d.x + d.vx * dt;
  const ny = d.y + d.vy * dt;
  const steps = Math.max(1, Math.ceil(Math.hypot(nx - d.x, ny - d.y) / 1.5));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = d.x + (nx - d.x) * t;
    const y = d.y + (ny - d.y) * t;
    const target = targetAt(state, x, y);
    if (target && !(weapon.friendlyFire === false && targetOwner(target) === d.ownerId)) {
      soakTarget(target, (weapon.stream?.damagePerDrop ?? 0) * offence(state, d.ownerId), tint(d.colour, 0.35), d.ownerId);
      spawnSplash(state, x, y, d, 3);
      return true;
    }
    if (terrain.isSolid(x, y)) {
      terrain.wetCircle(x, y, 2.5 + d.pressure * 2, hexToRgb(d.colour));
      spawnSplash(state, x, y, d, 2);
      return true;
    }
  }
  d.x = nx;
  d.y = ny;
  return d.x < -50 || d.x > terrain.width + 50;
}

// ---- Jetpack -------------------------------------------------------------------------------------

/** Radius of the circle used for a flying tank's collisions (centred on the body). */
const JET_BODY_RADIUS = 7.5;
const JET_MAX_FLIGHT = 8; // s

/** How far through its charge-up a player's jet is (0–1), or null if they aren't charging. */
export function jetCharge(state: GameState, playerId: number): number | null {
  const j = state.jets.find((x) => x.playerId === playerId);
  if (!j || j.launched) return null;
  return Math.min(1, j.elapsed / getWeapon(j.weaponId).jetpack!.chargeTime);
}

function jetBodyHits(state: GameState, x: number, y: number, self: Player): boolean {
  const cy = y - TANK_BODY_HEIGHT;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    if (state.terrain.isSolid(x + Math.cos(a) * JET_BODY_RADIUS, cy + Math.sin(a) * JET_BODY_RADIUS)) return true;
  }
  return tankBodies(state).some((q) => !(q.owner === self && !q.twin) && Math.hypot(q.x - x, q.y - y) < TANK_HALF_WIDTH * 2);
}

/** Charge, launch, fly, land. Returns true once the tank has landed. */
function stepJet(state: GameState, j: Jet, dt: number): boolean {
  const p = state.players[j.playerId]!;
  const spec = getWeapon(j.weaponId).jetpack!;
  const { terrain } = state;
  j.elapsed += dt;

  if (!j.launched) {
    if (j.elapsed < spec.chargeTime) {
      // Dust shaken loose, more and more as the charge builds.
      const k = j.elapsed / spec.chargeTime;
      if (hash(j.elapsed * 97.13) < k * k * 0.6) spawnDust(state, p.x, p.y, k);
      return false;
    }
    const a = (p.angle * Math.PI) / 180;
    const speed = (p.power / 100) * MAX_SPEED * spec.thrust;
    j.vx = Math.cos(a) * speed;
    j.vy = -Math.sin(a) * speed;
    j.heading = a;
    j.launched = true;
    j.burnLeft = spec.burnTime;
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
    const other = tankBodies(state).find((q) => !(q.owner === p && !q.twin) && Math.abs(q.x - p.x) < TANK_HALF_WIDTH * 2);
    if (!other) break;
    const dir = p.x >= other.x ? 1 : -1;
    const nx = p.x + dir;
    p.x = nx < TANK_HALF_WIDTH || nx > terrain.width - TANK_HALF_WIDTH ? p.x - dir * 2 * TANK_HALF_WIDTH : nx;
  }
  p.x = Math.round(p.x);
  // Rest on the highest supporting column under the hull.
  let ground = terrain.height;
  const top = Math.max(0, p.y - TANK_BODY_HEIGHT * 2);
  for (let dx = -TANK_HALF_WIDTH + 2; dx <= TANK_HALF_WIDTH - 2; dx += 2) {
    ground = Math.min(ground, terrain.groundBelow(p.x + dx, top));
  }
  p.y = ground;
  spawnDust(state, p.x, p.y, 1);
}

// ---- Cook debuff, bursts, naps --------------------------------------------------------------------

/** Damage multiplier for everything a player fires: halved (etc.) while they're cooked. */
export function offence(state: GameState, playerId: number): number {
  const c = state.players[playerId]?.cooked;
  return c?.active ? c.multiplier : 1;
}

/** Scale a hit by the shooter's offence and round it (a real hit never rounds down to 0). */
function scaled(state: GameState, shooterId: number, amount: number): number {
  if (Math.round(amount) <= 0) return 0;
  return Math.max(1, Math.round(amount * offence(state, shooterId)));
}

/** Fire the next rounds of a burst as their time comes. Returns true once all are away. */
function stepBurst(state: GameState, b: Burst, dt: number): boolean {
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
    spawnProjectile(state, p, weapon, m.x, m.y, Math.cos(a) * speed, -Math.sin(a) * speed);
    if (b.word) {
      const pr = state.projectiles[state.projectiles.length - 1]!;
      pr.glyph = b.word[b.fired]!;
      pr.glyphColour = b.wordColour;
    }
    b.fired++;
  }
  return b.fired >= count;
}

/** Doze, with z's drifting up, then wake at full health. Returns true once awake. */
function stepNap(state: GameState, n: Nap, dt: number): boolean {
  const p = state.players[n.playerId]!;
  const spec = getWeapon(n.weaponId).heal!;
  n.elapsed += dt;
  n.nextZ -= dt;
  if (n.nextZ <= 0 && n.elapsed < spec.napTime - 0.3) {
    const c = tankCentre(p);
    spawnFloater(state, c.x + 6, c.y - 4, n.elapsed < spec.napTime / 2 ? 'z' : 'Z', '#cfe3ff');
    n.nextZ = 0.45;
  }
  if (n.elapsed < spec.napTime) return false;
  if (p.alive && p.hp < MAX_HP) {
    const gained = MAX_HP - p.hp;
    p.hp = MAX_HP;
    const c = tankCentre(p);
    spawnFloater(state, c.x, c.y, `+${gained}`, '#7ee7a8');
  }
  return true;
}

// ---- Sew -----------------------------------------------------------------------------------------

/** The needle's position after sewing `t` px: along the aim, zig-zagging either side of the line. */
export function stitchPoint(st: Stitch, amplitude: number, wavelength: number, t: number): { x: number; y: number } {
  const zig = Math.sin((t / wavelength) * Math.PI * 2) * amplitude; // weaving in and out, like running stitches
  const ux = Math.cos(st.angle);
  const uy = -Math.sin(st.angle);
  return { x: st.x0 + ux * t - uy * zig, y: st.y0 + uy * t + ux * zig };
}

/**
 * Sew along the line through anything, stitching (damaging and pinning) each enemy it passes through
 * and leaving stitch marks in the soil. The thread lingers a moment after. Returns true when finished.
 */
function stepStitch(state: GameState, st: Stitch, dt: number): boolean {
  const weapon = getWeapon(st.weaponId);
  const spec = weapon.sew!;
  const { terrain } = state;
  if (st.done) {
    st.linger -= dt;
    return st.linger <= 0;
  }
  const to = Math.min(st.range, st.travelled + spec.speed * dt);
  for (let t = st.travelled + 1; t <= to; t += 1) {
    const pt = stitchPoint(st, spec.amplitude, spec.wavelength, t);
    if (pt.x < -20 || pt.x > terrain.width + 20 || pt.y < -200 || pt.y > terrain.height + 20) {
      st.done = true;
      break;
    }
    if (Math.round(t) % 3 === 0 && terrain.isSolid(pt.x, pt.y)) terrain.wetCircle(pt.x, pt.y, 1.3, [244, 114, 182]);
    const target = targetAt(state, pt.x, pt.y);
    if (target && targetOwner(target) !== st.ownerId && !st.hits.includes(targetKey(target))) {
      st.hits.push(targetKey(target));
      damageTarget(state, target, scaled(state, st.ownerId, spec.damage), st.ownerId, weapon.colour);
      if (target.kind !== 'hologram' && target.player.alive) {
        target.player.pinned = { active: false };
        const c = targetPos(target);
        spawnFloater(state, c.x, c.y - TANK_BODY_HEIGHT - 10, 'PINNED', weapon.colour ?? '#f472b6');
      }
    }
    if (Math.round(t) % 4 === 0) st.path.push(pt);
  }
  st.travelled = to;
  if (st.travelled >= st.range) st.done = true;
  return false;
}

// ---- Marathon ------------------------------------------------------------------------------------

/** Run the current leg towards the nearest enemy, over any hill. Returns true once it's finished. */
function stepRunner(state: GameState, r: Runner, dt: number): boolean {
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
      const finish: WeaponDef = { id: r.weaponId, name: 'Marathon', shortName: 'Marathon', blastRadius: spec.radius, damage: spec.damage };
      r.out = true; // it's done: don't DNF itself in its own blast
      // Full force at the finish line: the blast goes off right on the tank it reached.
      const at = targetPos(hit);
      explode(state, at.x, at.y - TANK_BODY_HEIGHT, finish, r.ownerId);
      spawnFloater(state, r.x, r.y - 30, 'FINISH!', '#f472b6');
      return true;
    }
  }
  if (r.legLeft < 0) r.legLeft = 0;
  return false;
}

// ---- Sonic ---------------------------------------------------------------------------------------

/** Radius of each wave of a boom right now (negative = not emitted yet). */
export function boomRadii(b: Boom): number[] {
  const spec = getWeapon(b.weaponId).sonic!;
  return b.hits.map((_, k) => (b.elapsed - k * spec.interval) * spec.speed);
}

/**
 * Advance a boom's waves. Each wave hits each target (tank or hologram, never the owner's) once, as
 * its front sweeps past, if the target is inside the arc. Terrain doesn't stop it. Returns true once
 * the last wave has reached full range.
 */
function stepBoom(state: GameState, b: Boom, dt: number): boolean {
  const spec = getWeapon(b.weaponId).sonic!;
  b.elapsed += dt;
  const radii = boomRadii(b);
  // Twins: another boom from the same player at the same time. Where their arcs cross, the waves
  // phase together: more range and focused damage.
  const siblings = state.booms.filter((o) => o !== b && o.ownerId === b.ownerId);
  for (const t of allTargets(state)) {
    if (gone(t) || targetOwner(t) === b.ownerId) continue;
    const pos = targetPos(t);
    const tx = pos.x;
    const ty = pos.y - TANK_BODY_HEIGHT;
    const d = Math.hypot(tx - b.x, ty - b.y);
    if (!inArc(b, spec, tx, ty)) continue;
    const phased = siblings.some((o) => inArc(o, spec, tx, ty) && Math.hypot(tx - o.x, ty - o.y) <= o.range * PHASE_RANGE);
    if (d > b.range * (phased ? PHASE_RANGE : 1)) continue;
    const key = targetKey(t);
    radii.forEach((r, k) => {
      if (r < d - TANK_HIT_RADIUS || b.hits[k]!.includes(key)) return;
      b.hits[k]!.push(key);
      const falloff = Math.min(1, spec.refDistance / Math.max(d, 1));
      const dmg = scaled(state, b.ownerId, spec.damage * falloff * (phased ? PHASE_FOCUS : 1));
      damageTarget(state, t, dmg, b.ownerId, phased ? '#ffffff' : (getWeapon(b.weaponId).colour ?? '#c9b6ff'));
    });
  }
  return radii[radii.length - 1]! >= b.range * (siblings.length > 0 ? PHASE_RANGE : 1);
}

/** Crossing waves from twin booms reach this much further… */
export const PHASE_RANGE = 1.5;
/** …and hit this much harder. */
export const PHASE_FOCUS = 1.5;

/** Whether (x, y) is inside a boom's arc (allowing for the width of a hull). */
function inArc(b: Boom, spec: { halfAngleDeg: number }, x: number, y: number): boolean {
  const dx = x - b.x;
  const dy = -(y - b.y);
  const d = Math.hypot(dx, dy);
  let off = Math.atan2(dy, dx) - b.angle;
  off = Math.atan2(Math.sin(off), Math.cos(off));
  return Math.abs(off) <= (spec.halfAngleDeg * Math.PI) / 180 + Math.atan2(TANK_HIT_RADIUS, Math.max(d, 1));
}

/**
 * The phased stretches of each twin boom's waves (cosmetic): runs of arc that pass through the
 * region the other boom's arc also covers, out to the phased range. Angles are canvas radians.
 */
export function boomPhaseArcs(state: GameState): { x: number; y: number; r: number; from: number; to: number; fade: number }[] {
  const out: { x: number; y: number; r: number; from: number; to: number; fade: number }[] = [];
  const SAMPLES = 24;
  for (const b of state.booms) {
    const siblings = state.booms.filter((o) => o !== b && o.ownerId === b.ownerId);
    if (siblings.length === 0) continue;
    const spec = getWeapon(b.weaponId).sonic!;
    const half = (spec.halfAngleDeg * Math.PI) / 180;
    const maxR = b.range * PHASE_RANGE;
    for (const r of boomRadii(b)) {
      if (r <= 2 || r > maxR) continue;
      let runStart: number | null = null;
      for (let i = 0; i <= SAMPLES; i++) {
        const a = b.angle - half + (2 * half * i) / SAMPLES; // maths angle
        const x = b.x + Math.cos(a) * r;
        const y = b.y - Math.sin(a) * r;
        const inside = siblings.some((o) => inArc(o, spec, x, y) && Math.hypot(x - o.x, y - o.y) <= o.range * PHASE_RANGE);
        if (inside && runStart === null) runStart = a;
        if ((!inside || i === SAMPLES) && runStart !== null) {
          const end = inside ? a : a - (2 * half) / SAMPLES;
          if (end > runStart) out.push({ x: b.x, y: b.y, r, from: -end, to: -runStart, fade: 1 - r / maxR });
          runStart = null;
        }
      }
    }
  }
  return out;
}

// ---- Spew ----------------------------------------------------------------------------------------

/** Gush chunks from the barrel for the spew's duration. Returns true once it has finished. */
function stepSpew(state: GameState, sp: Spew, dt: number): boolean {
  const p = state.players[sp.playerId]!;
  const spec = getWeapon(sp.weaponId).spew!;
  sp.elapsed += dt;
  sp.emitCarry += spec.chunksPerSecond * dt;
  const m = muzzle(p);
  while (sp.emitCarry >= 1) {
    sp.emitCarry -= 1;
    const a = ((p.angle + randRange(state.rng, -spec.spreadDeg, spec.spreadDeg)) * Math.PI) / 180;
    const v = (0.25 + 0.75 * (p.power / 100)) * spec.speed * randRange(state.rng, 0.75, 1.1);
    state.sludge.push({
      x: m.x,
      y: m.y,
      vx: Math.cos(a) * v,
      vy: -Math.sin(a) * v,
      ownerId: p.id,
      weaponId: sp.weaponId,
      look: hash(state.fxSeq++ * 1.618),
      age: 0,
    });
  }
  return sp.elapsed >= spec.duration;
}

/** True while a player's spew is gushing (for drawing). */
export function isSpewing(state: GameState, playerId: number): boolean {
  return state.spews.some((sp) => sp.playerId === playerId);
}

/**
 * Gunk ignores terrain for this long after leaving the nozzle. Otherwise a particle landing right at
 * the nozzle leaves a blob the next ones hit, and mud piles up in mid-air behind a flying tank.
 */
const GUNK_GRACE = 0.05;

/** Moves one gunk particle. Returns true when it has landed (as dirt) or hit a tank. */
function stepSludge(state: GameState, sl: Sludge, dt: number): boolean {
  const { terrain } = state;
  const spec = getWeapon(sl.weaponId).gunk!;
  sl.age += dt;
  sl.vy += GRAVITY * dt;
  const nx = sl.x + sl.vx * dt;
  const ny = sl.y + sl.vy * dt;
  const steps = Math.max(1, Math.ceil(Math.hypot(nx - sl.x, ny - sl.y)));
  let freeX = sl.x;
  let freeY = sl.y;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = sl.x + (nx - sl.x) * t;
    const y = sl.y + (ny - sl.y) * t;
    const target = targetAt(state, x, y);
    if (target && targetOwner(target) !== sl.ownerId) {
      const dose = spec.dosePerParticle * offence(state, sl.ownerId);
      const colour = getWeapon(sl.weaponId).colour ?? '#9be22d';
      if (target.kind === 'player') {
        target.player.toxin += dose;
        target.player.toxinRate = spec.dosePerSecond;
        target.player.soakColour = colour;
      } else {
        soakTarget(target, dose, colour, sl.ownerId);
      }
      return true;
    }
    if (!target && sl.age > GUNK_GRACE && terrain.isSolid(x, y)) {
      // Gunk slumps: slide down and off the top of piles before settling, so it builds mounds, not spikes.
      let mx = Math.round(freeX);
      let my = Math.round(freeY);
      // Blasted into the ground during its grace period? Surface first.
      for (let up = 0; up < 40 && terrain.isSolid(mx, my); up++) my--;
      // Look up to 3px either side for somewhere lower, so piles spread into low mounds, not towers.
      for (let k = 0; k < 40; k++) {
        if (!terrain.isSolid(mx, my + 1)) {
          my++;
          continue;
        }
        const side = hash(mx * 0.7 + my * 1.3 + k) < 0.5 ? 1 : -1;
        let slid = false;
        for (let d = 1; d <= 3 && !slid; d++) {
          for (const dir of [side, -side]) {
            if (!terrain.isSolid(mx + dir * d, my) && !terrain.isSolid(mx + dir * d, my + 1)) {
              mx += dir * d;
              my++;
              slid = true;
              break;
            }
          }
        }
        if (!slid) break;
      }
      // Gunk that lands on a tank's hull splatters off rather than burying it.
      const onHull = tankBodies(state).some(
        (q) => Math.abs(q.x - mx) < TANK_HALF_WIDTH + 2 && my <= q.y + 1 && my >= q.y - TANK_BODY_HEIGHT * 2 - 2,
      );
      if (!onHull) terrain.addDirt(mx, my - 0.5, spec.depositRadius, spec.deposit);
      if (spec.puddle) addPuddle(state, sl, mx, my, spec.puddle);
      return true;
    }
    freeX = x;
    freeY = y;
  }
  sl.x = nx;
  sl.y = ny;
  return sl.x < -50 || sl.x > terrain.width + 50;
}

/** Leave (or refresh) a patch of toxic sludge where a particle landed. */
function addPuddle(
  state: GameState,
  sl: Sludge,
  x: number,
  y: number,
  spec: { radius: number; linger: number },
): void {
  const near = state.puddles.find((p) => p.ownerId === sl.ownerId && Math.hypot(p.x - x, p.y - y) < spec.radius * 0.6);
  if (near) {
    near.age = 0; // fresh sludge keeps it going
    return;
  }
  state.puddles.push({ x, y, radius: spec.radius, ownerId: sl.ownerId, weaponId: sl.weaponId, age: 0, ttl: spec.linger });
}

/** Whether a tank resting with its feet at (x, y) is touching a puddle. */
function touchesPuddle(p: Puddle, x: number, y: number): boolean {
  return Math.abs(p.x - x) <= p.radius + TANK_HALF_WIDTH && Math.abs(p.y - y) <= p.radius + TANK_BODY_HEIGHT;
}

/** Burn enemies (and decoys) touching toxic sludge; puddles expire after lingering. */
function stepPuddles(state: GameState, dt: number): void {
  if (state.puddles.length === 0) return;
  for (const t of allTargets(state)) {
    const pos = targetPos(t);
    // One burn per sludge owner, however many patches the tank is sitting in.
    const burning = state.puddles.find((p) => p.ownerId !== targetOwner(t) && touchesPuddle(p, pos.x, pos.y));
    if (!burning) continue;
    const w = getWeapon(burning.weaponId);
    const amount = (w.gunk?.puddle?.damagePerSecond ?? 0) * dt * offence(state, burning.ownerId);
    soakTarget(t, amount, '#b6f04a', burning.ownerId);
  }
  for (const p of state.puddles) p.age += dt;
  state.puddles = state.puddles.filter((p) => p.age < p.ttl);
}

/** Toxin on a tank drains into (batched, trickling) damage over a couple of seconds. */
function drainToxin(state: GameState, dt: number): void {
  for (const p of state.players) {
    if (p.toxin <= 0) continue;
    const d = Math.min(p.toxin, p.toxinRate * dt);
    p.toxin = p.toxin - d < 1e-6 ? 0 : p.toxin - d;
    p.soak += d;
  }
}

function spawnDust(state: GameState, x: number, y: number, strength: number): void {
  const n = strength >= 1 ? 10 : 1;
  for (let i = 0; i < n; i++) {
    const h = hash(state.fxSeq++);
    state.splashes.push({
      x: x + (h - 0.5) * 24,
      y: y - 1,
      vx: (hash(h * 17) - 0.5) * 80 * (0.4 + strength),
      vy: -(20 + hash(h * 29) * 70) * (0.4 + strength),
      age: 0,
      life: 0.4 + hash(h * 5) * 0.3,
      colour: '#b08850',
    });
  }
}

/** Apply soaked-up stream damage in small batches so the numbers trickle rather than spam. */
function stepSoak(state: GameState, dt: number, final: boolean): void {
  state.soakTimer += dt;
  if (!final && state.soakTimer < SOAK_FLUSH_INTERVAL) return;
  state.soakTimer = 0;
  for (const p of state.players) {
    const whole = final ? Math.round(p.soak) : Math.floor(p.soak);
    if (whole > 0) damagePlayer(state, p, whole, p.soakColour);
    p.soak = final ? 0 : p.soak - whole;
  }
  for (const h of state.holograms) {
    const whole = final ? Math.round(h.soak) : Math.floor(h.soak);
    if (whole > 0) damageTarget(state, { kind: 'hologram', holo: h }, whole, h.soakShooterId, h.soakColour);
    h.soak = final ? 0 : h.soak - whole;
  }
  for (const p of state.players) {
    const tw = p.twin;
    if (!tw) continue;
    const whole = final ? Math.round(tw.soak) : Math.floor(tw.soak);
    tw.soak = final ? 0 : tw.soak - whole;
    if (whole > 0) damageTwin(state, p, whole, tw.soakColour);
  }
}

/** Cosmetic spray. Uses the fx counter, not the gameplay RNG, so visuals can't change outcomes. */
function spawnSplash(state: GameState, x: number, y: number, d: Droplet, count: number): void {
  for (let i = 0; i < count; i++) {
    const h = hash(state.fxSeq++);
    const back = -Math.sign(d.vx || 1) * (20 + h * 50);
    state.splashes.push({
      x,
      y: y - 1,
      vx: back * (0.3 + hash(h * 97) * 0.9) + (hash(h * 13) - 0.5) * 40,
      vy: -(40 + hash(h * 31) * 90) * (0.4 + d.pressure * 0.6),
      age: 0,
      life: 0.35 + hash(h * 7) * 0.3,
      colour: d.colour,
    });
  }
  if (state.splashes.length > MAX_SPLASHES) state.splashes.splice(0, state.splashes.length - MAX_SPLASHES);
}

function stepSplashes(state: GameState, dt: number): void {
  for (const sp of state.splashes) {
    sp.age += dt;
    sp.vy += GRAVITY * dt;
    sp.x += sp.vx * dt;
    sp.y += sp.vy * dt;
  }
  state.splashes = state.splashes.filter((sp) => sp.age < sp.life && !state.terrain.isSolid(sp.x, sp.y));
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mix a '#rrggbb' colour towards white by k (0–1), returned as '#rrggbb'. */
function tint(hex: string, k: number): string {
  const mix = (c: number) => Math.round(c + (255 - c) * k);
  return '#' + hexToRgb(hex).map((c) => mix(c).toString(16).padStart(2, '0')).join('');
}

/** Cheap deterministic 0–1 hash. */
function hash(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
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

/** The real tank, twin or hologram whose hit circle contains (x, y). */
export function targetAt(state: GameState, x: number, y: number): Target | undefined {
  for (const t of allTargets(state)) {
    const pos = targetPos(t);
    if (Math.hypot(x - pos.x, y - (pos.y - TANK_BODY_HEIGHT)) <= TANK_HIT_RADIUS) return t;
  }
  return undefined;
}

/** Where a target's hull rests (x centre, y = ground contact). */
export function targetPos(t: Target): { x: number; y: number } {
  return t.kind === 'player' ? t.player : t.kind === 'twin' ? t.player.twin! : t.holo;
}

/** A target that has left the field since the target list was taken (dead, or a twin promoted/destroyed). */
function gone(t: Target): boolean {
  return t.kind === 'hologram' ? false : !t.player.alive || (t.kind === 'twin' && !t.player.twin);
}

function targetOwner(t: Target): number {
  return t.kind === 'hologram' ? t.holo.ownerId : t.player.id;
}

function targetKey(t: Target): string {
  return t.kind === 'player' ? `p${t.player.id}` : t.kind === 'twin' ? `t${t.player.id}` : `h${t.holo.id}`;
}

function allTargets(state: GameState): Target[] {
  const alive = state.players.filter((p) => p.alive);
  return [
    ...alive.map((player): Target => ({ kind: 'player', player })),
    ...alive.filter((p) => p.twin).map((player): Target => ({ kind: 'twin', player })),
    ...state.holograms.filter((h) => state.players[h.ownerId]?.alive).map((holo): Target => ({ kind: 'hologram', holo })),
  ];
}

/** Every living tank body on the field (real tanks and twins), for collisions and spacing. */
function tankBodies(state: GameState): { x: number; y: number; owner: Player; twin: boolean }[] {
  const out: { x: number; y: number; owner: Player; twin: boolean }[] = [];
  for (const p of state.players) {
    if (!p.alive) continue;
    out.push({ x: p.x, y: p.y, owner: p, twin: false });
    if (p.twin) out.push({ x: p.twin.x, y: p.twin.y, owner: p, twin: true });
  }
  return out;
}

/** Add damage-over-time "soak" (water, mud, sludge) to any kind of target. */
function soakTarget(t: Target, amount: number, colour: string, shooterId: number): void {
  if (t.kind === 'player') {
    t.player.soak += amount;
    t.player.soakColour = colour;
  } else if (t.kind === 'twin') {
    t.player.twin!.soak += amount;
    t.player.twin!.soakColour = colour;
  } else {
    t.holo.soak += amount;
    t.holo.soakShooterId = shooterId;
    t.holo.soakColour = colour;
  }
}

/**
 * Real tanks and twins take the damage. Holograms put on a show (same floating number) and record it
 * against the shooter, who pays the penalty when the hologram is exposed at the end of the turn.
 */
function damageTarget(state: GameState, t: Target, amount: number, shooterId: number, colour = '#ffffff'): void {
  if (amount <= 0) return;
  if (t.kind === 'player') {
    damagePlayer(state, t.player, amount, colour);
  } else if (t.kind === 'twin') {
    damageTwin(state, t.player, amount, colour);
  } else {
    // A decoy of a tattooed tank shows the same boosted number, so it gives nothing away.
    const shown = vulnerable(state.players[t.holo.ownerId]!, amount);
    t.holo.hits.push({ shooterId, damage: shown });
    spawnFloater(state, t.holo.x, t.holo.y - TANK_BODY_HEIGHT, `-${shown}`, colour);
  }
}

function damageTwin(state: GameState, p: Player, amount: number, colour: string): void {
  const tw = p.twin;
  if (!tw || amount <= 0) return;
  amount = vulnerable(p, amount);
  tw.hp = Math.max(0, tw.hp - amount);
  spawnFloater(state, tw.x, tw.y - TANK_BODY_HEIGHT, `-${amount}`, colour);
  if (tw.hp === 0) {
    state.explosions.push({ x: tw.x, y: tw.y - TANK_BODY_HEIGHT, radius: 22, age: 0, duration: 0.5 });
    p.twin = null;
  }
}

export function explode(state: GameState, x: number, y: number, weapon: WeaponDef, ownerId?: number): void {
  const r = weapon.blastRadius;
  state.terrain.carveCircle(x, y, r);
  state.explosions.push({ x, y, radius: r, age: 0, duration: r < 15 ? 0.35 : 0.5 });

  const shooterId = ownerId ?? currentPlayer(state).id;
  for (const t of allTargets(state)) {
    if (gone(t)) continue; // e.g. a twin promoted by this very blast
    if (weapon.friendlyFire === false && targetOwner(t) === shooterId) continue;
    const pos = targetPos(t);
    const reach = r + TANK_HIT_RADIUS;
    const d = Math.hypot(pos.x - x, pos.y - TANK_BODY_HEIGHT - y);
    if (d >= reach) continue;
    damageTarget(state, t, scaled(state, shooterId, weapon.damage * (1 - d / reach)), shooterId);
    if (weapon.debuff && t.kind !== 'hologram' && t.player.alive) cook(state, t.player, weapon.debuff.offenceMultiplier);
    if (weapon.tattoo && t.kind !== 'hologram' && t.player.alive) {
      if (!t.player.tattoo) {
        const c = targetPos(t);
        spawnFloater(state, c.x, c.y - TANK_BODY_HEIGHT - 10, 'TATTOOED', '#b8c4ff');
      }
      t.player.tattoo = { multiplier: weapon.tattoo.multiplier, turnsLeft: weapon.tattoo.turns };
    }
  }
  // Any blast knocks out a marathon runner caught in it ("did not finish").
  for (const rn of state.runners) {
    if (rn.out || Math.hypot(rn.x - x, rn.y - 6 - y) >= r + 6) continue;
    rn.out = true;
    spawnFloater(state, rn.x, rn.y - 20, 'DNF', '#f472b6');
  }
  settleTanks(state);
}

/** The Rizzler's debuff: halves (etc.) everything this player fires on their next turn. */
function cook(state: GameState, p: Player, multiplier: number): void {
  p.cooked = { active: false, multiplier };
  const c = tankCentre(p);
  spawnFloater(state, c.x, c.y - 10, 'COOKED', '#ff9f43');
}

/** Every source of damage goes through here so it always gets a floating number. */
/** Tattooed tanks take extra damage from everything. */
function vulnerable(p: Player, amount: number): number {
  return p.tattoo ? Math.round(amount * p.tattoo.multiplier) : amount;
}

export function damagePlayer(state: GameState, p: Player, amount: number, colour = '#ffffff'): void {
  if (amount <= 0 || !p.alive) return;
  amount = vulnerable(p, amount);
  p.hp = Math.max(0, p.hp - amount);
  const c = tankCentre(p);
  spawnFloater(state, c.x, c.y, `-${amount}`, colour);
  if (p.hp > 0) return;
  if (p.twin) {
    // The main tank is destroyed, but the twin carries on as the player's tank.
    state.explosions.push({ x: c.x, y: c.y, radius: 22, age: 0, duration: 0.5 });
    const tw = p.twin;
    p.x = tw.x;
    p.y = tw.y;
    p.hp = tw.hp;
    p.soak += tw.soak;
    p.twin = null;
    return;
  }
  p.alive = false;
}

function spawnFloater(state: GameState, x: number, y: number, text: string, colour: string): void {
  const c = { x, y };
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

/** Drop tanks (and holograms) onto whatever ground is left beneath them. */
function settleTanks(state: GameState): void {
  const { terrain } = state;
  const twins = state.players.flatMap((p) => (p.twin ? [p.twin] : []));
  for (const t of [...state.players, ...state.holograms, ...twins]) {
    let ground = terrain.height;
    for (let dx = -TANK_HALF_WIDTH + 2; dx <= TANK_HALF_WIDTH - 2; dx += 2) {
      ground = Math.min(ground, terrain.groundBelow(t.x + dx, t.y));
    }
    t.y = ground;
  }
}

/**
 * End-of-turn hologram business: expose any hologram that was hit (the shooter pays
 * HOLOGRAM_PENALTY of what they'd have dealt), then carry out the current player's secret swap.
 */
function resolveHolograms(state: GameState): void {
  const exposed = state.holograms.filter((h) => h.hits.length > 0 || !state.players[h.ownerId]?.alive);
  for (const h of exposed) {
    if (!state.players[h.ownerId]?.alive) continue;
    const byShooter = new Map<number, number>();
    for (const hit of h.hits) byShooter.set(hit.shooterId, (byShooter.get(hit.shooterId) ?? 0) + hit.damage);
    for (const [shooterId, dealt] of byShooter) {
      const shooter = state.players[shooterId];
      if (shooter) damagePlayer(state, shooter, Math.max(1, Math.round(dealt * HOLOGRAM_PENALTY)), HOLOGRAM_COLOUR);
    }
    ring(state, h.x, h.y - TANK_BODY_HEIGHT, HOLOGRAM_COLOUR);
    state.ghosts.push({ ownerId: h.ownerId, x: h.x, y: h.y, age: 0, duration: GHOST_DURATION });
  }
  state.holograms = state.holograms.filter((h) => !exposed.includes(h));

  const me = currentPlayer(state);
  const target = state.holograms.find((h) => h.id === state.swapTargetId && h.ownerId === me.id);
  if (target && me.alive) {
    [me.x, target.x] = [target.x, me.x];
    [me.y, target.y] = [target.y, me.y];
  }
  state.swapTargetId = null;
  // Every one of my copies shimmers at the end of my turn, swap or no swap, so it gives nothing away.
  if (me.alive && state.holograms.some((h) => h.ownerId === me.id)) shimmer(state, me.id);
}

function endTurn(state: GameState): void {
  // A cook lasts exactly one of the victim's turns.
  const ending = currentPlayer(state);
  if (ending.cooked?.active) ending.cooked = null;
  if (ending.pinned?.active) ending.pinned = null;
  if (ending.tattoo && --ending.tattoo.turnsLeft <= 0) ending.tattoo = null;
  resolveHolograms(state);
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
    const total = (p: Player) => p.hp + (p.twin?.hp ?? 0);
    const best = Math.max(...alive.map(total));
    const leaders = alive.filter((p) => total(p) === best);
    state.phase = 'gameover';
    state.winner = leaders.length === 1 ? leaders[0]! : null;
    return;
  }
  state.current = next;
  state.turn++;
  state.phase = 'aiming';
  const up = state.players[next]!;
  if (up.cooked) up.cooked.active = true;
  if (up.pinned) up.pinned.active = true;
}

function tickBurn(state: GameState, p: Player): void {
  if (!p.burn) return;
  const { damagePerTurn, colour } = p.burn;
  p.burn.turnsLeft--;
  if (p.burn.turnsLeft <= 0) p.burn = null;
  damagePlayer(state, p, damagePerTurn, colour);
}

/** Aim wraps all the way round: any angle maps to [0, 360). 0 = right, 90 = up, 270 = straight down. */
export function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

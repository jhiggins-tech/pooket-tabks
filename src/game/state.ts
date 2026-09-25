import type { Rng } from '../core/rng';
import type { Terrain } from '../core/terrain';

export interface PlayerConfig {
  name: string;
  colour: string;
  characterId: string;
}

export interface Player {
  id: number;
  name: string;
  colour: string;
  /** Centre x of the tank. */
  x: number;
  /** Ground contact y (bottom of the tank). */
  y: number;
  hp: number;
  /** Degrees: 0 = right, 90 = straight up, 180 = left. */
  angle: number;
  /** 0–100. */
  power: number;
  alive: boolean;
  characterId: string;
  /** Weapon ids by tier (index 0 = tier 1). */
  loadout: string[];
  /** Rounds left per tier. */
  ammo: number[];
  selectedTier: number;
  /** Active burn from a beam hit: ticks at the start of this player's next turns. */
  burn: { damagePerTurn: number; turnsLeft: number; colour: string } | null;
  /** Fractional stream damage soaked up but not yet applied (applied in small batches). */
  soak: number;
}

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  weaponId: string;
  ownerId: number;
  trail: { x: number; y: number }[];
  /** Ground bounces so far. */
  bounces: number;
  /** Seconds in flight (stray projectiles detonate after a while). */
  age: number;
}

export interface Beam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  colour: string;
  hitTank: boolean;
  age: number;
  duration: number;
}

/** A liquid jet in progress (emits droplets while its pressure profile runs). */
export interface Stream {
  id: number;
  weaponId: string;
  ownerId: number;
  x: number;
  y: number;
  /** Degrees, as Player.angle. */
  angle: number;
  /** Launch speed at full pressure (px/s). */
  fullSpeed: number;
  elapsed: number;
  /** Fractional droplets owed from the flow rate. */
  emitCarry: number;
  colour: string;
}

export interface Droplet {
  streamId: number;
  weaponId: string;
  ownerId: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Pressure when emitted (0–1): drives how thick the jet is drawn. */
  pressure: number;
  colour: string;
}

/** Cosmetic spray where water lands. */
export interface Splash {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  colour: string;
}

/** Floating damage number drifting up and away from a tank. */
export interface Floater {
  x: number;
  y: number;
  vx: number;
  vy: number;
  text: string;
  colour: string;
  age: number;
  duration: number;
}

export interface Explosion {
  x: number;
  y: number;
  radius: number;
  age: number;
  duration: number;
}

export type Phase = 'aiming' | 'flying' | 'settling' | 'gameover';

export interface GameState {
  seed: number;
  terrain: Terrain;
  players: Player[];
  current: number;
  turn: number;
  phase: Phase;
  projectiles: Projectile[];
  beams: Beam[];
  streams: Stream[];
  droplets: Droplet[];
  splashes: Splash[];
  /** Seconds since stream damage was last applied. */
  soakTimer: number;
  explosions: Explosion[];
  floaters: Floater[];
  /** Seeded gameplay randomness (e.g. where rain falls), continuing from terrain generation. */
  rng: Rng;
  /** Counter for cosmetic variation that must not consume gameplay randomness. */
  fxSeq: number;
  settleTimer: number;
  winner: Player | null;
}

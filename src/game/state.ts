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
  explosions: Explosion[];
  floaters: Floater[];
  /** Seeded gameplay randomness (e.g. where rain falls), continuing from terrain generation. */
  rng: Rng;
  /** Counter for cosmetic variation that must not consume gameplay randomness. */
  fxSeq: number;
  settleTimer: number;
  winner: Player | null;
}

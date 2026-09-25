import type { Terrain } from '../core/terrain';

export interface PlayerConfig {
  name: string;
  colour: string;
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
}

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  weaponId: string;
  ownerId: number;
  trail: { x: number; y: number }[];
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
  weaponId: string;
  projectiles: Projectile[];
  explosions: Explosion[];
  settleTimer: number;
  winner: Player | null;
}

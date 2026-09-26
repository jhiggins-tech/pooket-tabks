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
  /** Degrees in [0, 360): 0 = right, 90 = straight up, 180 = left, 270 = straight down. */
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
  /** Colour for the soak damage numbers (the liquid's colour). */
  soakColour: string;
  /**
   * The Rizzler's "cook" debuff: pending until this player's next turn starts, active during that turn
   * (everything they fire deals `multiplier` × damage), then gone.
   */
  cooked: { active: boolean; multiplier: number } | null;
  /** Tattooed: takes `multiplier` × damage from everything until it has had `turnsLeft` more turns. */
  tattoo: { multiplier: number; turnsLeft: number } | null;
  /** Pinned by Sew: pending until this player's next turn starts, when they can't drive or hop; then gone. */
  pinned: { active: boolean } | null;
  /** A frog hop in progress (ciarra's movement). */
  hop: Hop | null;
  /** A second tank (torikloud's Twins): its own position and health bar, mirroring this player's shots. */
  twin: Twin | null;
  /** px of driving left for the rest of the match. */
  fuel: number;
  /** Toxin still to drain into damage (from jetpack propellant), and its colour. */
  toxin: number;
  toxinRate: number;
}

/** One frog hop: a little parabolic leap from (x0, y0) to (x1, y1). */
export interface Hop {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 0 → 1 through the hop. */
  t: number;
}

/** Sew in progress: a needle zig-zagging along a line, trailing thread. */
export interface Stitch {
  ownerId: number;
  weaponId: string;
  x0: number;
  y0: number;
  /** Radians, maths convention. */
  angle: number;
  range: number;
  /** px sewn so far along the line. */
  travelled: number;
  /** Where the needle has been (for drawing the thread). */
  path: { x: number; y: number }[];
  /** Target keys already stitched. */
  hits: string[];
  /** Seconds the thread lingers after the needle stops (then it's removed). */
  linger: number;
  done: boolean;
}

/** A marathon runner, jogging a leg at a time towards the nearest enemy, across turns. */
export interface Runner {
  ownerId: number;
  weaponId: string;
  x: number;
  y: number;
  /** −1 / +1: which way it's facing. */
  dir: number;
  /** px left to run in the current leg. */
  legLeft: number;
  /** Total px run (for the running animation). */
  distance: number;
  /** Knocked out by a blast (removed on its next step). */
  out: boolean;
}

/** A player's second tank. */
export interface Twin {
  x: number;
  y: number;
  hp: number;
  /** Fractional damage soaked (water, mud, sludge) not yet applied. */
  soak: number;
  soakColour: string;
  /** Seconds since it appeared (cosmetic phase-in). */
  age: number;
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
  /** Walkers: −1 / +1 while walking along the ground, 0 while airborne. */
  walkDir: number;
  /** Walkers: seconds spent walking so far (they pop when it reaches the weapon's walk duration). */
  walkTime: number;
  /** Word fire: the letter this round is, and its colour. */
  glyph?: string;
  glyphColour?: string;
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

/**
 * A hologram copy of a player's tank. Drawn identically to the real tank and hit-tested like one.
 * Damage it "takes" is recorded against whoever dealt it; they pay half at the end of the turn.
 */
export interface Hologram {
  id: number;
  ownerId: number;
  x: number;
  y: number;
  /** Would-be damage dealt to this hologram this turn, by shooter. */
  hits: { shooterId: number; damage: number }[];
  /** Fractional stream damage soaked this turn, and who is spraying it. */
  soak: number;
  soakShooterId: number;
  soakColour: string;
  /** Seconds since it phased in (cosmetic: drives the materialise animation). */
  age: number;
}

/** Cosmetic: a player's tanks (real and holograms) all glitch together, e.g. to hide a swap. */
export interface PhaseShimmer {
  ownerId: number;
  age: number;
  duration: number;
}

/** Cosmetic: an exposed hologram dissolving where it stood. */
export interface HologramGhost {
  ownerId: number;
  x: number;
  y: number;
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
  /** Shapes this stream's uneven surges (from the gameplay RNG, so replays match). */
  seed: number;
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

/** A tank charging up and then flying under its own one-off thrust. */
export interface Jet {
  playerId: number;
  weaponId: string;
  /** Seconds since firing (charge counts from 0 to chargeTime). */
  elapsed: number;
  launched: boolean;
  vx: number;
  vy: number;
  /** Seconds of exhaust left after launch. */
  burnLeft: number;
  emitCarry: number;
  /** Seconds in the air. */
  flightTime: number;
  /** Launch direction (radians), for drawing the flame. */
  heading: number;
}

/** A series of rounds being fired one after another (Pill Pusher). */
export interface Burst {
  playerId: number;
  weaponId: string;
  /** Which of the player's tanks it fires from. */
  origin: 'main' | 'twin';
  angle: number;
  power: number;
  fired: number;
  elapsed: number;
  /** Word fire: the word being fired, one letter per round (null for plain bursts). */
  word: string | null;
  wordColour: string;
}

/** A player napping (Take a Nap); wakes at full health. */
export interface Nap {
  playerId: number;
  weaponId: string;
  elapsed: number;
  /** Seconds until the next "z" floats up (cosmetic). */
  nextZ: number;
}

/** A spew weapon gushing from a player's barrel. */
export interface Spew {
  playerId: number;
  weaponId: string;
  elapsed: number;
  emitCarry: number;
}

/** Gunk (jetpack mud, spew chunks): falls, piles up as dirt, doses enemies it lands on. */
export interface Sludge {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ownerId: number;
  weaponId: string;
  /** Cosmetic 0–1 variety (clump size and shade); never affects gameplay. */
  look: number;
  /** Seconds since it left the nozzle. */
  age: number;
}

/** Sonic waves in progress: arcs expanding from `x, y` along `angle`. */
export interface Boom {
  ownerId: number;
  weaponId: string;
  x: number;
  y: number;
  /** Radians, maths convention (0 = right, π/2 = up). */
  angle: number;
  range: number;
  elapsed: number;
  /** Target keys already hit, per wave. */
  hits: string[][];
}

/** Cosmetic: something appearing in the sky (e.g. torikloud's kookaburra). */
export interface Apparition {
  kind: 'kookaburra';
  x: number;
  y: number;
  age: number;
  duration: number;
}

/** A patch of toxic sludge on the ground (ten-3). Burns enemies touching it until it expires. */
export interface Puddle {
  x: number;
  y: number;
  radius: number;
  ownerId: number;
  weaponId: string;
  age: number;
  /** Seconds it stays toxic. */
  ttl: number;
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
  /** Cosmetic ring (e.g. holograms appearing / vanishing) instead of a fireball. */
  ring?: string;
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
  holograms: Hologram[];
  /** Hologram the current player will swap with once their shot has resolved. */
  swapTargetId: number | null;
  shimmers: PhaseShimmer[];
  ghosts: HologramGhost[];
  streams: Stream[];
  jets: Jet[];
  spews: Spew[];
  stitches: Stitch[];
  runners: Runner[];
  bursts: Burst[];
  naps: Nap[];
  booms: Boom[];
  apparitions: Apparition[];
  sludge: Sludge[];
  puddles: Puddle[];
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

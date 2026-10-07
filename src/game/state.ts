import type { Rng } from '../core/rng';
import type { Terrain } from '../core/terrain';

/**
 * The shape of a match: players, everything in flight, and the turn state. Plain data (apart from the
 * terrain and RNG), so a snapshot of it can be sent to the other phone or a spectator as is.
 */

export interface PlayerConfig {
  name: string;
  colour: string;
  characterId: string;
  /** Online, signed in with Google: their stats key, for their rank (ui/ranks.ts). Never read by the game. */
  key?: string;
}

/**
 * What each of a player's tanks has of its own: where it is, its health, and what's eating at it (a burn,
 * soaked-up damage, toxin). The main tank is the `Player` itself; torikloud's second tank is a `Twin`.
 * Everything else about a player (statuses like cooked or tattooed, ammo, fuel) is the player's.
 */
export interface TankBody {
  /** Centre x of the tank. */
  x: number;
  /** Ground contact y (bottom of the tank). */
  y: number;
  hp: number;
  /** Hyperfixate's burn on this tank: ticks at every turn change, whoever's turn it is (game.ts `endTurn`). */
  burn: Burn | null;
  /** Fractional damage soaked up (water, mud, sludge) but not yet applied (applied in small batches). */
  soak: number;
  /** Colour for the soak damage numbers (the liquid's colour). */
  soakColour: string;
  /** Toxin still to drain into damage (from jetpack propellant and spew), and how fast. */
  toxin: number;
  toxinRate: number;
}

export interface Player extends TankBody {
  id: number;
  name: string;
  colour: string;
  /** Full health (the character's: MAX_HP, or more). */
  maxHp: number;
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
  /** A second tank (torikloud's Twins): its own position, health bar and aim; it fires ballistic and sonic shots too (mechanics.ts `FIRE`). */
  twin: Twin | null;
  /** Aiming the twin (its own angle and power) rather than the main tank, while there is one. */
  aimTwin: boolean;
  /** Where the twin will appear (x), as placed by tapping while Twins is selected (null: the suggested spot). */
  twinSpot: number | null;
  /** px of driving left for the rest of the match. */
  fuel: number;
  /** Women in Scam in play: until the end of the next enemy turn; `loot` is the weapon of the first enemy hit on this tank. */
  scam: { loot: string | null } | null;
  /** Diced Coffee: the chance it fails next time, and the turn it was last drunk (it's once a turn). Null: never drunk. */
  coffee: { failChance: number; turn: number } | null;
  /** Diced Coffee won this turn: when it ends, this player goes again (the next enemy turn is skipped). */
  extraTurn: boolean;
  /** garyoldmancorp's scooter crashed going this way (−1 / +1) and hasn't moved since (0: no crash to remember). */
  scooterCrash: number;
}

/** Hyperfixate's burn on a tank (the main tank or a twin, whichever the beam hit). */
export interface Burn {
  damagePerTurn: number;
  turnsLeft: number;
  colour: string;
  /** Who lit it, and with what (for the stats: it ticks between turns, not during the shooter's shot). -1: not known. */
  by: number;
  weaponId: string;
}

/** One player's numbers for the stats (game/tally.ts): kept as the match goes, never read by the simulation. */
export interface PlayerTally {
  /** Shots fired that can do damage, by weapon id. */
  shots: Record<string, number>;
  /** Of those, the ones that touched an enemy tank or decoy. */
  hits: Record<string, number>;
  /** Damage done to enemy tanks, by weapon id ('other' when it can't be told). */
  dealt: Record<string, number>;
  /** Damage taken from enemies. */
  taken: number;
  /** Damage done to their own tanks. */
  self: number;
  kills: number;
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

/** A player's second tank (torikloud's Twins). */
export interface Twin extends TankBody {
  /** Seconds since it appeared (cosmetic phase-in). */
  age: number;
  /** Its own aim: degrees as Player.angle, and 0–100. */
  angle: number;
  power: number;
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
  /** Walkers: distance to the nearest enemy at the end of the last step (to tell when it's as close as it'll get). */
  fuseDist?: number;
  /** Which of the weapon's `spriteVariants` it looks like (its place in the burst or volley). Cosmetic. */
  variant?: number;
  /** Homing weapons: locked on to an enemy. */
  homing?: boolean;
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
 * A hologram copy of a player's tank. Drawn identically to the real tank and hit-tested like one. Once
 * hit (it shows the damage, like a real tank) it blows up: its weapon's `decoyBlast`.
 */
export interface Hologram {
  id: number;
  ownerId: number;
  /** The weapon that cast it (Trollogram). */
  weaponId: string;
  x: number;
  y: number;
  /** It's been hit: it blows up on the next tick (or at the end of the turn, if it's hit after the shot). */
  hit: boolean;
  /** Fractional stream damage soaked this turn. */
  soak: number;
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

/** Cosmetic: a hologram bursting apart as it blows up (shards, a flash, a shockwave). */
export interface HologramBlast {
  ownerId: number;
  x: number;
  y: number;
  radius: number;
  age: number;
  duration: number;
}

/** Cosmetic: a hologram dissolving where it stood (its owner is out). */
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
  /** Splashback: the enemy tank close enough to splash back (the nearest, if within reach when fired). */
  close: { playerId: number; twin: boolean } | null;
  /** Damage the stream has done to that tank so far. */
  dealt: number;
  /** When it splashed back (seconds into the stream), and the pressure then: it dies away from there. */
  splashAt: number | null;
  splashFrom: number;
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
  /** Launch along this angle and power instead of the player's aim (a spilt Diced Coffee goes straight up). */
  angle?: number;
  power?: number;
}

/** Which of a player's tanks a shot comes from: the main tank (the player itself), or torikloud's twin. */
export type Origin = 'main' | 'twin';

/** A series of rounds being fired one after another (Pill Pusher). */
export interface Burst {
  playerId: number;
  weaponId: string;
  /** Which of the player's tanks it fires from. */
  origin: Origin;
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
  /** Radius (px; default 1.4): a splashback's drops are big, and stay solid until they land. */
  size?: number;
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

/** Sound cues for the audio layer. Cosmetic only: the game never reads them back. */
export type SfxCue =
  | 'fire'
  | 'round'
  | 'boom'
  | 'hit'
  | 'launch'
  | 'wake'
  | 'pin'
  | 'tattoo'
  | 'cook'
  | 'finish'
  | 'dnf'
  | 'leg'
  | 'hop'
  | 'tick'
  | 'stolen'
  | 'nothing'
  | 'busted'
  | 'holo-boom'
  | 'kookaburra'
  | 'tune'
  | 'tune-end'
  | 'refund'
  | 'scammed'
  | 'lock-on'
  | 'splashback'
  | 'yolk'
  | 'slurp'
  | 'spill'
  | 'scoot'
  | 'crash'
  | 'gameover';

export interface Sfx {
  cue: SfxCue;
  /** The weapon behind it, if any (fire and round sounds are per weapon). */
  weaponId?: string;
  /** Cue-specific size: blast radius for `boom`, damage for `hit`, power for `fire`. */
  size?: number;
}

/**
 * `stealing`: kie's Steal roulette is spinning; `coffee`: the Diced Coffee spinner is spinning, then
 * the drink (or the spill) plays out. Either way the turn carries on (back to `aiming`) afterwards.
 */
export type Phase = 'aiming' | 'stealing' | 'coffee' | 'flying' | 'settling' | 'gameover';

/**
 * Diced Coffee's spinner: a wheel with a full cream slice (the chance it fails) and a lactose free one,
 * spinning to a stop under the pointer. The result is decided up front (seeded); the spin is the suspense.
 */
export interface CoffeeSpin {
  playerId: number;
  tier: number;
  weaponId: string;
  /** The full cream slice: the chance it fails, as it was when spun. */
  failChance: number;
  fail: boolean;
  /** Where the pointer ends up, as a fraction of the way round the wheel (full cream is 0 to `failChance`). */
  stop: number;
  t: number;
  /** Set once the wheel has stopped and the result has taken effect. */
  landed: boolean;
}

/**
 * kie's Steal: a slot-machine roulette over the victim's weapons that slows down and lands on the one
 * being stolen. The result is decided up front (seeded); the roulette is the suspense.
 */
export interface Heist {
  thiefId: number;
  thiefTier: number;
  victimId: number;
  victimTier: number;
  /** The victim's weapon ids by tier, as shown on the roulette. */
  options: string[];
  /** Roulette highlight: `sequence[i]` (a tier) is lit from `times[i]` s on; the last one is stolen. */
  sequence: number[];
  times: number[];
  t: number;
  /** Set once the roulette has landed and the round has changed hands. */
  locked: boolean;
}

/** Cosmetic effects: they only age and are drawn. */
export interface Fx {
  explosions: Explosion[];
  floaters: Floater[];
  splashes: Splash[];
  shimmers: PhaseShimmer[];
  ghosts: HologramGhost[];
  holoBlasts: HologramBlast[];
  apparitions: Apparition[];
}

export interface GameState {
  seed: number;
  terrain: Terrain;
  players: Player[];
  current: number;
  turn: number;
  phase: Phase;
  /** kie's Steal roulette, while it spins. */
  heist: Heist | null;
  /** Diced Coffee's spinner, while it spins and the drink (or spill) plays out. */
  coffee: CoffeeSpin | null;
  /** Sound cues since the audio layer last drained them (capped). */
  sfx: Sfx[];
  /** Weapons whose walker chiptune is playing (cosmetic). */
  tunes: string[];
  /** A refund-on-miss round in play this turn: whose, from which tier, and whether it hit anyone yet. */
  refund: { playerId: number; tier: number; hit: boolean } | null;
  /** The shot fired this turn (not a bonus move): who fired it and what with. */
  lastShot: { playerId: number; weaponId: string } | null;
  /** Each player's numbers for the stats, by player id (game/tally.ts). */
  tally: PlayerTally[];
  /** The shot in play, as the stats count it (one that can do damage), and whether it's hit anything yet. */
  tallyShot: { playerId: number; weaponId: string; hit: boolean } | null;
  projectiles: Projectile[];
  beams: Beam[];
  holograms: Hologram[];
  /** Hologram the current player will swap with once their shot has resolved. */
  swapTargetId: number | null;
  /** Seconds left to pick a decoy to swap with on the turn Trollogram is cast (0: no window open). */
  decoyPick: number;
  streams: Stream[];
  jets: Jet[];
  spews: Spew[];
  stitches: Stitch[];
  runners: Runner[];
  bursts: Burst[];
  naps: Nap[];
  booms: Boom[];
  sludge: Sludge[];
  puddles: Puddle[];
  droplets: Droplet[];
  /** Seconds since stream damage was last applied. */
  soakTimer: number;
  /** Cosmetic effects: never read by the simulation, and not in snapshots (each phone keeps its own). */
  fx: Fx;
  /** Seeded gameplay randomness (e.g. where rain falls), continuing from terrain generation. */
  rng: Rng;
  /** Ids for things in the game that need one (holograms, streams). */
  nextId: number;
  /** Counter for cosmetic variation that must not consume gameplay randomness. */
  fxSeq: number;
  settleTimer: number;
  winner: Player | null;
  /** Why the match ended early (online): the loser resigned, or ran out of time to move. */
  endReason: 'resigned' | 'timeout' | null;
}

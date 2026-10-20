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
  /** doctorfox's Arwing in the air (his movement): taking off, flying or landing. */
  flight: Flight | null;
  /** A second tank (torikloud's Twins): its own position, health bar and aim; it fires ballistic and sonic shots too (mechanics.ts `FIRE`). */
  twin: Twin | null;
  /** Aiming the twin (its own angle and power) rather than the main tank, while there is one. */
  aimTwin: boolean;
  /** Where the twin will appear (x), as placed by tapping while Twins is selected (null: the suggested spot). */
  twinSpot: number | null;
  /** px of driving left for the rest of the match. */
  fuel: number;
  /** A Prepper bunker round the main tank, while it stands (its walls are terrain: they're what keep him in). */
  bunker: Bunker | null;
  /** ShotDownBoyz: whether this turn's driving is horizontal, tunnelling digger movement. */
  diggerActive: boolean;
  /** ShotDownBoyz: direction of the last successful digger movement. */
  diggerFacing: number;
  /** ShotDownBoyz: global turn when Activate Digger was last used. */
  diggerTurn: number;
  /** ShotDownBoyz: jerry cans of diesel in reserve (one to start with; Resupply adds more): one refills an empty tank as his turn starts. */
  dieselCans: number;
  /** ShotDownBoyz: seconds the refuelling jerry can remains visible. */
  dieselCanTime: number;
  /** Women in Scam in play: until the end of the next enemy turn; `loot` is the weapon of the first enemy hit on this tank. */
  scam: { loot: string | null } | null;
  /** Diced Coffee: the chance it fails next time, and the turn it was last drunk (it's once a turn). Null: never drunk. */
  coffee: { failChance: number; turn: number } | null;
  /** Diced Coffee won this turn: when it ends, this player goes again (the next enemy turn is skipped). */
  extraTurn: boolean;
  /** garyoldmancorp's scooter crashed going this way (−1 / +1) and hasn't moved since (0: no crash to remember). */
  scooterCrash: number;
  /** doctorfox's Sly: out of sight of the other players until his next turn starts, or a hit (game/sly.ts). */
  hidden: boolean;
  /** doctorfox's Who's That Pokémon?: how many goes he's had, and the turn of the last (it's once a turn). Null: never tried. */
  pokemon: { tries: number; turn: number } | null;
  /**
   * ShotDownBoyz's stratagems this match (drawn from the seed: game/stratagems.ts), each with how many more
   * of this player's turns it's re-arming for (0: ready). Everyone has a set, in case one is stolen.
   */
  stratagems: { id: string; rearm: number }[];
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

/**
 * doctorfox's Arwing (game/movement.ts): `takeoff` lifts the tank from y0 to y1 as it turns into the ship,
 * `cruise` flies it over the ground while ◀ / ▶ is held, `landing` sets it down from y0 to y1 and turns it
 * back into a tank. `t` goes 0 → 1 through a takeoff or a landing; `dir` is the way it faces (±1).
 */
export interface Flight {
  stage: 'takeoff' | 'cruise' | 'landing';
  t: number;
  dir: number;
  y0: number;
  y1: number;
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

/** A boomerang in flight (kiwicore's flat cap): where it was thrown from, and how far round its loop it is. */
export interface Boomerang {
  ownerId: number;
  weaponId: string;
  /** Where it was thrown from, and comes back to (the thrower's dome). */
  x0: number;
  y0: number;
  /** The aim, radians, maths convention. */
  angle: number;
  /** How far out the loop reaches, along the aim (px). */
  range: number;
  /** Which side of the aim line it goes out on: +1 its left (above, thrown rightwards), −1 its right. */
  side: number;
  /** Seconds in flight, and the whole loop's. */
  t: number;
  duration: number;
  /** On its way back (past the far end of the loop). */
  back: boolean;
  /** Target keys hit on this pass (cleared when it turns for home). */
  hits: string[];
}

/** Where Hoop Dreamz's hoop hangs: the middle of the rim, and which side its backboard is on (−1 / +1). */
export interface Hoop {
  x: number;
  y: number;
  side: number;
}

/** A basketball in play (garyoldmancorp's Hoop Dreamz): flying and bouncing, or slammed down through the hoop. */
export interface Basketball {
  ownerId: number;
  weaponId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The hoop it's shot at (null: no enemy to hang it over). */
  hoop: Hoop | null;
  /** Seconds in play. */
  age: number;
  /** Ground bounces so far. */
  bounces: number;
  /** Through the hoop: seconds since (a moment on the rim, then the slam), null before. */
  dunk: number | null;
  /** It's bounced onto an enemy already (a loose ball only hurts once). */
  hit: boolean;
}

/** A note's verdict in Band Aid: not yet, perfect, close, or missed. */
export type Beat = 0 | 1 | 2 | 3;

/** kiwicore's Band Aid in play: the drum kit round his tank, the track's clock and how he's doing. */
export interface DrumSet {
  playerId: number;
  weaponId: string;
  /** Seconds since it began (the count-in first). */
  t: number;
  /** Each note's verdict, in order. */
  beats: Beat[];
  misses: number;
  /** What the hits so far are worth (hp), and what's been given back (never over full health). */
  owed: number;
  healed: number;
  /** The drum the stick last went to (−1 left, +1 right), and when (`t`). */
  side: number;
  swungAt: number;
  /** The latest verdict (a stray tap is a miss too) and when, for the words over the kit. */
  last: { beat: Beat; at: number } | null;
  /** The track is over (or he missed too many): it's fired, and the kit packs away. */
  done: boolean;
  /** Seconds into packing away (once fired), null before. */
  outro: number | null;
}

/** doctorfox's Sly in play: the smokescreen's gone up, and he has `weapon.sly.time` s to sneak off. */
export interface Sneak {
  playerId: number;
  weaponId: string;
  /** Seconds since the smoke went up. */
  t: number;
  /** Where the smoke went up (the tank, as it was). */
  x: number;
  y: number;
  /** When (`t`) he first moved under the smoke ("STEALTH POWERUP ACTIVATED", for his eyes only), null: not yet. */
  movedAt: number | null;
  /** Time's up (or FIRE ended it early): it's fired, and the turn is over. */
  done: boolean;
}

/** garyoldmancorp's 007 in play: the Bond question up on the screen, and how it's going. */
export interface Quiz {
  playerId: number;
  weaponId: string;
  /** Which question (weapons/trivia.ts `BOND_TRIVIA`). */
  question: number;
  /** Seconds since it went up. */
  t: number;
  /** The actor picked (`BOND_ACTORS`), null: none yet (or out of time). */
  picked: number | null;
  /** Answered, or out of time: it's fired. */
  done: boolean;
  /** Seconds since it was fired (the answer shown), null before. */
  outro: number | null;
}

/**
 * doctorfox's Who's That Pokémon? in play: a silhouette and the names to pick from (game/pokemon.ts).
 * Pokédex numbers (weapons/pokedex.ts); MissingNo. (0) on the last go, its options all 0 too.
 */
export interface Guess {
  playerId: number;
  tier: number;
  weaponId: string;
  /** Who it is. */
  dex: number;
  /** The names to pick from (Pokédex numbers), `dex` among them. */
  options: number[];
  /** Seconds since it went up (the clock runs once the picture's in: main.ts). */
  t: number;
  /** The option picked, null: none yet (or out of time). */
  picked: number | null;
  /** Answered, or out of time: it's fired. */
  done: boolean;
  /** Seconds since it was fired (the answer shown), null before. */
  outro: number | null;
}

/** ShotDownBoyz's Stratagem in play: the d-pad up, the arrows keyed so far, and how it's going. */
export interface Call {
  playerId: number;
  weaponId: string;
  /** The arrows keyed so far (weapons/stratagems.ts `Arrow`s), matching at least one ready stratagem. */
  input: string;
  /** Seconds since it went up. */
  t: number;
  /** When (`t`) the last wrong arrow wiped the input, null: none yet. */
  wrongAt: number | null;
  /** The stratagem whose combo was finished, null: none (yet, or out of time). */
  picked: string | null;
  /** A combo's finished, or out of time: it's fired (or called off). */
  done: boolean;
}

/**
 * A stratagem coming down where its beacon landed (game/stratagems.ts): the beacon's light, then the
 * strike, or the pod falling.
 */
export interface StratagemDrop {
  ownerId: number;
  stratagem: string;
  /** Where the beacon landed. */
  x: number;
  y: number;
  /** Seconds since it landed. */
  t: number;
  /** The Orbital Laser: where the beam is now (it drifts toward an enemy close by, burning down to `beamY`), and the pulses burnt so far. */
  beamX: number;
  beamY: number;
  pulses: number;
  /** A pod: how far down it's fallen (null: not dropping yet). */
  podY: number | null;
  /** It's over: the strike's done, or the pod's down. */
  done: boolean;
}

/** A ShotDownBoyz sentry (a turret stratagem): it fires every turn, anyone's, until its rounds are gone. */
export interface Sentry {
  id: number;
  ownerId: number;
  stratagem: string;
  x: number;
  y: number;
  shots: number;
  /** Degrees it last fired at (0 = right, 90 = up), for drawing its barrel. */
  aim: number;
  /** Seconds since it landed (cosmetic: unfolding). */
  age: number;
}

/** A pod on the ground (a weapon drop or Resupply), waiting for its owner to drive into it. */
export interface Crate {
  id: number;
  ownerId: number;
  stratagem: string;
  x: number;
  y: number;
}

/** Who a shot that finds its own target is on (007's gun barrel, an Air Strike): one of a player's tanks (the main one, or the twin), or a decoy. */
export type TargetMark = { kind: 'tank'; playerId: number; twin: boolean } | { kind: 'hologram'; id: number };

/** A right answer to 007: the gun barrel cutscene on the enemy, then their share of health (game/bond.ts). */
export interface GunBarrel {
  ownerId: number;
  weaponId: string;
  mark: TargetMark;
  /** Where the mark's hull rests (where the barrel's drawn). */
  x: number;
  y: number;
  /** Seconds since it was fired (the cutscene's clock: bond.ts `BARREL`). */
  t: number;
  /** The shot's been fired and the damage done. */
  hit: boolean;
}

/**
 * doctorfox's Air Strike (game/airstrike.ts): the ping on the horizon, three Arwings coming in over the
 * mark and strafing it, the comm from one of the Star Fox team (`pilot`), then the bomb.
 */
export interface AirStrike {
  ownerId: number;
  weaponId: string;
  mark: TargetMark;
  /** Where the mark's hull was last seen (the run follows it; it stays put if the mark is gone). */
  x: number;
  y: number;
  /** Which way the ships fly over (±1), from the far side of the mark. */
  dir: number;
  /** Which comm line (weapons/comms.ts `COMMS`). */
  pilot: number;
  /** Where each laser bolt lands, across the mark (px, −spread to +spread), picked when it's called in. */
  aims: number[];
  /** The bolts fired so far: from the ship to where each stopped (drawn as it streaks down). */
  bolts: { x1: number; y1: number; x2: number; y2: number; t: number }[];
  /** Seconds since it was called in (the run's clock: airstrike.ts `STRIKE`). */
  t: number;
  /** The bomb's gone off. */
  bombed: boolean;
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

/**
 * ShotDownBoyz's Prepper (game/bunker.ts): a brick bunker round a player's tank. The bricks themselves are
 * terrain; this is where it is, which way its slit faces, and how its building is going.
 */
export interface Bunker {
  weaponId: string;
  /** The turret's pivot once dug in: the bunker's centre. */
  x: number;
  y: number;
  /** The ground under the tank before it dug in. */
  ground: number;
  /** Degrees (0 = right, 90 = up, 180 = left) the slit is centred on. */
  slit: number;
  /** Seconds since it was fired (drilling, then building). */
  elapsed: number;
  /** Solid pixels in its walls once built (0 while it's building): how much there was to knock down. */
  bricks: number;
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
  /** A tracer (doctorfox's Calculated): how many degrees off the aim it was fired. Harmless: it marks where it lands. */
  tracer?: number;
  /** A stratagem beacon: what it calls in where it lands (game/stratagems.ts). */
  stratagem?: string;
  /** A top attack (the Spear's): popping up over its target, then slamming down. */
  attack?: 'pop' | 'slam';
  /** Seconds before it leaves the muzzle (a sentry's burst, fired all at once): until then it waits, unseen. */
  wait?: number;
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
  /** Drawn in its own colour, not lightened like spray (the digger's clods of dirt). */
  opaque?: boolean;
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
  | 'pop-up'
  | 'slam'
  | 'splashback'
  | 'yolk'
  | 'slurp'
  | 'spill'
  | 'refuel'
  | 'digger'
  | 'scoot'
  | 'crash'
  | 'arwing-up'
  | 'arwing'
  | 'arwing-down'
  | 'catch'
  | 'swish'
  | 'clank'
  | 'dribble'
  | 'drum'
  | 'whiff'
  | 'smoke'
  | 'spotted'
  | 'stealth'
  | 'quiz'
  | 'quiz-right'
  | 'quiz-wrong'
  | 'gun-barrel'
  | 'bond-sting'
  | 'bond-shot'
  | 'kira'
  | 'pokemon'
  | 'pokemon-right'
  | 'pokemon-wrong'
  | 'missingno'
  | 'tracer'
  | 'arwings'
  | 'comm'
  | 'laser'
  | 'smart-bomb'
  | 'strike-beat'
  | 'drill'
  | 'brick'
  | 'bunker-down'
  | 'call'
  | 'call-key'
  | 'call-wrong'
  | 'call-done'
  | 'call-off'
  | 'beacon'
  | 'orbital-laser'
  | 'railcannon'
  | 'pod'
  | 'sentry-up'
  | 'sentry-rocket'
  | 'sentry-shell'
  | 'zap'
  | 'pickup'
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
 * `drumming`: kiwicore is playing Band Aid (like aiming, it's this phone's input, streamed in previews);
 * when it's over it's fired, and the shot (`flying`) is the kit packing away. `sneaking`: doctorfox's Sly,
 * driving off unseen (his phone's input too, like aiming); when time's up it's fired, and his turn is over.
 * `quizzing`: garyoldmancorp's 007, a Bond question to answer (his phone's input too); answered, it's
 * fired, and the shot is the gun barrel cutscene (or nothing, for a wrong answer). `guessing`: doctorfox's
 * Who's That Pokémon?, a bonus move (his phone's input too); answered, it's fired, the answer shows, and
 * the turn carries on (back to `aiming`). `calling`: ShotDownBoyz's Stratagem, a combo to key on the d-pad
 * (his phone's input too); finished, it's fired (the beacon); out of time, it's back to `aiming`.
 */
export type Phase = 'aiming' | 'stealing' | 'coffee' | 'drumming' | 'sneaking' | 'quizzing' | 'guessing' | 'calling' | 'flying' | 'settling' | 'gameover';

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
  /** Sly's smokescreens, billowing up where doctorfox was and thinning out. */
  smokes: Smoke[];
  /** Where Calculated's tracers landed, and how far off the aim they were: until he fires again. */
  marks: TracerMark[];
}

/** A tracer's landing (cosmetic): where, whose, and its offset from the aim in degrees. */
export interface TracerMark {
  ownerId: number;
  x: number;
  y: number;
  offset: number;
  age: number;
}

/** A smokescreen (cosmetic): where, how old and how long it lasts (s). */
export interface Smoke {
  x: number;
  y: number;
  age: number;
  duration: number;
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
  /** kiwicore's Band Aid, while he drums and while the kit packs away after. */
  drums: DrumSet | null;
  /** doctorfox's Sly, while he sneaks off. */
  sneak: Sneak | null;
  /** garyoldmancorp's 007: the question, while it's up and while the answer shows after. */
  quiz: Quiz | null;
  /** doctorfox's Who's That Pokémon?: the silhouette, while it's up and while the answer shows after. */
  guess: Guess | null;
  /** ShotDownBoyz's Stratagem: the d-pad, while he keys a combo. */
  call: Call | null;
  /** Stratagems coming down where their beacons landed. */
  drops: StratagemDrop[];
  /** ShotDownBoyz's sentries on the field (they stay, turn after turn, until their rounds are gone). */
  sentries: Sentry[];
  /** Weapon and Resupply pods on the ground, waiting to be driven into. */
  crates: Crate[];
  /** garyoldmancorp's 007, answered right: the gun barrel cutscene. */
  barrel: GunBarrel | null;
  /** doctorfox's Air Strike, while it plays out. */
  airstrike: AirStrike | null;
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
  boomerangs: Boomerang[];
  basketballs: Basketball[];
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

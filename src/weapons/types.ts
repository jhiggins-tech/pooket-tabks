import type { DictionaryId } from './dictionaries';

/** Sprites a projectile can be drawn with (see src/render/sprites.ts). */
export type SpriteId = 'ice-cream-cone' | 'pill' | 'pill-red' | 'pill-blue' | 'pill-round' | 'pill-oval' | 'weasel' | 'kookaburra' | 'rizz' | 'ink-needle' | 'cat-ginger' | 'cat-grey';

/**
 * How a weapon is delivered:
 * - `ballistic` (default): projectiles launched from the barrel, pulled by gravity.
 * - `beam`: instant straight line from the barrel, no gravity (ignores power).
 * - `rain`: projectiles fall across the whole stage; aiming is ignored.
 * - `stream`: a jet of liquid whose pressure ramps up, holds, then eases off (see `stream`).
 * - `decoy`: no shot; spawns hologram copies of the firer's tank (see `decoys`). Ignores aiming.
 * - `jetpack`: the firer's own tank charges up, then launches along the aim (see `jetpack`).
 * - `spew`: a short-range gush of chunky gunk from the barrel (see `spew`).
 * - `sonic`: expanding arcs of sound that pass through terrain (see `sonic`).
 * - `heal`: no shot; the firer naps and wakes at full health (see `heal`). Ignores aiming.
 * - `sew`: a needle and thread stitching along the aim through terrain, pinning what it stitches (see `sew`).
 * - `steal`: no shot; takes one round of a random enemy weapon, which replaces it in the slot. Free action.
 * - `runner`: a marathon runner jogs towards the nearest enemy a leg at a time, turn after turn (see `runner`).
 * - `twin`: no shot; a second tank appears and the firer's HP is split between the two. From then on
 *   the twin fires the same weapon with the same aim whenever its player fires. Ignores aiming.
 */
export type WeaponKind =
  | 'ballistic'
  | 'beam'
  | 'rain'
  | 'stream'
  | 'decoy'
  | 'jetpack'
  | 'spew'
  | 'sonic'
  | 'heal'
  | 'twin'
  | 'sew'
  | 'runner'
  | 'steal'
  | 'scam';

/**
 * Sonic weapons: `waves` arcs, `interval` s apart, expand from the barrel at `speed` px/s across
 * ±`halfAngleDeg` of the aim, through terrain, out to a range set by power (`minRange`–`maxRange`).
 * Each wave hits each target once for `damage` × min(1, `refDistance` / distance): the further away,
 * the less of the arc reaches them.
 */
export interface SonicSpec {
  waves: number;
  interval: number;
  speed: number;
  halfAngleDeg: number;
  minRange: number;
  maxRange: number;
  damage: number;
  refDistance: number;
}

/** Chiptunes a weapon can play (see src/audio/tunes.ts). */
export type TuneId = 'pop-goes-the-weasel';

/** Cosmetic apparitions a weapon can summon in the sky when fired. */
export type ApparitionKind = 'kookaburra';

/**
 * Gunk particles (jetpack propellant, spew chunks): they fly under gravity, slump into piles of new
 * dirt where they land, and dose any enemy tank they hit. The dose drains as trickling damage at
 * `dosePerSecond`, all within the same turn.
 */
export interface GunkSpec {
  dosePerParticle: number;
  dosePerSecond: number;
  /** Colour of the piles it leaves. */
  deposit: readonly [number, number, number];
  depositRadius: number;
  /** How the particles are drawn in flight. */
  look: 'mud' | 'spew';
  /**
   * Toxic puddles: where a particle lands it leaves a patch of sludge (`radius` px). For the rest of
   * the turn (the turn lingers `linger` s after the last landing), any enemy touching a patch burns at
   * `damagePerSecond` (touching several patches doesn't stack).
   */
  puddle?: { radius: number; damagePerSecond: number; linger: number };
}

/** Spew weapons: gush `chunksPerSecond` for `duration`, fanned ±`spreadDeg`, at up to `speed` px/s (× power). */
export interface SpewSpec {
  duration: number;
  chunksPerSecond: number;
  speed: number;
  spreadDeg: number;
}

/**
 * Jetpack weapons: the tank shakes while it charges for `chargeTime`, then gets one launch impulse
 * along the aim at power × `thrust` × MAX_SPEED and flies ballistically until it lands. For
 * `burnTime` after launch it sprays propellant backwards (see the weapon's `gunk`).
 */
export interface JetpackSpec {
  chargeTime: number;
  thrust: number;
  burnTime: number;
  particlesPerSecond: number;
  /** Exhaust speed relative to the tank (px/s), randomised between `exhaustSpeedRange` × this. */
  exhaustSpeed: number;
  exhaustSpeedRange: readonly [number, number];
  /** Half-width of the exhaust fan, in degrees either side of straight back. */
  exhaustSpreadDeg: number;
}

/**
 * Pressure profile for stream weapons. Pressure eases 0 → 1 over `rampUp`, holds at 1 for `hold`,
 * then eases back to 0 over `rampDown`. Droplets leave at pressure × the aimed shot speed, so at
 * full pressure the jet follows the whole aimed trajectory.
 */
export interface StreamSpec {
  rampUp: number;
  hold: number;
  rampDown: number;
  /** Droplets per second at full pressure (flow scales with pressure). */
  dropsPerSecond: number;
  /** Damage each droplet adds when it hits a tank (accumulated and shown in small batches). */
  damagePerDrop: number;
  /**
   * Scatter at low pressure: each droplet leaves up to ± `spray` degrees off the aim and ± `speedSpread`
   * (a fraction) off its speed; the jet tightens to a clean line as the pressure reaches full.
   */
  spray?: number;
  speedSpread?: number;
}

export interface WeaponDef {
  id: string;
  name: string;
  /** Short label for thumb-sized buttons. */
  shortName: string;
  /** What it does, in a sentence or three, for the in-game info screen. */
  info: string;
  kind?: WeaponKind;
  /** Crater radius in world pixels (for a beam: the hole it burns where it hits ground). */
  blastRadius: number;
  /** Damage at the centre of each blast, falling off linearly to the edge (for a beam: direct-hit damage). */
  damage: number;
  /**
   * Fire several projectiles per round, fanned evenly across ±spreadDeg of the aim
   * (e.g. count 2, spread 2 → aim −2° and aim +2°). Defaults to a single shot.
   */
  volley?: { count: number; spreadDeg: number };
  /** Rain weapons: how many projectiles fall. */
  rainCount?: number;
  /** Bounce off the ground this many times, detonating on the next contact. Default 0. */
  bounces?: number;
  /** Fraction of speed kept (along the surface normal) on each bounce. */
  restitution?: number;
  // Effects of a hit, whatever the kind of weapon (applyHit in game/tanks.ts; statuses in game/statuses.ts):
  /** A burn on the tank hit, dealing damage at the start of each of its player's next `turns` turns. */
  dot?: { damagePerTurn: number; turns: number };
  /** Whether its hits hurt the player who fired them (blasts, stream). Default true. */
  friendlyFire?: boolean;
  /** Pins whoever it hits: they can't drive or hop on their next turn. */
  pin?: boolean;
  /** Draw the projectile as a sprite pointing along its flight path; default is a plain shell. */
  sprite?: SpriteId;
  /** A mix of looks: round n of a burst (or shot n of a volley) is drawn with `spriteVariants[n % length]`. */
  spriteVariants?: SpriteId[];
  /** Tumble the sprite around its centre at this many radians per second in flight (instead of pointing along the path). */
  spin?: number;
  /**
   * Walkers: instead of exploding on landing, walk along the ground towards the nearest enemy at
   * `speed` px/s, climbing steps up to `climb` px. They scurry right up under an enemy and detonate within
   * `fuse` px of its centre (near full damage), or wherever they're within blast range and can't get any
   * closer (a wall, a ledge, walking past); otherwise after `duration`.
   */
  walk?: { speed: number; duration: number; climb: number; fuse: number };
  /** A shot that hits no enemy (tank, twin or decoy) gives its round back at the end of the turn. */
  refundOnMiss?: boolean;
  /** A chiptune that plays while this weapon's walkers are walking, cut off when the last one is gone. */
  tune?: TuneId;
  /** Draw a dotted trail behind projectiles. Default true. */
  trail?: boolean;
  /** Decoy weapons: how many hologram copies to spawn. */
  decoys?: number;
  /** Decoy weapons: a hologram that gets hit blows up, a blast that hurts every tank in reach, friend or foe. */
  decoyBlast?: { radius: number; damage: number };
  /** Jetpack weapons: charge, launch and propellant. */
  jetpack?: JetpackSpec;
  /** Spew weapons: the gush. */
  spew?: SpewSpec;
  /** Particles from jetpack/spew weapons. */
  gunk?: GunkSpec;
  /**
   * Ballistic weapons can fire a series of rounds: `count` shots `interval` s apart along the aim, each
   * with its power varied by up to ±`powerJitter` (a fraction), so they walk across the target area.
   */
  burst?: { count: number; interval: number; powerJitter: number };
  /** "Cook" debuff: whoever it hits deals `offenceMultiplier` × damage with everything they fire on their next turn. */
  debuff?: { offenceMultiplier: number };
  /**
   * Homing: once the projectile comes within `radius` px of an enemy tank (or one of its decoys or twin),
   * it locks on and flies at it, turning up to `turnRate` degrees a second at `minSpeed` px/s or more
   * (no gravity once locked).
   */
  homing?: { radius: number; turnRate: number; minSpeed: number };
  /**
   * Word fire (with `burst`): pick a random word from the dictionary and fire it one letter per round,
   * so the round count is the word's length. A twin fires from its own dictionary.
   */
  words?: { main: DictionaryId; twin: DictionaryId; mainColour: string; twinColour: string };
  /** "Tattoo" mark: whoever it hits takes `multiplier` × damage from everything until they've had `turns` more turns. */
  tattoo?: { multiplier: number; turns: number };
  /**
   * Sew: a needle zig-zags along the aim at `speed` px/s (stitches `amplitude` px either side, one every
   * `wavelength` px) through terrain, out to a range set by power; each enemy stitched takes `damage`
   * and is pinned (can't drive or hop) on its next turn.
   */
  sew?: { speed: number; minRange: number; maxRange: number; amplitude: number; wavelength: number; damage: number };
  /**
   * Runner: jogs at `speed` px/s towards the nearest enemy, `leg` px each time anyone fires, over any
   * hill; on reaching a tank it hits for `damage` (blast `radius`). Any blast that catches it knocks it out.
   */
  runner?: { speed: number; leg: number; damage: number; radius: number };
  /** Heal weapons: nap for `napTime` s, then wake at full health. */
  heal?: { napTime: number };
  /** Sonic weapons: the waves. */
  sonic?: SonicSpec;
  /** Something that appears in the sky above the tank when fired (cosmetic). */
  apparition?: ApparitionKind;
  /** Stream weapons: pressure profile and flow. */
  stream?: StreamSpec;
  /** Beam / liquid colour. */
  colour?: string;
}

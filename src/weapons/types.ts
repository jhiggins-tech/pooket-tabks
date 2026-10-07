import type { DictionaryId } from './dictionaries';
import type { WeaponKind } from './kinds';

/** Sprites a projectile can be drawn with (see src/render/sprites.ts). */
export type SpriteId = 'iced-coffee' | 'ice-cream-cone' | 'pill' | 'pill-red' | 'pill-blue' | 'pill-round' | 'pill-oval' | 'weasel' | 'kookaburra' | 'rizz' | 'ink-needle' | 'cat-ginger' | 'cat-grey';

/** How a weapon is delivered: see the table in kinds.ts. */
export type { WeaponKind } from './kinds';

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

/**
 * Diced Coffee: a bonus move with a spinner. It fails (lands on full cream) `failChance` of the time, and
 * `failStep` more after each win. A win (lactose free): the drinker goes again after this turn, the next
 * enemy turn skipped. A fail: a little ten-2 straight up (the weapon's `jetpack` and `gunk`), and it's
 * gone for the match. Once a turn.
 */
export interface CoffeeSpec {
  failChance: number;
  failStep: number;
}

/** What every weapon has, whatever its kind. */
export interface WeaponBase {
  id: string;
  name: string;
  /** Short label for thumb-sized buttons. */
  shortName: string;
  /** What it does, in a sentence or three, for the in-game info screen. */
  info: string;
  /** Its colour: a beam, a liquid, a burn, labels. */
  colour?: string;
  /** Something that appears in the sky above the tank when fired (cosmetic). */
  apparition?: ApparitionKind;
  // Effects of a hit, whatever the kind of weapon (applyHit in game/tanks.ts; statuses in game/statuses.ts):
  /** A burn on the tank hit, dealing damage at the start of each of its player's next `turns` turns. */
  dot?: { damagePerTurn: number; turns: number };
  /** "Cook" debuff: whoever it hits deals `offenceMultiplier` × damage with everything they fire on their next turn. */
  debuff?: { offenceMultiplier: number };
  /** "Tattoo" mark: whoever it hits takes `multiplier` × damage from everything until they've had `turns` more turns. */
  tattoo?: { multiplier: number; turns: number };
  /** Pins whoever it hits: they can't drive or hop on their next turn. */
  pin?: boolean;
  /** Whether its hits hurt the player who fired them (blasts, stream). Default true. */
  friendlyFire?: boolean;
  /** A shot that hits no enemy (tank, twin or decoy) gives its round back at the end of the turn. */
  refundOnMiss?: boolean;
}

/** Weapons that blow up where they land (or, for a beam, where it hits). */
export interface BlastSpec {
  /** Crater radius in world pixels (for a beam: the hole it burns where it hits ground). */
  blastRadius: number;
  /** Damage at the centre of each blast, falling off linearly to the edge (for a beam: direct-hit damage). */
  damage: number;
}

/** Projectile weapons (ballistic and rain): how the rounds fly, behave and look. */
export interface ProjectileSpec extends BlastSpec {
  /**
   * Fire several projectiles per round, fanned evenly across ±spreadDeg of the aim
   * (e.g. count 2, spread 2 → aim −2° and aim +2°). Defaults to a single shot.
   */
  volley?: { count: number; spreadDeg: number };
  /**
   * A series of rounds: `count` shots `interval` s apart along the aim, each with its power varied by up
   * to ±`powerJitter` (a fraction), so they walk across the target area.
   */
  burst?: { count: number; interval: number; powerJitter: number };
  /**
   * Word fire (with `burst`): pick a random word from the dictionary and fire it one letter per round,
   * so the round count is the word's length. A twin fires from its own dictionary.
   */
  words?: { main: DictionaryId; twin: DictionaryId; mainColour: string; twinColour: string };
  /** Bounce off the ground this many times, detonating on the next contact. Default 0. */
  bounces?: number;
  /** Fraction of speed kept (along the surface normal) on each bounce. */
  restitution?: number;
  /**
   * Walkers: instead of exploding on landing, walk along the ground towards the nearest enemy at
   * `speed` px/s, climbing steps up to `climb` px. They scurry right up under an enemy and detonate within
   * `fuse` px of its centre (near full damage), or wherever they're within blast range and can't get any
   * closer (a wall, a ledge, walking past); otherwise after `duration`.
   */
  walk?: { speed: number; duration: number; climb: number; fuse: number };
  /** A chiptune that plays while this weapon's walkers are walking, cut off when the last one is gone. */
  tune?: TuneId;
  /**
   * Homing: once the projectile comes within `radius` px of an enemy tank (or one of its decoys or twin),
   * it locks on and flies at it, turning up to `turnRate` degrees a second at `minSpeed` px/s or more
   * (no gravity once locked).
   */
  homing?: { radius: number; turnRate: number; minSpeed: number };
  /** Draw the projectile as a sprite pointing along its flight path; default is a plain shell. */
  sprite?: SpriteId;
  /** A mix of looks: round n of a burst (or shot n of a volley) is drawn with `spriteVariants[n % length]`. */
  spriteVariants?: SpriteId[];
  /** Tumble the sprite around its centre at this many radians per second in flight (instead of pointing along the path). */
  spin?: number;
  /** Draw a dotted trail behind projectiles. Default true. */
  trail?: boolean;
}

/**
 * Sew: a needle zig-zags along the aim at `speed` px/s (stitches `amplitude` px either side, one every
 * `wavelength` px) through terrain, out to a range set by power; each enemy stitched takes `damage`.
 */
export interface SewSpec {
  speed: number;
  minRange: number;
  maxRange: number;
  amplitude: number;
  wavelength: number;
  damage: number;
}

/**
 * Runner: jogs at `speed` px/s towards the nearest enemy, `leg` px each time anyone fires, over any hill;
 * on reaching a tank it hits for `damage` (blast `radius`). Any blast that catches it knocks it out.
 */
export interface RunnerSpec {
  speed: number;
  leg: number;
  damage: number;
  radius: number;
}

/**
 * A weapon: what it has in common with every other, plus its kind's spec (kinds.ts says what each kind
 * is). The kind decides which spec it must have, so a weapon missing its spec doesn't compile.
 */
export type WeaponDef = WeaponBase &
  (
    | ({ kind?: 'ballistic' } & ProjectileSpec)
    /** `rainCount` projectiles fall across the whole stage. */
    | ({ kind: 'rain'; rainCount: number } & ProjectileSpec)
    | ({ kind: 'beam' } & BlastSpec)
    | { kind: 'stream'; stream: StreamSpec }
    /** `decoys` holograms per use; a hit one blows up (`decoyBlast`), hurting every tank in reach, friend or foe. */
    | { kind: 'decoy'; decoys: number; decoyBlast: { radius: number; damage: number } }
    /** The jetpack's charge and launch, and its propellant (`gunk`). */
    | { kind: 'jetpack'; jetpack: JetpackSpec; gunk: GunkSpec }
    | { kind: 'spew'; spew: SpewSpec; gunk: GunkSpec }
    | { kind: 'sonic'; sonic: SonicSpec }
    /** Nap for `napTime` s, then wake at full health. */
    | { kind: 'heal'; heal: { napTime: number } }
    | { kind: 'twin' }
    | { kind: 'sew'; sew: SewSpec }
    | { kind: 'runner'; runner: RunnerSpec }
    | { kind: 'steal' }
    | { kind: 'scam' }
    /** The spinner's odds, and the little jetpack (and its gunk) of a spill. */
    | { kind: 'coffee'; coffee: CoffeeSpec; jetpack: JetpackSpec; gunk: GunkSpec }
  );

/** The weapons of one kind (with that kind's spec). */
export type WeaponOf<K extends WeaponKind> = Extract<WeaponDef, { kind?: K }>;

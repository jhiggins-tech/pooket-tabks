import type { DictionaryId } from './dictionaries';
import type { WeaponKind } from './kinds';

/** Sprites a projectile can be drawn with (see src/render/sprites.ts). */
export type SpriteId = 'iced-coffee' | 'ice-cream-cone' | 'pill' | 'pill-red' | 'pill-blue' | 'pill-round' | 'pill-oval' | 'weasel' | 'kookaburra' | 'rizz' | 'ink-needle' | 'cat-ginger' | 'cat-grey' | 'coffee-bean';

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
export type TuneId = 'pop-goes-the-weasel' | 'band-aid';

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

/**
 * Who's That Pokémon?: a silhouette and `options` names, `time` s to pick (the clock starts once the
 * picture's in). Right: a round back on tier `refill` (up to full); wrong, or out of time: it's gone for the
 * match. Go number `missingNo` is always MissingNo., which glitches it out for good. Once a turn.
 */
export interface PokemonSpec {
  time: number;
  options: number;
  refill: number;
  missingNo: number;
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
  /** A burn on the tank hit, dealing damage at each of the next `turns` turn changes, whoever's turn it is. */
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
  /** The full `damage` to anything in the blast, with no falloff (for tiny rounds, where falloff would round it away). */
  flat?: boolean;
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
   * to ±`powerJitter` (a fraction) and its angle by up to ±`aimJitterDeg` (default 1°), so they walk
   * across the target area.
   */
  burst?: { count: number; interval: number; powerJitter: number; aimJitterDeg?: number };
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
   * (no gravity once locked). `soft`: it keeps falling as it turns, so it tilts toward them rather than
   * flying straight at them (ShotDownBoyz's missiles).
   */
  homing?: { radius: number; turnRate: number; minSpeed: number; soft?: boolean };
  /** Draw the projectile as a sprite pointing along its flight path; default is a plain shell. */
  sprite?: SpriteId;
  /** A mix of looks: round n of a burst (or shot n of a volley) is drawn with `spriteVariants[n % length]`. */
  spriteVariants?: SpriteId[];
  /** Tumble the sprite around its centre at this many radians per second in flight (instead of pointing along the path). */
  spin?: number;
  /** Draw a dotted trail behind projectiles. Default true. */
  trail?: boolean;
  /**
   * Tracers (doctorfox's Calculated): with each shot, `count` harmless rounds either side of it, `stepDeg`
   * apart (count 3, step 10: ±10°, ±20°, ±30°). Where each lands it leaves its offset from the aim
   * ("+20°"), until the firer fires again.
   */
  tracers?: { count: number; stepDeg: number };
  /** Drawn as a glowing ball of plasma in the weapon's colour (rather than a sprite or a shell). */
  plasma?: boolean;
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
 * Boomerang: thrown from the dome, it flies a loop through anything: out to its reach along the
 * aim (`minRange`–`maxRange`, set by power), round and home again, the loop `curl` × its reach wide (out
 * above the aim line, back below). It takes `flight` s per 100 px of reach (plus a moment: game/boomerang.ts). Each enemy it passes through
 * takes `damage`, once on the way out and once on the way back at most; the thrower catches it.
 */
export interface BoomerangSpec {
  minRange: number;
  maxRange: number;
  curl: number;
  flight: number;
  damage: number;
}

/**
 * Hoop: a hoop hangs `height` px above the enemy nearest the shooter (its rim `rimHalf` px either side of
 * the middle, a backboard on the far side). The ball flies like a shell; dropping through the rim within
 * `swish` px of the middle is a make, slammed straight down onto whatever's below for the weapon's blast.
 * Otherwise it bounces (rim, backboard, ground: `restitution`), and the first enemy it bounces onto takes
 * `looseDamage`.
 */
export interface HoopSpec {
  height: number;
  rimHalf: number;
  swish: number;
  looseDamage: number;
  restitution: number;
}

/**
 * Drum: a rhythm minigame over a chiptune (`tune`): after `countIn` beats at `bpm`, a note comes at each
 * of `notes` (in eighth notes from the end of the count-in), alternately on the left and right drum. A tap
 * within `perfect` s of a note is a perfect hit, within `close` a close one (half as good); a note let go
 * by, or a tap with no note near, is a miss, and `misses` of them end it. A flawless run heals `maxHeal`
 * of full health.
 */
export interface DrumSpec {
  bpm: number;
  countIn: number;
  notes: readonly number[];
  perfect: number;
  close: number;
  maxHeal: number;
  misses: number;
  tune: TuneId;
}

/**
 * Sly: a smokescreen, the fuel tank filled up, and `time` s to drive off out of sight. The firer stays
 * hidden from the other players until their next turn starts, or something hits them.
 */
export interface SlySpec {
  time: number;
}

/**
 * Bond: a Bond trivia question (weapons/trivia.ts), `time` s to answer it. Right, and the enemy nearest the
 * firer takes `share` of the health they have left, after the gun barrel cutscene; wrong (or out of
 * time), nothing.
 */
export interface BondSpec {
  time: number;
  share: number;
}

/**
 * Air Strike: three Arwings strafe the enemy nearest the firer with `lasers` laser bolts, each landing up to
 * `spread` px either side of them; a bolt that hits a target does `laserDamage` and every bolt burns a
 * `laserRadius` px hole where it lands. Then a bomb on them: the weapon's blast.
 */
export interface AirStrikeSpec {
  lasers: number;
  laserDamage: number;
  laserRadius: number;
  spread: number;
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
 * Prepper: the tank drills `sink` px down over `drillTime` s, then a brick bunker builds round it over
 * `buildTime` s: `courses` rings of bricks (`course` px deep, about `brick` px long, staggered) from
 * `inner` px out from the turret's pivot, over the top from ground to ground, leaving a slit `slit`° wide
 * centred on the aim. It stands until fewer than `standing` of its bricks are left.
 */
export interface BunkerSpec {
  sink: number;
  drillTime: number;
  buildTime: number;
  inner: number;
  courses: number;
  course: number;
  brick: number;
  slit: number;
  standing: number;
}

/**
 * Stratagem: `offered` stratagems a match (and Resupply), `time` s to key one's combo; a supply or weapon
 * pod that lands on a tank does `podDamage` (game/stratagems.ts).
 */
export interface StratagemSpec {
  time: number;
  offered: number;
  podDamage: number;
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
    | { kind: 'boomerang'; boomerang: BoomerangSpec }
    /** The hoop and the loose ball; the dunk's blast. */
    | ({ kind: 'hoop'; hoop: HoopSpec } & BlastSpec)
    | { kind: 'drum'; drum: DrumSpec }
    | { kind: 'sly'; sly: SlySpec }
    | { kind: 'bond'; bond: BondSpec }
    /** The strafing run, and the bomb's blast. */
    | ({ kind: 'airstrike'; airstrike: AirStrikeSpec } & BlastSpec)
    | { kind: 'runner'; runner: RunnerSpec }
    | { kind: 'bunker'; bunker: BunkerSpec }
    | { kind: 'stratagem'; stratagem: StratagemSpec }
    | { kind: 'steal' }
    | { kind: 'scam' }
    | { kind: 'digger' }
    /** The spinner's odds, and the little jetpack (and its gunk) of a spill. */
    | { kind: 'coffee'; coffee: CoffeeSpec; jetpack: JetpackSpec; gunk: GunkSpec }
    | { kind: 'pokemon'; pokemon: PokemonSpec }
  );

/** The weapons of one kind (with that kind's spec). */
export type WeaponOf<K extends WeaponKind> = Extract<WeaponDef, { kind?: K }>;

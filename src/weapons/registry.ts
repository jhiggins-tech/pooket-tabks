import type { WeaponDef } from './types';

export const shell: WeaponDef = {
  id: 'shell',
  name: 'Shell',
  shortName: 'Shell',
  info:
    'A classic artillery shell. Lob it over the hills: a big crater and 45 damage on a direct hit, less towards the edge of the blast.',
  blastRadius: 24,
  damage: 45,
};

/** kcaj's tier 1: two ice cream cones fanned ±2° either side of the aim. */
export const doublePark: WeaponDef = {
  id: 'double-park',
  name: 'Double Park',
  shortName: 'Double Park',
  info:
    'Two ice cream cones fired together, 2° either side of your aim. Small blasts of up to 25 each; land both for a double scoop.',
  blastRadius: 16,
  damage: 25,
  volley: { count: 2, spreadDeg: 2 },
  sprite: 'ice-cream-cone',
};

/** kcaj's tier 2: a straight laser from the barrel; a direct hit keeps burning for 3 turns. */
export const hyperfixate: WeaponDef = {
  id: 'hyperfixate',
  name: 'Hyperfixate',
  shortName: 'Hyperfixate',
  info:
    'A laser straight out of the barrel: no arc, and power doesn’t matter. A direct hit does 15, then burns for 8 at the start of the victim’s next 3 turns.',
  kind: 'beam',
  blastRadius: 7,
  damage: 15,
  dot: { damagePerTurn: 8, turns: 3 },
  colour: '#ff3df2',
};

/** kcaj's tier 3: pills rain over the whole stage, bounce twice, then pop. Never hurts kcaj. */
export const unmedicated: WeaponDef = {
  id: 'unmedicated',
  name: 'Unmedicated',
  shortName: 'Unmedicated',
  info:
    'No aiming. 120 pills rain across the whole stage, bounce twice and pop. Each is tiny (up to 7), but the sheer volume adds up. Never hurts kcaj.',
  kind: 'rain',
  rainCount: 120,
  blastRadius: 11,
  damage: 7, // ~33 total on average across random maps (5–70 range): the volume does the work
  bounces: 2,
  restitution: 0.55,
  friendlyFire: false,
  sprite: 'pill',
  trail: false,
};

/**
 * tones' tier 1: a pressurised water jet. Builds from a dribble to the full aimed arc over 2s,
 * holds briefly, then eases off. Water doesn't dig; it trickles damage onto whatever it soaks.
 */
export const ten1: WeaponDef = {
  id: 'ten-1',
  name: 'ten-1',
  shortName: 'ten-1',
  info:
    'A yellow water jet. The pressure builds in spurts over 2s, holds at full for a moment, then sputters out. Trickles damage onto anything it soaks; doesn’t dig.',
  kind: 'stream',
  blastRadius: 0,
  damage: 0,
  stream: { rampUp: 2, hold: 0.7, rampDown: 1.2, dropsPerSecond: 110, damagePerDrop: 0.35 },
  friendlyFire: false,
  colour: '#ffcc1f',
};

/**
 * kie's tier 3: two hologram copies of kie's tank appear across the battlefield. On later turns
 * kie can tap one to secretly swap places with it once his shot has landed. Anyone who hits a
 * hologram takes half the damage they would have dealt, and the hologram vanishes at turn end.
 */
export const trollogram: WeaponDef = {
  id: 'trollogram',
  name: 'Trollogram',
  shortName: 'Trollogram',
  info:
    'No aiming. 2 hologram copies of kie’s tank appear. On later turns, tap one to secretly swap places with it after you fire. Whoever hits a hologram takes half the damage themselves.',
  kind: 'decoy',
  decoys: 2,
  blastRadius: 0,
  damage: 0,
  colour: '#7cf7d4',
};

/**
 * tones' tier 2: the tank shakes for 10s, then blasts off jetpack-style along the aim (power sets
 * thrust) and flies to a new spot. Its exhaust is toxic dirt that piles up where it lands and
 * poisons enemy tanks it falls on.
 */
export const ten2: WeaponDef = {
  id: 'ten-2',
  name: 'ten-2',
  shortName: 'ten-2',
  info:
    'tones shakes for 10 seconds, then jetpacks off along your aim (power = thrust) to a new spot. The exhaust is a huge blast of toxic mud that piles up and poisons enemies it lands on.',
  kind: 'jetpack',
  blastRadius: 0,
  damage: 0,
  jetpack: {
    chargeTime: 10,
    thrust: 0.85,
    // A long, wide, heavy blast of mud that carpets the ground around the launch.
    burnTime: 1,
    particlesPerSecond: 900,
    exhaustSpeed: 260,
    exhaustSpeedRange: [0.35, 1.35],
    exhaustSpreadDeg: 43,
  },
  // Dark, wet mud: clearly different from the dry soil and grass it lands on.
  gunk: { dosePerParticle: 0.25, dosePerSecond: 12, deposit: [92, 62, 36], depositRadius: 2.2, look: 'mud' },
  friendlyFire: false,
  colour: '#9be22d',
};

/**
 * kie's tier 2: three weasels tumble out of the barrel at aim −4° / 0° / +4°. Each one that lands
 * scurries along the ground towards the nearest enemy and pops on contact, or when it runs out of steam.
 */
export const weaselPop: WeaponDef = {
  id: 'weasel-pop',
  name: 'Weasel Pop',
  shortName: 'Weasel Pop',
  info:
    '3 tumbling weasels at your aim and ±4°. Where they land they scurry towards the nearest enemy and pop on contact (up to 20 each), or after 2.5s.',
  blastRadius: 20,
  damage: 20,
  volley: { count: 3, spreadDeg: 4 },
  sprite: 'weasel',
  spin: 12,
  trail: false,
  walk: { speed: 40, duration: 2.5, climb: 6 },
};

/**
 * tones' tier 3: an incredibly powerful, short-range gush of chunky spew. Chunks that land on an
 * enemy coat it and burn through ~25 HP a second until the coating is gone; chunks that land on the
 * ground coat it in toxic sludge that burns any enemy touching it for the rest of the turn.
 */
export const ten3: WeaponDef = {
  id: 'ten-3',
  name: 'ten-3',
  shortName: 'ten-3',
  info:
    'An incredibly powerful short-range spew (about 200px). Coated enemies burn fast, and the chunks leave toxic sludge that burns anyone touching it for the rest of the turn. Get close.',
  kind: 'spew',
  blastRadius: 0,
  damage: 0,
  spew: { duration: 1.4, chunksPerSecond: 50, speed: 250, spreadDeg: 10 },
  gunk: {
    dosePerParticle: 1,
    dosePerSecond: 25,
    deposit: [190, 146, 58],
    depositRadius: 1.8,
    look: 'spew',
    // Every chunk that lands leaves toxic sludge that burns enemies for the rest of the turn.
    puddle: { radius: 7, damagePerSecond: 10, linger: 2.5 },
  },
  friendlyFire: false,
  colour: '#f0c050',
};

/**
 * torikloud's tier 2: pulses of disruptor sound radiate in arcs from the barrel, straight through
 * terrain. Close targets catch the whole arc; distant ones only a sliver. A kookaburra looks down
 * from the clouds as it fires. With a twin, where the two tanks' waves cross they phase together:
 * extra range and focused damage there.
 */
export const sonicBoom: WeaponDef = {
  id: 'sonic-boom',
  name: 'Sonic Boom',
  shortName: 'Sonic Boom',
  info:
    '4 waves of sound along your aim, straight through terrain without digging; power sets the range. Close targets catch the whole wave (12 each), far ones only a sliver. With Twins, crossing waves phase for ×1.5 damage and range.',
  kind: 'sonic',
  blastRadius: 0,
  damage: 0,
  sonic: { waves: 4, interval: 0.22, speed: 320, halfAngleDeg: 30, minRange: 150, maxRange: 500, damage: 12, refDistance: 80 },
  friendlyFire: false,
  colour: '#c9b6ff',
  apparition: 'kookaburra',
};

/** larinovsky's tier 1: indirect fire, a series of four pills lobbed along the aim that walk across the target. */
export const pillPusher: WeaponDef = {
  id: 'pill-pusher',
  name: 'Pill Pusher',
  shortName: 'Pill Pusher',
  info:
    'Indirect fire: 4 pills lobbed one after another along your aim, walking the blasts across the target. Up to 12 each.',
  blastRadius: 14,
  damage: 12,
  burst: { count: 4, interval: 0.15, powerJitter: 0.05 },
  sprite: 'pill',
  trail: false,
};

/**
 * larinovsky's tier 2: a spinning heart in shades. Its blast "cooks" any enemy it catches: on their
 * next turn everything they fire does half damage.
 */
export const theRizzler: WeaponDef = {
  id: 'the-rizzler',
  name: 'the Rizzler',
  shortName: 'the Rizzler',
  info:
    'A spinning heart in shades. Up to 18 damage, and enemies in the blast are cooked: everything they fire on their next turn does half damage.',
  blastRadius: 26,
  damage: 18,
  debuff: { offenceMultiplier: 0.5 },
  sprite: 'rizz',
  spin: 5,
  colour: '#ff6fb5',
};

/** larinovsky's tier 3: a quick nap, waking at full health. Takes the turn; no aiming. */
export const takeANap: WeaponDef = {
  id: 'take-a-nap',
  name: 'Take a Nap',
  shortName: 'Take a Nap',
  info:
    'No aiming. larinovsky dozes off for 2 seconds and wakes up at full health. Uses the turn.',
  kind: 'heal',
  blastRadius: 0,
  damage: 0,
  heal: { napTime: 2 },
  colour: '#7ee7a8',
};

/**
 * torikloud's tier 1: indirect fire of a random legal word, one letter at a time. Longer words mean
 * more letters, so more damage: it's the luck of the draw. A twin argues from social work instead.
 */
export const debate: WeaponDef = {
  id: 'debate',
  name: 'Debate',
  shortName: 'Debate',
  info:
    'Lobs a random legal word, one letter at a time; each letter is a small blast (up to 7). Longer words hit harder: the luck of the draw. A twin argues in social-work words.',
  blastRadius: 12,
  damage: 7,
  burst: { count: 1, interval: 0.12, powerJitter: 0.05 },
  words: { main: 'legal', twin: 'social-work', mainColour: '#ffd166', twinColour: '#7de2d1' },
  spin: 6,
  trail: false,
};

/** torikloud's tier 3: a twin tank appears and his HP is split between them; the twin mirrors his shots. */
export const twins: WeaponDef = {
  id: 'twins',
  name: 'Twins',
  shortName: 'Twins',
  info:
    'No aiming. A second tank appears and torikloud’s HP is split between the two. The twin copies every shot with the same aim and power. He’s out only when both are gone.',
  kind: 'twin',
  blastRadius: 0,
  damage: 0,
  colour: '#a78bfa',
};

/**
 * ciarra's tier 1: a buzzing stream of ink needles. Each is a tiny hit, and any tank it catches is
 * tattooed: +25% damage from everything until it has had two more turns.
 */
export const tattooGun: WeaponDef = {
  id: 'tattoo-gun',
  name: 'Tattoo Gun',
  shortName: 'Tattoo Gun',
  info:
    'A burst of 12 ink needles (up to 3 each). Any enemy hit is tattooed: they take +25% damage from everything until they’ve had 2 more turns.',
  blastRadius: 5,
  damage: 3,
  burst: { count: 12, interval: 0.05, powerJitter: 0.02 },
  tattoo: { multiplier: 1.25, turns: 2 },
  sprite: 'ink-needle',
  trail: false,
  colour: '#1e2a4a',
};

/** ciarra's tier 2: needle and thread zig-zag through anything; stitched enemies are pinned for a turn. */
export const sew: WeaponDef = {
  id: 'sew',
  name: 'Sew',
  shortName: 'Sew',
  info:
    'A needle and thread stitch straight along your aim, through terrain without digging; power sets how far. Enemies stitched take 20 and are pinned: they can’t move on their next turn.',
  kind: 'sew',
  blastRadius: 0,
  damage: 0,
  sew: { speed: 520, minRange: 200, maxRange: 700, amplitude: 7, wavelength: 56, damage: 20 },
  colour: '#f472b6',
};

/** ciarra's tier 3: a marathon runner who jogs a leg every time anyone fires, and hits hard on arrival. */
export const marathon: WeaponDef = {
  id: 'marathon',
  name: 'Marathon',
  shortName: 'Marathon',
  info:
    'No aiming. A runner sets off towards the nearest enemy and runs a leg every time anyone fires, over any hill. At the finish: a 50 damage blast. A blast near the runner means a DNF.',
  kind: 'runner',
  blastRadius: 0,
  damage: 0,
  runner: { speed: 85, leg: 150, damage: 50, radius: 30 },
  colour: '#f472b6',
};

const weapons: WeaponDef[] = [
  shell,
  doublePark,
  hyperfixate,
  unmedicated,
  ten1,
  trollogram,
  ten2,
  weaselPop,
  ten3,
  sonicBoom,
  pillPusher,
  theRizzler,
  takeANap,
  debate,
  twins,
  tattooGun,
  sew,
  marathon,
];

const byId = new Map(weapons.map((w) => [w.id, w]));

export function getWeapon(id: string): WeaponDef {
  const w = byId.get(id);
  if (!w) throw new Error(`Unknown weapon: ${id}`);
  return w;
}

/** Weapons that don't use the aim at all: just press FIRE. */
export function ignoresAim(w: WeaponDef): boolean {
  const kind = w.kind ?? 'ballistic';
  return kind === 'rain' || kind === 'decoy' || kind === 'heal' || kind === 'twin' || kind === 'runner';
}

export function allWeapons(): readonly WeaponDef[] {
  return weapons;
}

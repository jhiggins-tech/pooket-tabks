import type { WeaponDef } from '../../weapons/types';
import { kit } from '../kit';

/**
 * tones' tier 1: a pressurised water jet. Builds from a dribble to the full aimed arc over 2s,
 * holds briefly, then eases off. Water doesn't dig; it trickles damage onto whatever it soaks.
 * Point-blank it splashes back (game/stream.ts): harmless, but it knocks the aim off and kills the pressure.
 */
export const ten1 = {
  id: 'ten-1',
  name: 'ten-1',
  shortName: 'ten-1',
  info:
    'A yellow water jet. The pressure builds in spurts over 2s, holds at full for a moment, then sputters out. While it’s weak it sprays all over and barely stings; the full-pressure jet is a clean line that does the real damage. Trickles damage onto anything it soaks; doesn’t dig. Miss completely and you get the round back. Point-blank (the nearest enemy within 4 tank-widths when you fire), once the jet has done 5 damage to them it splashes back onto you: it doesn’t hurt, but it knocks your aim off and the pressure dies away.',
  kind: 'stream',
  stream: { rampUp: 2, hold: 0.7, rampDown: 1.2, dropsPerSecond: 110, damagePerDrop: 0.35, spray: 40, speedSpread: 0.35 },
  refundOnMiss: true,
  friendlyFire: false,
  colour: '#ffcc1f',
} satisfies WeaponDef;

/**
 * tones' tier 2: the tank shakes for 10s, then blasts off jetpack-style along the aim (power sets
 * thrust) and flies to a new spot. Its exhaust is toxic dirt that piles up where it lands and
 * poisons enemy tanks it falls on.
 */
export const ten2 = {
  id: 'ten-2',
  name: 'ten-2',
  shortName: 'ten-2',
  info:
    'tones2 shakes for 10 seconds, then jetpacks off along your aim (power = thrust) to a new spot. The exhaust is a huge blast of toxic mud that piles up and poisons enemies it lands on.',
  kind: 'jetpack',
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
} satisfies WeaponDef;

/**
 * tones' tier 3: an incredibly powerful, short-range gush of chunky spew. Chunks that land on an
 * enemy coat it and burn through ~25 HP a second until the coating is gone; chunks that land on the
 * ground coat it in toxic sludge that burns any enemy touching it for the rest of the turn.
 * Best case ~90–98 at 70–100px: deliberately just short of a one-shot.
 */
export const ten3 = {
  id: 'ten-3',
  name: 'ten-3',
  shortName: 'ten-3',
  info:
    'An incredibly powerful short-range spew (about 200px). Coated enemies burn fast, and the chunks leave toxic sludge that burns anyone touching it for the rest of the turn. Get close.',
  kind: 'spew',
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
} satisfies WeaponDef;

export const tones = kit(
  {
    id: 'tones',
    name: 'tones2', // (renamed from tones; the id stays, for saved picks and matches)
    blurb: 'ten-1 water jet, ten-2 mud jetpack and the ten-3 spew.',
    colours: ['#ff5a5f', '#ff8c42', '#ff7eb6'],
  },
  [ten1, ten2, ten3],
);

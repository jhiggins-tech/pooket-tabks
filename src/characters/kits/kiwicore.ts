import type { WeaponDef } from '../../weapons/types';
import { kit } from '../kit';

/**
 * kiwicore, in beta: the béretta M2 is his real tier 1 (his flat cap, thrown like a boomerang:
 * game/boomerang.ts; he wears it when it isn't flying); tier 2 is Band
 * Aid, a rhythm minigame that heals (game/drums.ts); tier 3 is Long Exposure, a camera sim
 * (game/camera.ts, its tables in weapons/camera.ts).
 */

/** Tier 1: the flat cap off his head, out along the aim and round and home, through hills. */
export const berettaM2 = {
  id: 'beretta-m2',
  name: 'béretta M2',
  shortName: 'béretta M2',
  info:
    'Throw your flat cap like a boomerang: it flies through hills, out along your aim (power sets how far) and curls round and back to you. 20 damage to each enemy it passes through, on the way out and again on the way back: up to 40 if both passes catch them. You catch it, no harm done.',
  kind: 'boomerang',
  boomerang: { minRange: 100, maxRange: 900, curl: 0.3, flight: 0.3, damage: 20 },
  colour: '#8a7a5c',
} satisfies WeaponDef;

/**
 * Tier 2: a rhythm minigame (game/drums.ts). A drum kit round the tank and a drumstick out of the barrel;
 * tap on the beat through a four-bar chiptune thrasher and every hit heals. 24 notes after a bar's
 * count-in, alternately on the left and right drum: a quarter-note bar, two with bursts of quavers, and a
 * flat-out quaver fill. Perfect within 70 ms, close within 150 (half as good); three misses and it's over.
 * A flawless run gives back 40% of his full health.
 */
export const bandAid = {
  id: 'band-aid',
  name: 'Band Aid',
  shortName: 'Band Aid',
  info:
    'A drum kit appears round your tank, a drumstick comes out of the barrel, and a chiptune thrasher kicks in. Tap anywhere on the beat as the notes reach the line above you (the stick plays the drums left and right): every hit heals, perfect ones twice as much as close ones, up to 40% of your health for a flawless run. Three missed beats (or taps off the beat) and the band packs up.',
  kind: 'drum',
  drum: {
    bpm: 180,
    countIn: 4,
    notes: [0, 2, 4, 6, 7, 8, 10, 12, 13, 14, 15, 16, 18, 19, 20, 22, 24, 25, 26, 27, 28, 29, 30, 31],
    perfect: 0.07,
    close: 0.15,
    maxHeal: 0.4,
    misses: 3,
    tune: 'band-aid',
  },
  colour: '#86efac',
} satisfies WeaponDef;

/**
 * Tier 3: a camera (game/camera.ts). Three shots on the card, 20 s each, the camera scrambled to start;
 * the best photo does 10 to 70 (77 for a Perfect Shot, in M: the easier modes cap it), and a flash photo
 * blinds them for their next turn.
 */
export const longExposure = {
  id: 'long-exposure',
  name: 'Long Exposure',
  shortName: 'Long Exposure',
  info:
    'Raise the camera: the screen becomes its viewfinder, and it starts in a mess. Find the enemy, then get the shot under control with real controls: the mode dial, aperture and shutter on the two dials, ISO and white balance, three lenses, the flash, and the focus ring (or AF-ON). Three shots on the card, 20 seconds each (at zero it fires itself). The best photo lands: 10 for anything with an enemy in it, up to 70 for a sharp, well exposed, true-coloured shot on a rule-of-thirds point, 77 for a Perfect Shot. P, Tv and Av do some of it for you, but cap it (35, 60, 60). A flash photo blinds them: no aim guide on their next turn.',
  kind: 'camera',
  camera: { shots: 3, shotTime: 20, floor: 10, range: 60, perfect: 7 },
  colour: '#f5f5f4',
} satisfies WeaponDef;

export const kiwicore = kit(
  {
    id: 'kiwicore',
    name: 'kiwicore',
    blurb: 'Beta: the béretta M2, a flat cap thrown like a boomerang; Band Aid, drumming on the beat to heal; and Long Exposure, a camera and three shots to get the perfect one.',
    colours: ['#84cc16', '#a3e635', '#65a30d'],
    hat: 'flat-cap',
    beta: true,
  },
  [berettaM2, bandAid, longExposure],
);

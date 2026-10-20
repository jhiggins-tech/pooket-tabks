import type { Sfx, SfxCue } from '../game/state';
import { boomerangFlight, boomerangReach } from '../game/boomerang';
import { findWeapon, isProjectileWeapon, kindOf, weaponOf } from '../weapons/registry';
import type { TuneId } from '../weapons/types';
import { arp, midi, type Synth } from './chip';
import type { Jingle, Rank } from '../stats/ranks';
import { rankJingle } from './jingle';
import { strikeBeat } from './strike';
import { TunePlayer } from './tunes';
import { XP_SOUNDS, type XpCue } from './xp';
import { TYPE_RATE } from '../weapons/comms';

/** The rank-up jingle (jingle.ts), played by `SfxPlayer.jingle`. */
export { rankJingle };

/**
 * Kitschy 8-bit sound effects. Every weapon has a firing sound (`FIRE_SOUNDS`), burst weapons blip on
 * each round (`ROUND_SOUNDS`), and game events have their own (`CUE_SOUNDS`: the general ones first, then
 * each mechanic's). All synthesised. A rank-up's jingle: jingle.ts.
 */
type Recipe = (s: Synth, e: Sfx) => void;

/** Classic "pew": a stepped downward sweep. */
function pew(s: Synth, at = 0, from = 1400, to = 180, vol = 0.18): void {
  s.tone({ at, dur: 0.22, from, to, duty: 0.25, steps: 10, vol });
}

export const FIRE_SOUNDS: Record<string, Recipe> = {
  shell: (s) => {
    pew(s);
    s.noise({ dur: 0.08, rate: 0.6, vol: 0.15 });
  },
  'activate-digger': (s) => {
    s.noise({ dur: 0.22, rate: 0.35, to: 0.8, vol: 0.16 });
    s.tone({ at: 0.08, dur: 0.25, from: 90, to: 190, duty: 0.5, vol: 0.14 });
    s.tone({ at: 0.28, dur: 0.12, from: 620, to: 230, duty: 0.25, vol: 0.1 });
  },
  // A thin little pop.
  pistol: (s) => {
    s.tone({ dur: 0.08, from: 1800, to: 600, duty: 0.25, steps: 6, vol: 0.12 });
    s.noise({ dur: 0.04, rate: 1.2, vol: 0.1 });
  },
  // The beacon's thrown: a chunky clack.
  stratagem: (s) => {
    s.noise({ dur: 0.05, rate: 1, vol: 0.16 });
    s.tone({ at: 0.04, dur: 0.1, from: 900, to: 300, duty: 0.5, vol: 0.1 });
  },
  // A rocket pod's whoosh (each missile has its blip: ROUND_SOUNDS).
  wasp: (s) => s.noise({ dur: 0.35, rate: 0.5, to: 1.4, vol: 0.12 }),
  // A heavy launch: a thump, then a rising roar.
  spear: (s) => {
    s.tone({ dur: 0.12, from: 160, to: 60, duty: 0.5, vol: 0.18 });
    s.noise({ at: 0.05, dur: 0.6, rate: 0.35, to: 1, vol: 0.16 });
  },
  // A charge-up whine and a ZAP.
  quasar: (s) => {
    s.tone({ dur: 0.35, from: 300, to: 2400, duty: 0.125, vol: 0.09 });
    s.tone({ at: 0.35, dur: 0.18, from: 2600, to: 400, duty: 0.5, vol: 0.15 });
  },
  // A hollow bloop.
  'grenade-pistol': (s) => s.tone({ dur: 0.14, from: 260, to: 520, duty: 0.5, vol: 0.15 }),
  // Brrrrt.
  smg: (s) => {
    for (let i = 0; i < 5; i++) s.tone({ at: i * 0.05, dur: 0.035, from: 1300 - i * 60, to: 500, duty: 0.25, vol: 0.1 });
  },
  // (What his stratagems hit with fire from no gun of his: their sounds are cues, in CUE_SOUNDS.)
  'stratagem-beacon': (s) => s.tone({ dur: 0.05, from: 1500, duty: 0.125, vol: 0.06 }),
  'orbital-laser': (s) => s.tone({ dur: 0.05, from: 1200, duty: 0.125, vol: 0.06 }),
  railcannon: (s) => s.tone({ dur: 0.05, from: 900, duty: 0.125, vol: 0.06 }),
  'sentry-rocket': (s) => s.noise({ dur: 0.2, rate: 0.5, to: 1.2, vol: 0.1 }),
  'autocannon-shell': (s) => s.tone({ dur: 0.08, from: 400, to: 120, duty: 0.5, vol: 0.12 }),
  'tesla-zap': (s) => s.tone({ dur: 0.1, from: 3000, duty: 0.125, vibrato: [60, 400], vol: 0.08 }),
  'supply-pod': (s) => s.noise({ dur: 0.1, rate: 0.7, vol: 0.1 }),
  // A bunker-alarm klaxon, twice (the drill and the bricks have their own: CUE_SOUNDS).
  prepper: (s) => {
    for (const at of [0, 0.2]) s.tone({ at, dur: 0.16, from: 520, to: 380, duty: 0.5, vol: 0.1 });
  },
  // An ice cream van jingle, badly.
  'double-park': (s) => {
    arp(s, [76, 79, 81, 83, 81, 79, 76, 72], 0.075, { duty: 0.125, vol: 0.13 });
    s.tone({ dur: 0.09, from: 500, to: 950, duty: 0.5, vol: 0.12 });
    s.tone({ at: 0.1, dur: 0.09, from: 520, to: 990, duty: 0.5, vol: 0.12 });
  },
  // PEW then a buzzing, fixated zzzzz.
  hyperfixate: (s) => {
    s.tone({ dur: 0.1, from: 150, to: 2400, duty: 0.5, vol: 0.15 });
    s.tone({ at: 0.1, dur: 0.45, from: 2200, duty: 0.125, vibrato: [32, 140], vol: 0.12 });
  },
  // A maraca rattle of pills, then a wheee.
  unmedicated: (s) => {
    for (let i = 0; i < 16; i++) s.tone({ at: i * 0.045, dur: 0.03, from: 1500 + ((i * 373) % 1500), duty: 0.125, vol: 0.08 });
    s.tone({ at: 0.2, dur: 1.1, from: 1900, to: 260, wave: 'triangle', vibrato: [9, 40], vol: 0.18 });
  },
  // Hissing water with a gurgle, swelling and sputtering like the jet itself.
  'ten-1': (s) => {
    const st = weaponOf('ten-1', 'stream').stream;
    const dur = st.rampUp + st.hold + st.rampDown;
    const up = st.rampUp / dur;
    const hold = (st.rampUp + st.hold) / dur;
    const env: [number, number][] = [[0.02, 0.1], [up * 0.4, 0.5], [up * 0.6, 0.35], [up, 1], [hold, 1], [hold + 0.1, 0.4], [hold + 0.18, 0.7], [1, 0]];
    s.noise({ dur, rate: 0.9, vol: 0.12, env });
    s.tone({ dur, from: 95, duty: 0.125, vibrato: [7, 30], vol: 0.07, env });
  },
  // Putt-putt engine revving up for the whole charge (launch has its own sound).
  'ten-2': (s) => {
    const charge = weaponOf('ten-2', 'jetpack').jetpack.chargeTime;
    let t = 0;
    for (let i = 0; t < charge; i++) {
      const k = t / charge;
      s.noise({ at: t, dur: 0.05, rate: 0.25 + k * 0.6, vol: 0.05 + k * 0.08 });
      s.tone({ at: t, dur: 0.05, from: 55 + k * 90, duty: 0.5, vol: 0.05 + k * 0.05 });
      t += 0.26 - k * 0.2;
    }
  },
  // BLEURGH.
  'ten-3': (s) => {
    const dur = weaponOf('ten-3', 'spew').spew.duration;
    s.tone({ dur, from: 240, to: 65, duty: 0.125, vibrato: [17, 35], vol: 0.2 });
    s.noise({ dur, rate: 0.22, to: 0.12, vol: 0.14 });
  },
  // Spooky theremin woo, with sparkles.
  trollogram: (s) => {
    s.tone({ dur: 1.1, from: 380, to: 720, wave: 'triangle', vibrato: [6, 28], vol: 0.18, env: [[0.2, 1], [0.7, 0.8], [1, 0]] });
    arp(s, [96, 100, 103, 108, 103, 108], 0.06, { at: 0.15, duty: 0.125, vol: 0.07 });
  },
  // Boing boing boing.
  'weasel-pop': (s) => {
    for (let i = 0; i < 3; i++) s.tone({ at: i * 0.08, dur: 0.12, from: 280 + i * 60, to: 950 + i * 120, duty: 0.25, steps: 6, vol: 0.14 });
  },
  // WUB WUB WUB WUB, then the kookaburra has its own cue.
  'sonic-boom': (s) => {
    const sp = weaponOf('sonic-boom', 'sonic').sonic;
    for (let i = 0; i < sp.waves; i++) {
      s.tone({ at: i * sp.interval, dur: 0.2, from: 190, to: 48, duty: 0.5, vol: 0.26 });
      s.noise({ at: i * sp.interval, dur: 0.06, rate: 0.3, vol: 0.08 });
    }
  },
  // Pump-action chk-chk; the pills pip per round.
  'pill-pusher': (s) => {
    s.noise({ dur: 0.04, rate: 1.4, vol: 0.12 });
    s.noise({ at: 0.07, dur: 0.05, rate: 1.1, vol: 0.12 });
  },
  // Slide whistle up, then a wolf whistle.
  'the-rizzler': (s) => {
    s.tone({ dur: 0.35, from: 450, to: 1500, wave: 'triangle', vol: 0.17 });
    s.tone({ at: 0.45, dur: 0.14, from: 900, to: 2100, wave: 'triangle', vol: 0.15 });
    s.tone({ at: 0.66, dur: 0.4, from: 1300, to: 650, wave: 'triangle', vol: 0.15, env: [[0.1, 1], [0.35, 0.9], [1, 0]] });
  },
  // A long snore (the wake-up has its own cue).
  'take-a-nap': (s) => {
    for (const at of [0, 0.95]) {
      s.noise({ at, dur: 0.55, rate: 0.12, vol: 0.12, env: [[0.5, 1], [1, 0]] });
      s.tone({ at, dur: 0.55, from: 70, to: 58, duty: 0.125, vol: 0.08, env: [[0.5, 1], [1, 0]] });
      s.tone({ at: at + 0.6, dur: 0.25, from: 900, to: 1400, wave: 'triangle', vol: 0.06 });
    }
  },
  // A sly two-note "ooh-la-la" wolf whistle, then a sparkle.
  'women-in-scam': (s) => {
    s.tone({ dur: 0.18, from: 900, to: 1700, wave: 'triangle', vol: 0.09 });
    s.tone({ at: 0.22, dur: 0.32, from: 1500, to: 700, wave: 'triangle', vol: 0.09 });
    arp(s, [91, 95, 98], 0.05, { at: 0.5, duty: 0.25, vol: 0.08 });
  },
  // Order! Gavel taps, then each letter clacks like a typewriter.
  debate: (s) => {
    for (const at of [0, 0.13]) {
      s.tone({ at, dur: 0.05, from: 190, to: 120, duty: 0.5, vol: 0.2 });
      s.noise({ at, dur: 0.03, rate: 1.3, vol: 0.1 });
    }
  },
  // Ba-ding! In harmony, like twins would.
  twins: (s) => {
    arp(s, [76, 83], 0.12, { duty: 0.25, vol: 0.12, dur: 0.3 });
    arp(s, [72, 79], 0.12, { duty: 0.125, vol: 0.1, dur: 0.3 });
    arp(s, [88, 91, 96], 0.07, { at: 0.3, duty: 0.125, vol: 0.08 });
  },
  // The needle buzz is per round; this is the machine spinning up.
  'tattoo-gun': (s) => {
    s.tone({ dur: 0.15, from: 60, to: 120, duty: 0.125, vol: 0.12 });
  },
  // A sewing machine: zip-zip-zip for as long as it sews.
  sew: (s, e) => {
    const spec = weaponOf('sew', 'sew').sew;
    const dur = (spec.minRange + (spec.maxRange - spec.minRange) * ((e.size ?? 50) / 100)) / spec.speed;
    for (let t = 0, i = 0; t < dur; t += 0.05, i++) s.tone({ at: t, dur: 0.025, from: i % 2 ? 900 : 1250, duty: 0.125, vol: 0.08 });
  },
  // Starter's pistol and a lame fanfare.
  marathon: (s) => {
    s.noise({ dur: 0.14, rate: 1.2, to: 0.4, vol: 0.3 });
    arp(s, [60, 65, 67, 69, 67, 64, 65], 0.13, { at: 0.25, duty: 0.25, vol: 0.12 });
  },
  // Sneaky tiptoe (pizzicato, descending); the roulette ticks separately.
  steal: (s) => {
    arp(s, [71, 70, 69, 68, 67], 0.1, { duty: 0.125, vol: 0.13, dur: 0.05 });
  },
  // Mr Bean: a burr grinder whirring up (the beans rattle out per round).
  'mr-bean': (s) => {
    s.noise({ dur: 0.3, rate: 0.9, to: 1.5, vol: 0.09 });
    s.tone({ dur: 0.3, from: 160, to: 260, duty: 0.125, vibrato: [40, 30], vol: 0.07 });
  },
  // Hoop Dreamz: a sneaker squeak, and the ball thrown up with a hopeful "whoo".
  'hoop-dreamz': (s) => {
    s.tone({ dur: 0.07, from: 2600, to: 3200, duty: 0.125, vol: 0.07 });
    s.tone({ at: 0.08, dur: 0.06, from: 3000, to: 2400, duty: 0.125, vol: 0.06 });
    s.tone({ at: 0.12, dur: 0.3, from: 400, to: 900, wave: 'triangle', vol: 0.12 });
  },
  // 007, answered: a pistol cocked, click-clack (the right or wrong answer has its own sound).
  'double-o-seven': (s) => {
    s.noise({ dur: 0.025, rate: 1.8, vol: 0.14 });
    s.tone({ dur: 0.02, from: 2400, duty: 0.125, vol: 0.06 });
    s.noise({ at: 0.12, dur: 0.035, rate: 1.4, vol: 0.16 });
    s.tone({ at: 0.12, dur: 0.03, from: 1600, duty: 0.125, vol: 0.07 });
  },
  // kiwicore's béretta M2: the cap whup-whup-whupping round its loop (loud near him, faint far out), for as long as it flies.
  'beretta-m2': (s, e) => {
    const spec = weaponOf('beretta-m2', 'boomerang').boomerang;
    const dur = boomerangFlight(spec, boomerangReach(spec, e.size ?? 50));
    for (let t = 0; t < dur - 0.05; t += 0.11) {
      const near = 0.4 + 0.6 * Math.abs(Math.cos((Math.PI * t) / dur));
      s.tone({ at: t, dur: 0.07, from: 260, to: 520, wave: 'triangle', vol: 0.11 * near });
    }
  },
  // kiwicore's Band Aid is fired when the track's over: a big crash cymbal and a power chord to finish.
  'band-aid': (s) => {
    s.noise({ dur: 1.1, rate: 1.7, to: 0.4, vol: 0.16, env: [[0, 1], [1, 0]] });
    for (const n of [52, 59, 64]) s.tone({ dur: 0.7, from: midi(n), duty: 0.125, vibrato: [7, 6], vol: 0.07, env: [[0, 1], [0.6, 0.6], [1, 0]] });
  },
  // kiwicore's stand-in shot (beta): a big plain boom.
  'kiwi-bomb': (s) => {
    s.tone({ dur: 0.35, from: 900, to: 90, duty: 0.5, steps: 14, vol: 0.18 });
    s.noise({ dur: 0.22, rate: 0.3, vol: 0.22 });
  },
  // Calculated: a plasma lob, a warbling sci-fi throb, and the tracers' thin zips either side.
  calculated: (s) => {
    s.tone({ dur: 0.28, from: 520, to: 180, duty: 0.5, vibrato: [28, 40], vol: 0.13 });
    s.noise({ dur: 0.08, rate: 0.6, vol: 0.08 });
    for (let i = 0; i < 3; i++) s.tone({ at: 0.03 + i * 0.04, dur: 0.07, from: 3200 - i * 300, to: 1800, duty: 0.125, vol: 0.04 });
  },
  // Who's That Pokémon? is put up with its own cue (`pokemon`); fired, the answer's sound says how it went.
  'whos-that-pokemon': (s) => s.tone({ dur: 0.05, from: 1800, duty: 0.25, vol: 0.06 }),
  // Air Strike: calling it in, a radio click and a crackle.
  'air-strike': (s) => {
    s.tone({ dur: 0.03, from: 2600, duty: 0.5, vol: 0.08 });
    s.noise({ at: 0.03, dur: 0.25, rate: 1.6, to: 1.1, vol: 0.06 });
    s.tone({ at: 0.28, dur: 0.03, from: 2000, duty: 0.5, vol: 0.06 });
  },
  // Sly is fired when the sneaking's over: tiptoes fading away.
  sly: (s) => {
    arp(s, [72, 74, 72, 74], 0.12, { duty: 0.125, vol: 0.06, dur: 0.05 });
  },
  // Diced Coffee: ice rattling in the cup as the spinner starts.
  'diced-coffee': (s) => {
    for (let i = 0; i < 7; i++) s.tone({ at: i * 0.05, dur: 0.03, from: 2200 + ((i * 557) % 900), wave: 'triangle', vol: 0.08 });
    s.tone({ at: 0.35, dur: 0.25, from: 300, to: 900, duty: 0.125, vol: 0.08 });
  },
};

/**
 * 007's spy sting (an original, not any film's theme), played in the rank-up jingles' notation (score.ts):
 * a brassy call climbing over an octave-jumping bass vamp in E minor, sliding down chromatically, and
 * landing on the spy chord, E minor with a major seventh, held under a long F# (the ninth). Two bars at
 * 150 bpm: 3.2 s, the time the gun barrel stays open (game/bond.ts `BARREL`).
 */
export const BOND_STING: Jingle = {
  bpm: 150,
  voice: 'reed',
  lead: 'r:4 b4:2 e5:1 g5:3 b5:2 a#5:2 a5:4 g5:2 f#5:12',
  bass: 'e2:2 e3 e2 e3 c2 c3 b1 b2 e2:16',
  harmony: 'r:16 e4+g4+b4+d#5:16',
  drums: 'k:2 h s h k h s:1 s s s c:16',
  minor: true,
};

/** Per-round blips for burst weapons. */
export const ROUND_SOUNDS: Record<string, Recipe> = {
  // Each little missile: a fizzing pfft.
  wasp: (s) => s.noise({ dur: 0.07, rate: 1.2, to: 0.6, vol: 0.1 }),
  'pill-pusher': (s) => s.tone({ dur: 0.07, from: 1500, to: 700, duty: 0.25, vol: 0.12 }),
  // Typewriter clack.
  debate: (s) => {
    s.noise({ dur: 0.02, rate: 1.6, vol: 0.14 });
    s.tone({ dur: 0.02, from: 2100, duty: 0.125, vol: 0.06 });
  },
  // Bzzt.
  'tattoo-gun': (s) => s.tone({ dur: 0.045, from: 118, duty: 0.125, vol: 0.14 }),
  // A bean rattling out: a dry little tick.
  'mr-bean': (s) => {
    s.noise({ dur: 0.02, rate: 1.5, vol: 0.1 });
    s.tone({ dur: 0.02, from: 1900, to: 1400, duty: 0.125, vol: 0.05 });
  },
};

export const CUE_SOUNDS: Record<Exclude<SfxCue, 'fire' | 'round' | 'tune'>, Recipe> = {
  // ---- Every match: blasts, hits, a refunded round, the end. ----
  // Crunchy noise explosion, bigger blasts longer and lower; tiny ones just pop.
  boom: (s, e) => {
    const r = e.size ?? 20;
    if (r < 13) {
      s.tone({ dur: 0.05, from: 950, to: 300, duty: 0.25, vol: 0.07 });
      s.noise({ dur: 0.05, rate: 0.9, vol: 0.06 });
      return;
    }
    const dur = 0.18 + r / 70;
    s.noise({ dur, rate: 0.8, to: 0.12, vol: Math.min(0.45, 0.12 + r / 90) });
    s.tone({ dur: dur * 0.6, from: 130, to: 40, duty: 0.5, steps: 6, vol: 0.2 });
  },
  // "Oof".
  hit: (s, e) => {
    const big = (e.size ?? 5) >= 15;
    s.tone({ dur: big ? 0.2 : 0.1, from: big ? 520 : 700, to: big ? 160 : 380, duty: 0.25, steps: 4, vol: big ? 0.14 : 0.07 });
  },
  refund: (s) => {
    s.tone({ dur: 0.07, from: midi(83), duty: 0.5, vol: 0.14 });
    s.tone({ at: 0.07, dur: 0.35, from: midi(88), duty: 0.5, vol: 0.14 });
  },
  refuel: (s) => {
    s.noise({ dur: 0.18, rate: 0.6, to: 0.2, vol: 0.06 });
    arp(s, [60, 67, 72, 79], 0.08, { at: 0.12, duty: 0.25, vol: 0.1 });
  },
  // Victory!
  gameover: (s) => {
    arp(s, [72, 76, 79, 84], 0.11, { duty: 0.25, vol: 0.15 });
    arp(s, [79, 84], 0.18, { at: 0.5, duty: 0.25, vol: 0.15, dur: 0.16 });
    s.tone({ at: 0.9, dur: 0.7, from: midi(88), duty: 0.25, vibrato: [6, 10], vol: 0.15 });
  },
  // ---- Statuses (game/statuses.ts). ----
  // Sizzle and a ding.
  cook: (s) => {
    s.noise({ dur: 0.5, rate: 2, vol: 0.08 });
    s.tone({ at: 0.3, dur: 0.3, from: midi(91), wave: 'triangle', vol: 0.12 });
  },
  tattoo: (s) => arp(s, [96, 103], 0.05, { duty: 0.125, vol: 0.08 }),
  pin: (s) => {
    s.tone({ dur: 0.08, from: 1600, to: 500, duty: 0.5, vol: 0.14 });
    s.tone({ at: 0.09, dur: 0.06, from: 700, duty: 0.125, vol: 0.1 });
  },
  // ---- Getting about (game/movement.ts): ciarra's hops, garyoldmancorp's scooter, doctorfox's Arwing. ----
  // Boing (frog hop).
  hop: (s) => {
    s.tone({ dur: 0.11, from: 240, to: 760, duty: 0.25, vol: 0.1 });
    s.tone({ at: 0.11, dur: 0.07, from: 760, to: 520, duty: 0.25, vol: 0.06 });
  },
  // garyoldmancorp's scooter: a little two-stroke putt while it rides (one cue a frame, spaced out by MIN_GAP).
  scoot: (s) => {
    s.tone({ dur: 0.06, from: 210, to: 260, duty: 0.25, vol: 0.05 });
    s.noise({ dur: 0.04, rate: 0.5, vol: 0.03 });
  },
  digger: (s) => {
    s.noise({ dur: 0.18, rate: 0.42, to: 0.18, vol: 0.24 });
    s.tone({ dur: 0.16, from: 58, to: 92, duty: 0.5, vibrato: [18, 12], vol: 0.2 });
    s.tone({ at: 0.02, dur: 0.13, from: 210, to: 95, duty: 0.25, steps: 5, vol: 0.12 });
    s.noise({ at: 0.09, dur: 0.09, rate: 1.1, vol: 0.16 });
  },
  // Scooter crash: a clang, a rattle, and a little boing of the bell.
  crash: (s) => {
    s.noise({ dur: 0.25, rate: 0.7, to: 0.2, vol: 0.18 });
    s.tone({ dur: 0.18, from: 900, to: 300, duty: 0.5, steps: 6, vol: 0.12 });
    s.tone({ at: 0.2, dur: 0.25, from: midi(88), wave: 'triangle', vibrato: [12, 30], vol: 0.08 });
  },
  // Arwing takeoff: a rising jet whoosh and a "transform!" chirp up the scale.
  'arwing-up': (s) => {
    s.noise({ dur: 0.4, rate: 0.3, to: 1.2, vol: 0.1 });
    s.tone({ dur: 0.35, from: 180, to: 900, duty: 0.25, vol: 0.06 });
    arp(s, [72, 76, 79, 84], 0.05, { at: 0.12, duty: 0.125, vol: 0.07 });
  },
  // The Arwing flying: a thin jet whine (one cue a frame, spaced out by MIN_GAP).
  arwing: (s) => {
    s.tone({ dur: 0.1, from: 1180, to: 1240, duty: 0.125, vol: 0.025 });
    s.noise({ dur: 0.08, rate: 1.4, vol: 0.02 });
  },
  // Landing: the whoosh winding down and the chirp back down the scale, then a soft thud.
  'arwing-down': (s) => {
    s.noise({ dur: 0.4, rate: 1.2, to: 0.3, vol: 0.09 });
    arp(s, [84, 79, 76, 72], 0.05, { duty: 0.125, vol: 0.07 });
    s.tone({ at: 0.4, dur: 0.08, from: 140, to: 60, duty: 0.5, vol: 0.12 });
  },
  // ---- Band Aid (game/drums.ts). ----
  // A hit: the left drum's a snare (crack), the right a floor tom (doom).
  drum: (s, e) => {
    if ((e.size ?? -1) < 0) {
      s.noise({ dur: 0.13, rate: 1.3, to: 0.6, vol: 0.24 });
      s.tone({ dur: 0.05, from: 260, to: 180, duty: 0.5, vol: 0.1 });
    } else {
      s.tone({ dur: 0.2, from: 170, to: 80, duty: 0.5, steps: 6, vol: 0.22 });
      s.noise({ dur: 0.05, rate: 0.5, vol: 0.12 });
    }
  },
  // A miss: the stick clacks the rim.
  whiff: (s) => s.tone({ dur: 0.04, from: 1900, to: 1500, duty: 0.125, vol: 0.06 }),
  // ---- béretta M2 (game/boomerang.ts). ----
  // Caught! A thwap of cloth, and a cheery "ta-da".
  catch: (s) => {
    s.noise({ dur: 0.05, rate: 1.4, vol: 0.12 });
    arp(s, [79, 84], 0.09, { at: 0.06, duty: 0.25, vol: 0.12, dur: 0.14 });
  },
  // ---- Hoop Dreamz (game/hoop.ts). ----
  // Nothing but net: a soft swish, then the crowd's "ohhh!" rising into the slam.
  swish: (s) => {
    s.noise({ dur: 0.18, rate: 1.6, to: 0.8, vol: 0.12 });
    s.tone({ at: 0.1, dur: 0.35, from: 300, to: 1100, duty: 0.5, steps: 10, vol: 0.12 });
  },
  // Off the rim (or the backboard): a hollow metal clank and its ring.
  clank: (s) => {
    s.tone({ dur: 0.05, from: 1300, to: 900, duty: 0.5, vol: 0.12 });
    s.tone({ at: 0.03, dur: 0.3, from: 1650, wave: 'triangle', vibrato: [22, 20], vol: 0.07, env: [[0.1, 1], [1, 0]] });
  },
  // A bounce: a rubbery thud, louder the faster it's going.
  dribble: (s, e) => {
    const k = Math.min(1, (e.size ?? 200) / 400);
    s.tone({ dur: 0.08, from: 150 + 60 * k, to: 70, duty: 0.5, steps: 4, vol: 0.06 + 0.1 * k });
  },
  // ---- Sly (game/sly.ts). ----
  // The smoke bomb: a pop, a long hiss of smoke, and a sly little "hm-hm" down the scale.
  smoke: (s) => {
    s.tone({ dur: 0.06, from: 700, to: 160, duty: 0.5, vol: 0.14 });
    s.noise({ dur: 1.3, rate: 1.1, vol: 0.13, env: [[0.05, 1], [0.4, 0.7], [1, 0]] });
    arp(s, [67, 63, 60], 0.14, { at: 0.35, duty: 0.125, vol: 0.09, dur: 0.1 });
  },
  // Stealth powerup activated: a rising video-game power-up arpeggio, quiet (it's sneaky).
  stealth: (s) => {
    arp(s, [60, 64, 67, 72, 76, 79, 84], 0.045, { duty: 0.25, vol: 0.08, dur: 0.06 });
  },
  // Spotted! A startled "boing" up and a cartoon alarm.
  spotted: (s) => {
    s.tone({ dur: 0.18, from: 300, to: 1400, wave: 'triangle', vol: 0.14 });
    arp(s, [84, 79, 84, 79], 0.07, { at: 0.18, duty: 0.25, vol: 0.09, dur: 0.06 });
  },
  // ---- 007 (game/bond.ts). ----
  // The question goes up: a quiz show's "dun-dun-DUNNN", minor and tense.
  quiz: (s) => {
    arp(s, [52, 55], 0.16, { duty: 0.25, vol: 0.13, dur: 0.12 });
    s.tone({ at: 0.32, dur: 0.6, from: midi(51), duty: 0.25, vibrato: [6, 4], vol: 0.13 });
    s.tone({ at: 0.32, dur: 0.6, from: midi(39), wave: 'triangle', vol: 0.2 });
  },
  // Right: a bright two-note ding.
  'quiz-right': (s) => arp(s, [88, 96], 0.1, { at: 0.18, duty: 0.25, vol: 0.13, dur: 0.3 }),
  // Wrong (or out of time): a flat game-show buzzer.
  'quiz-wrong': (s) => {
    s.tone({ at: 0.18, dur: 0.22, from: 110, duty: 0.5, vol: 0.14 });
    s.tone({ at: 0.45, dur: 0.45, from: 104, duty: 0.5, vol: 0.14 });
  },
  // The white dots sliding across the dark: four soft pings, the last one opening into the barrel.
  'gun-barrel': (s) => {
    for (let i = 0; i < 4; i++) s.tone({ at: i * 0.2, dur: 0.12, from: midi(83 + (i === 3 ? 5 : 0)), wave: 'triangle', vol: 0.09 + i * 0.02 });
    s.noise({ at: 0.75, dur: 0.3, rate: 1.4, to: 0.6, vol: 0.06 });
  },
  // The spy sting while the barrel's open (an original one: see BOND_STING).
  'bond-sting': (s) => {
    rankJingle(s, { jingle: BOND_STING, sparkle: 1 });
  },
  // The shot: a crack, and its echo off the hills.
  'bond-shot': (s) => {
    s.noise({ dur: 0.18, rate: 1.2, to: 0.3, vol: 0.3 });
    s.tone({ dur: 0.08, from: 900, to: 120, duty: 0.5, vol: 0.14 });
    s.noise({ at: 0.22, dur: 0.25, rate: 0.7, to: 0.3, vol: 0.08 });
  },
  // ---- Calculated and Who's That Pokémon? (game/projectiles.ts tracers, game/pokemon.ts). ----
  // A tracer lands: a tiny radar blip.
  tracer: (s) => s.tone({ dur: 0.06, from: midi(96), wave: 'triangle', vol: 0.06 }),
  // The silhouette goes up: a cartoon-show sting, a quick rising run and a bright "who's that?" hit.
  pokemon: (s) => {
    arp(s, [60, 64, 67, 72, 76], 0.05, { duty: 0.25, vol: 0.1, dur: 0.06 });
    s.tone({ at: 0.27, dur: 0.35, from: midi(79), duty: 0.25, vibrato: [7, 5], vol: 0.12 });
    s.tone({ at: 0.27, dur: 0.35, from: midi(55), wave: 'triangle', vol: 0.18 });
  },
  // Right: the item-get fanfare, three quick notes and a held one.
  'pokemon-right': (s) => {
    arp(s, [72, 72, 72], 0.09, { duty: 0.5, vol: 0.11, dur: 0.07 });
    s.tone({ at: 0.27, dur: 0.4, from: midi(79), duty: 0.5, vibrato: [6, 4], vol: 0.12 });
  },
  // Wrong (or out of time): a sad two-note slide down.
  'pokemon-wrong': (s) => {
    s.tone({ dur: 0.2, from: midi(67), to: midi(63), duty: 0.25, vol: 0.12 });
    s.tone({ at: 0.22, dur: 0.45, from: midi(62), to: midi(55), duty: 0.25, vol: 0.12 });
  },
  // MissingNo.: the cartridge crashing, garbled square blips and static.
  missingno: (s) => {
    for (let i = 0; i < 14; i++) s.tone({ at: i * 0.045, dur: 0.04, from: 200 + ((i * 733) % 2400), duty: i % 2 ? 0.125 : 0.5, vol: 0.08 });
    s.noise({ at: 0.1, dur: 0.6, rate: 1.9, to: 0.4, vol: 0.09 });
  },
  // ---- Air Strike (game/airstrike.ts). ----
  // Kira! The glint on the horizon: a bright high sparkle.
  kira: (s) => {
    arp(s, [96, 103, 108], 0.045, { wave: 'triangle', vol: 0.12, dur: 0.12 });
    s.tone({ at: 0.14, dur: 0.4, from: midi(108), wave: 'triangle', vibrato: [18, 60], vol: 0.06 });
  },
  // Three Arwings screaming in from far off: a jet roar rising as they close.
  arwings: (s) => {
    s.noise({ dur: 1.1, rate: 0.5, to: 1.6, vol: 0.14, env: [[0, 0.05], [0.8, 1], [1, 0]] });
    s.tone({ dur: 1.1, from: 300, to: 1100, duty: 0.125, vibrato: [11, 25], vol: 0.05, env: [[0, 0.1], [0.85, 1], [1, 0]] });
  },
  // The comm: Star Fox 64's gabble, a blip a syllable while the caption types (`size`: its length).
  comm: (s, e) => {
    s.noise({ dur: 0.08, rate: 1.8, vol: 0.05 });
    const dur = (e.size ?? 20) / TYPE_RATE;
    for (let t = 0.05, i = 0; t < dur; t += 0.075, i++) {
      s.tone({ at: t, dur: 0.06, from: 260 + ((i * 137) % 160), to: 220 + ((i * 89) % 200), duty: 0.25, vol: 0.07 });
    }
  },
  // A laser bolt: a quick bright zap down.
  laser: (s) => s.tone({ dur: 0.1, from: 2600, to: 700, duty: 0.125, steps: 6, vol: 0.09 }),
  // The bomb: a deep swelling WHOOM, with a sparkling ring over it.
  'smart-bomb': (s) => {
    s.tone({ dur: 0.9, from: 140, to: 40, duty: 0.5, vol: 0.2 });
    s.noise({ dur: 1, rate: 0.25, to: 0.08, vol: 0.24, env: [[0, 1], [0.3, 0.8], [1, 0]] });
    arp(s, [84, 91, 96, 91, 84], 0.06, { at: 0.05, wave: 'triangle', vol: 0.07, dur: 0.1 });
  },
  // A beat of the backing music (audio/strike.ts; `size`: beats left before the dive).
  'strike-beat': (s, e) => strikeBeat(s, e.size ?? 1),
  // ---- ShotDownBoyz's Prepper (game/bunker.ts). ----
  // The drill biting in: a rising whine over grinding noise.
  drill: (s) => {
    s.noise({ dur: 1.15, rate: 0.3, to: 0.55, vol: 0.14, env: [[0.05, 1], [0.85, 0.8], [1, 0]] });
    s.tone({ dur: 1.15, from: 120, to: 380, duty: 0.25, vibrato: [28, 25], vol: 0.08 });
  },
  // A brick clunking into place (spaced out by MIN_GAP while they rain in).
  brick: (s) => {
    s.tone({ dur: 0.05, from: 320, to: 180, duty: 0.5, vol: 0.07 });
    s.noise({ dur: 0.03, rate: 0.8, vol: 0.05 });
  },
  // The bunker giving way: a rumble and a tumbling scale down.
  'bunker-down': (s) => {
    s.noise({ dur: 0.6, rate: 0.35, to: 0.1, vol: 0.18 });
    arp(s, [64, 60, 57, 52, 48], 0.07, { at: 0.05, duty: 0.5, vol: 0.09 });
  },
  // ---- ShotDownBoyz's Stratagem (game/stratagems.ts). ----
  // The d-pad comes up: a rising four-note "ready" chime.
  call: (s) => arp(s, [67, 71, 74, 79], 0.05, { duty: 0.25, vol: 0.1 }),
  // Each arrow keyed: a crisp blip.
  'call-key': (s) => s.tone({ dur: 0.04, from: 1320, duty: 0.25, vol: 0.1 }),
  // An arrow that fits nothing: the input wiped, a sour buzz.
  'call-wrong': (s) => s.tone({ dur: 0.18, from: 140, to: 110, duty: 0.5, vol: 0.12 }),
  // A combo finished: the satisfying "stratagem ready" triad.
  'call-done': (s) => arp(s, [79, 83, 86, 91], 0.045, { duty: 0.125, vol: 0.12, dur: 0.12 }),
  // Out of time: two notes down.
  'call-off': (s) => arp(s, [64, 57], 0.12, { duty: 0.5, vol: 0.1 }),
  // The beacon: a radio beep-beep as it's thrown and as it lands.
  beacon: (s) => {
    s.tone({ dur: 0.06, from: 1760, duty: 0.5, vol: 0.09 });
    s.tone({ at: 0.12, dur: 0.06, from: 1760, duty: 0.5, vol: 0.09 });
  },
  // The Orbital Laser: a long searing hum that wavers.
  'orbital-laser': (s) => {
    s.tone({ dur: 2.6, from: 180, duty: 0.25, vibrato: [14, 30], vol: 0.11, env: [[0.04, 1], [0.9, 0.9], [1, 0]] });
    s.noise({ dur: 2.6, rate: 1.4, vol: 0.05 });
  },
  // The Railcannon: a whine winding up and an almighty KER-CHUNK.
  railcannon: (s) => {
    s.tone({ dur: 0.18, from: 600, to: 3200, duty: 0.125, vol: 0.08 });
    s.noise({ at: 0.15, dur: 0.6, rate: 0.3, to: 0.06, vol: 0.3 });
    s.tone({ at: 0.15, dur: 0.4, from: 90, to: 30, duty: 0.5, vol: 0.2 });
  },
  // A pod slamming down.
  pod: (s) => {
    s.noise({ dur: 0.25, rate: 0.4, to: 0.1, vol: 0.2 });
    s.tone({ dur: 0.15, from: 120, to: 50, duty: 0.5, vol: 0.14 });
  },
  // A sentry unfolding: servo whirr up.
  'sentry-up': (s) => s.tone({ at: 0.2, dur: 0.35, from: 200, to: 700, duty: 0.25, steps: 8, vol: 0.08 }),
  // A sentry's rocket: fwoosh.
  'sentry-rocket': (s) => s.noise({ dur: 0.4, rate: 0.5, to: 1.3, vol: 0.13 }),
  // A sentry's autocannon: a rattle of heavy thunks, one per round of the burst.
  'sentry-shell': (s) => {
    for (let i = 0; i < 5; i++) {
      s.tone({ at: i * 0.09, dur: 0.07, from: 320, to: 90, duty: 0.5, vol: 0.14 });
      s.noise({ at: i * 0.09, dur: 0.06, rate: 0.7, vol: 0.1 });
    }
  },
  // The Tesla Tower: crackling electricity.
  zap: (s) => {
    s.noise({ dur: 0.35, rate: 2, vol: 0.12, env: [[0, 1], [0.3, 0.4], [0.5, 1], [1, 0]] });
    s.tone({ dur: 0.3, from: 2600, duty: 0.125, vibrato: [70, 600], vol: 0.06 });
  },
  // A pod picked up: a cheery pickup arpeggio.
  pickup: (s) => arp(s, [72, 79, 84, 88], 0.06, { duty: 0.25, vol: 0.12 }),
  // ---- Spinners: Steal's roulette and Diced Coffee's wheel both tick. ----
  tick: (s) => s.tone({ dur: 0.03, from: 1760, duty: 0.125, vol: 0.12 }),
  // ---- Steal (game/steal.ts). ----
  // Ka-ching!
  stolen: (s) => {
    s.noise({ dur: 0.06, rate: 1.8, vol: 0.14 });
    arp(s, [88, 95, 100], 0.06, { at: 0.04, duty: 0.25, vol: 0.14, dur: 0.2 });
  },
  // Bwomp.
  nothing: (s) => s.tone({ dur: 0.3, from: 220, to: 80, duty: 0.5, steps: 5, vol: 0.14 }),
  // ---- Diced Coffee (game/coffee.ts). ----
  // Diced Coffee, lactose free: a big straw slurp, a gulp, and a perky "ahh!".
  slurp: (s) => {
    s.tone({ dur: 0.55, from: 160, to: 380, duty: 0.25, vibrato: [26, 30], vol: 0.12 });
    s.noise({ dur: 0.5, rate: 0.35, to: 0.2, vol: 0.06 });
    s.tone({ at: 0.6, dur: 0.1, from: midi(70), to: midi(62), duty: 0.5, vol: 0.12 });
    arp(s, [79, 84, 88], 0.07, { at: 0.8, duty: 0.25, vol: 0.12 });
  },
  // Diced Coffee, full cream: a queasy wobble down, then a rumble.
  spill: (s) => {
    s.tone({ dur: 0.7, from: midi(67), to: midi(55), duty: 0.5, vibrato: [7, 14], vol: 0.13 });
    s.noise({ at: 0.4, dur: 0.5, rate: 0.2, vol: 0.1 });
  },
  // ---- Women in Scam (game/scam.ts). ----
  // Women in Scam pays out: a cash-register ka-ching.
  scammed: (s) => {
    s.noise({ dur: 0.05, rate: 2, vol: 0.12 });
    arp(s, [96, 100, 103, 108], 0.05, { at: 0.05, duty: 0.125, vol: 0.13, dur: 0.25 });
  },
  // ---- Holograms and twins (game/copies.ts). ----
  // A hologram blows up: a stuttering digital glitch-out, a power-down ZWOOOM into a crunchy bang, then
  // a sprinkle of falling pixel sparkles.
  'holo-boom': (s) => {
    [2400, 700, 3100, 520, 1900, 3600].forEach((f, i) => s.tone({ at: i * 0.028, dur: 0.022, from: f, duty: 0.125, vol: 0.09 }));
    s.tone({ at: 0.15, dur: 0.42, from: 1500, to: 45, duty: 0.5, steps: 16, vol: 0.18 });
    s.noise({ at: 0.15, dur: 0.55, rate: 1.1, to: 0.12, vol: 0.32 });
    arp(s, [100, 96, 98, 93, 95, 89], 0.045, { at: 0.42, duty: 0.125, vol: 0.06, dur: 0.035 });
  },
  // A hologram whose owner is out fizzles away.
  busted: (s) => {
    s.tone({ dur: 0.35, from: 700, to: 90, duty: 0.125, steps: 8, vol: 0.12 });
    s.noise({ dur: 0.35, rate: 1.4, to: 0.3, vol: 0.06 });
  },
  // Yolk Sucker: a long straw slurp, then a little gulp at the other end.
  yolk: (s) => {
    s.tone({ dur: 0.45, from: 180, to: 420, duty: 0.25, vibrato: [22, 25], vol: 0.12 });
    s.noise({ at: 0.05, dur: 0.35, rate: 0.4, to: 0.15, vol: 0.06 });
    s.tone({ at: 0.5, dur: 0.12, from: midi(72), to: midi(64), duty: 0.5, vol: 0.12 });
  },
  // ---- The jetpack (game/jetpack.ts). ----
  // FWOOOSH-boing.
  launch: (s) => {
    s.noise({ dur: 0.9, rate: 0.25, to: 1.5, vol: 0.25 });
    s.tone({ dur: 0.5, from: 180, to: 1300, duty: 0.25, steps: 12, vol: 0.15 });
  },
  // ---- The stream (game/stream.ts). ----
  // Splashback: a wet slap, then the water gurgling back.
  splashback: (s) => {
    s.noise({ dur: 0.12, rate: 0.9, to: 0.3, vol: 0.18 });
    s.tone({ at: 0.08, dur: 0.35, from: 520, to: 140, duty: 0.25, vibrato: [18, 30], vol: 0.12 });
  },
  // ---- Take a Nap (game/nap.ts). ----
  // Level-up jingle.
  wake: (s) => arp(s, [72, 76, 79, 84, 88, 91], 0.065, { duty: 0.25, vol: 0.14 }),
  // ---- The marathon runner (game/runner.ts). ----
  // Pitter-patter.
  leg: (s) => {
    for (let i = 0; i < 6; i++) s.tone({ at: i * 0.09, dur: 0.03, from: i % 2 ? 260 : 320, duty: 0.5, vol: 0.05 });
  },
  // Ta-da-da-DAAA.
  finish: (s) => {
    arp(s, [72, 72, 72], 0.1, { duty: 0.25, vol: 0.15, dur: 0.07 });
    s.tone({ at: 0.3, dur: 0.6, from: midi(77), duty: 0.25, vibrato: [6, 8], vol: 0.15 });
    s.tone({ at: 0.3, dur: 0.6, from: midi(81), duty: 0.125, vol: 0.1 });
  },
  // Sad trombone: wah wah wah waaaah.
  dnf: (s) => {
    [67, 66, 65].forEach((n, i) => s.tone({ at: i * 0.32, dur: 0.28, from: midi(n), to: midi(n) * 0.97, duty: 0.5, vol: 0.14 }));
    s.tone({ at: 0.96, dur: 0.9, from: midi(64), to: midi(63), duty: 0.5, vibrato: [6, 9], vol: 0.14 });
  },
  // ---- Walkers (game/walkers.ts). ----
  // A walker tune has just been cut off: POP!
  'tune-end': (s) => {
    s.tone({ dur: 0.07, from: midi(93), to: midi(105), duty: 0.5, vol: 0.2 });
    s.noise({ dur: 0.06, rate: 1.8, vol: 0.12 });
  },
  // ---- Projectiles (game/projectiles.ts). ----
  // The Rizzler has spotted someone: a little "ooh-la-la" trill. Mr Bean's beans (ten at once): a quick blip each.
  'lock-on': (s, e) => {
    if (e.weaponId === 'mr-bean') s.tone({ dur: 0.04, from: midi(88), to: midi(95), duty: 0.25, vol: 0.05 });
    else arp(s, [76, 79, 83, 88], 0.045, { dur: 0.08, duty: 0.25, vol: 0.12 });
  },
  // ---- The sonic boom's bird (game/fx.ts). ----
  // Koo-koo-kaa-kaa-kaa.
  kookaburra: (s) => {
    for (let i = 0; i < 9; i++) {
      const up = i % 2 === 0;
      s.tone({ at: 0.35 + i * 0.075, dur: 0.06, from: up ? 1150 : 1700, to: up ? 1750 : 1050, duty: 0.25, vol: 0.05 + i * 0.008 });
    }
  },
};

/** Minimum seconds between two plays of the same sound, so a pill storm doesn't turn into mush. */
const MIN_GAP: Partial<Record<SfxCue, number>> = { boom: 0.035, hit: 0.07, round: 0.02, tick: 0.01, leg: 0.3, scoot: 0.11, digger: 0.12, arwing: 0.09, dribble: 0.06, brick: 0.07 };

/** Plays queued cues on a synth, throttling rapid repeats. */
export class SfxPlayer {
  private readonly last = new Map<string, number>();
  readonly tunes: TunePlayer;
  played = 0;

  constructor(
    private readonly synth: Synth,
    private readonly clock: () => number,
  ) {
    this.tunes = new TunePlayer(synth);
  }

  /** A rank-up's jingle (not a game event: it plays when the celebration shows). */
  jingle(rank: Pick<Rank, 'jingle' | 'sparkle'>): void {
    rankJingle(this.synth, rank);
    this.played++;
  }

  /** One of the XP screen's sounds (audio/xp.ts; `n`: which notch, for those that climb). */
  xp(cue: XpCue, n = 1): void {
    XP_SOUNDS[cue](this.synth, n);
    this.played++;
  }

  play(e: Sfx): void {
    // Chiptunes: walkers' strike up while they walk and stop dead (POP!) when the last one is gone; Band
    // Aid's plays while he drums, and just stops.
    const w = (e.cue === 'tune' || e.cue === 'tune-end') && e.weaponId ? findWeapon(e.weaponId) : undefined;
    const tune: TuneId | undefined = !w ? undefined : isProjectileWeapon(w) ? w.tune : kindOf(w) === 'drum' ? weaponOf(w.id, 'drum').drum.tune : undefined;
    if (e.cue === 'tune') {
      if (tune) this.tunes.start(tune);
      this.played++;
      return;
    }
    if (e.cue === 'tune-end' && tune) {
      this.tunes.stop(tune);
      if (w && !isProjectileWeapon(w)) return;
    }
    const recipe = e.cue === 'fire' ? FIRE_SOUNDS[e.weaponId ?? ''] : e.cue === 'round' ? ROUND_SOUNDS[e.weaponId ?? ''] : CUE_SOUNDS[e.cue];
    if (!recipe) return;
    const key = `${e.cue}:${e.weaponId ?? ''}`;
    const now = this.clock();
    const gap = MIN_GAP[e.cue] ?? 0;
    if (gap > 0 && now - (this.last.get(key) ?? -Infinity) < gap) return;
    this.last.set(key, now);
    recipe(this.synth, e);
    this.played++;
  }
}

import type { Sfx, SfxCue } from '../game/state';
import { getWeapon } from '../weapons/registry';
import { midi, type Synth } from './chip';
import { TunePlayer } from './tunes';

/**
 * Kitschy 8-bit sound effects. Every weapon has a firing sound (`FIRE_SOUNDS`), burst weapons blip on
 * each round (`ROUND_SOUNDS`), and game events have their own (`CUE_SOUNDS`). All synthesised.
 */
type Recipe = (s: Synth, e: Sfx) => void;

/** A quick run of notes (MIDI numbers), `step` s apart. */
function arp(s: Synth, notes: number[], step: number, o: { at?: number; dur?: number; duty?: 0.125 | 0.25 | 0.5; vol?: number; wave?: 'pulse' | 'triangle' } = {}): void {
  notes.forEach((n, i) =>
    s.tone({ at: (o.at ?? 0) + i * step, dur: o.dur ?? step * 0.9, from: midi(n), duty: o.duty ?? 0.25, vol: o.vol ?? 0.14, wave: o.wave }),
  );
}

/** Classic "pew": a stepped downward sweep. */
function pew(s: Synth, at = 0, from = 1400, to = 180, vol = 0.18): void {
  s.tone({ at, dur: 0.22, from, to, duty: 0.25, steps: 10, vol });
}

export const FIRE_SOUNDS: Record<string, Recipe> = {
  shell: (s) => {
    pew(s);
    s.noise({ dur: 0.08, rate: 0.6, vol: 0.15 });
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
    const st = getWeapon('ten-1').stream!;
    const dur = st.rampUp + st.hold + st.rampDown;
    const up = st.rampUp / dur;
    const hold = (st.rampUp + st.hold) / dur;
    const env: [number, number][] = [[0.02, 0.1], [up * 0.4, 0.5], [up * 0.6, 0.35], [up, 1], [hold, 1], [hold + 0.1, 0.4], [hold + 0.18, 0.7], [1, 0]];
    s.noise({ dur, rate: 0.9, vol: 0.12, env });
    s.tone({ dur, from: 95, duty: 0.125, vibrato: [7, 30], vol: 0.07, env });
  },
  // Putt-putt engine revving up for the whole charge (launch has its own sound).
  'ten-2': (s) => {
    const charge = getWeapon('ten-2').jetpack!.chargeTime;
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
    const dur = getWeapon('ten-3').spew!.duration;
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
    const sp = getWeapon('sonic-boom').sonic!;
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
    const spec = getWeapon('sew').sew!;
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
};

/** Per-round blips for burst weapons. */
export const ROUND_SOUNDS: Record<string, Recipe> = {
  'pill-pusher': (s) => s.tone({ dur: 0.07, from: 1500, to: 700, duty: 0.25, vol: 0.12 }),
  // Typewriter clack.
  debate: (s) => {
    s.noise({ dur: 0.02, rate: 1.6, vol: 0.14 });
    s.tone({ dur: 0.02, from: 2100, duty: 0.125, vol: 0.06 });
  },
  // Bzzt.
  'tattoo-gun': (s) => s.tone({ dur: 0.045, from: 118, duty: 0.125, vol: 0.14 }),
};

export const CUE_SOUNDS: Record<Exclude<SfxCue, 'fire' | 'round' | 'tune'>, Recipe> = {
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
  // FWOOOSH-boing.
  launch: (s) => {
    s.noise({ dur: 0.9, rate: 0.25, to: 1.5, vol: 0.25 });
    s.tone({ dur: 0.5, from: 180, to: 1300, duty: 0.25, steps: 12, vol: 0.15 });
  },
  // Level-up jingle.
  wake: (s) => arp(s, [72, 76, 79, 84, 88, 91], 0.065, { duty: 0.25, vol: 0.14 }),
  pin: (s) => {
    s.tone({ dur: 0.08, from: 1600, to: 500, duty: 0.5, vol: 0.14 });
    s.tone({ at: 0.09, dur: 0.06, from: 700, duty: 0.125, vol: 0.1 });
  },
  tattoo: (s) => arp(s, [96, 103], 0.05, { duty: 0.125, vol: 0.08 }),
  // Sizzle and a ding.
  cook: (s) => {
    s.noise({ dur: 0.5, rate: 2, vol: 0.08 });
    s.tone({ at: 0.3, dur: 0.3, from: midi(91), wave: 'triangle', vol: 0.12 });
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
  // Pitter-patter.
  leg: (s) => {
    for (let i = 0; i < 6; i++) s.tone({ at: i * 0.09, dur: 0.03, from: i % 2 ? 260 : 320, duty: 0.5, vol: 0.05 });
  },
  // Boing (frog hop).
  hop: (s) => {
    s.tone({ dur: 0.11, from: 240, to: 760, duty: 0.25, vol: 0.1 });
    s.tone({ at: 0.11, dur: 0.07, from: 760, to: 520, duty: 0.25, vol: 0.06 });
  },
  tick: (s) => s.tone({ dur: 0.03, from: 1760, duty: 0.125, vol: 0.12 }),
  // Ka-ching!
  stolen: (s) => {
    s.noise({ dur: 0.06, rate: 1.8, vol: 0.14 });
    arp(s, [88, 95, 100], 0.06, { at: 0.04, duty: 0.25, vol: 0.14, dur: 0.2 });
  },
  // Women in Scam pays out: a cash-register ka-ching.
  scammed: (s) => {
    s.noise({ dur: 0.05, rate: 2, vol: 0.12 });
    arp(s, [96, 100, 103, 108], 0.05, { at: 0.05, duty: 0.125, vol: 0.13, dur: 0.25 });
  },
  // Bwomp.
  nothing: (s) => s.tone({ dur: 0.3, from: 220, to: 80, duty: 0.5, steps: 5, vol: 0.14 }),
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
  // Koo-koo-kaa-kaa-kaa.
  kookaburra: (s) => {
    for (let i = 0; i < 9; i++) {
      const up = i % 2 === 0;
      s.tone({ at: 0.35 + i * 0.075, dur: 0.06, from: up ? 1150 : 1700, to: up ? 1750 : 1050, duty: 0.25, vol: 0.05 + i * 0.008 });
    }
  },
  // The classic coin: bling-bling.
  // The Rizzler has spotted someone: a little "ooh-la-la" trill.
  'lock-on': (s) => arp(s, [76, 79, 83, 88], 0.045, { dur: 0.08, duty: 0.25, vol: 0.12 }),
  refund: (s) => {
    s.tone({ dur: 0.07, from: midi(83), duty: 0.5, vol: 0.14 });
    s.tone({ at: 0.07, dur: 0.35, from: midi(88), duty: 0.5, vol: 0.14 });
  },
  // A walker tune has just been cut off: POP!
  'tune-end': (s) => {
    s.tone({ dur: 0.07, from: midi(93), to: midi(105), duty: 0.5, vol: 0.2 });
    s.noise({ dur: 0.06, rate: 1.8, vol: 0.12 });
  },
  // Victory!
  gameover: (s) => {
    arp(s, [72, 76, 79, 84], 0.11, { duty: 0.25, vol: 0.15 });
    arp(s, [79, 84], 0.18, { at: 0.5, duty: 0.25, vol: 0.15, dur: 0.16 });
    s.tone({ at: 0.9, dur: 0.7, from: midi(88), duty: 0.25, vibrato: [6, 10], vol: 0.15 });
  },
};

/** Minimum seconds between two plays of the same sound, so a pill storm doesn't turn into mush. */
const MIN_GAP: Partial<Record<SfxCue, number>> = { boom: 0.035, hit: 0.07, round: 0.02, tick: 0.01, leg: 0.3 };

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

  play(e: Sfx): void {
    // Walker chiptunes: strike up while they walk, stop dead when the last one is gone.
    const tune = e.weaponId ? getWeapon(e.weaponId).tune : undefined;
    if (e.cue === 'tune') {
      if (tune) this.tunes.start(tune);
      this.played++;
      return;
    }
    if (e.cue === 'tune-end' && tune) this.tunes.stop(tune);
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

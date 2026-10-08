import { arp, midi, type Synth } from './chip';

/**
 * The XP screen's sounds (ui/xp.ts), played by `SfxPlayer.xp`. Built to feel like a slot machine paying
 * out: each notch of the bar that lights up blips a step higher up a major scale (so a run of them climbs),
 * a full bar is a fanfare with a sparkle, and a padlock breaking open is a clunk, a crack and a flourish.
 */
export type XpCue = 'fill' | 'notch' | 'full' | 'done' | 'unlock';

/** C major, climbing: one note for each notch of the bar (1–6). */
const NOTCH_NOTES = [72, 74, 76, 79, 81, 84];

export const XP_SOUNDS: Record<XpCue, (s: Synth, n: number) => void> = {
  // A notch filling: a quick rising zip into it (`n`: which notch, 1–6, a little higher each time).
  fill: (s, n) => {
    const base = midi(NOTCH_NOTES[Math.max(0, n - 1)]! - 12);
    s.tone({ dur: 0.3, from: base, to: base * 2, wave: 'triangle', steps: 12, vol: 0.05, env: [[0, 0.3], [0.8, 1], [1, 0]] });
  },
  // A notch lit: a bright blip, with an octave sparkle on top.
  notch: (s, n) => {
    const note = NOTCH_NOTES[Math.max(0, Math.min(5, n - 1))]!;
    s.tone({ dur: 0.12, from: midi(note), duty: 0.25, vol: 0.13 });
    s.tone({ at: 0.04, dur: 0.16, from: midi(note + 12), wave: 'triangle', vol: 0.07 });
  },
  // The bar full: a fanfare up the chord, a held top note with vibrato, and a glittery noise wash.
  full: (s) => {
    arp(s, [72, 76, 79, 84, 88], 0.07, { duty: 0.25, vol: 0.13 });
    s.tone({ at: 0.35, dur: 0.75, from: midi(91), duty: 0.125, vibrato: [7, 12], vol: 0.12, env: [[0, 1], [0.7, 0.7], [1, 0]] });
    s.tone({ at: 0.35, dur: 0.75, from: midi(79), wave: 'triangle', vol: 0.1, env: [[0, 1], [1, 0]] });
    s.noise({ at: 0.3, dur: 0.6, rate: 1.9, to: 1.2, vol: 0.05, env: [[0, 0], [0.2, 1], [1, 0]] });
  },
  // The bar's done filling (no unlock this time): ding-ding.
  done: (s) => {
    s.tone({ dur: 0.12, from: midi(84), duty: 0.25, vol: 0.11 });
    s.tone({ at: 0.12, dur: 0.3, from: midi(88), duty: 0.25, vol: 0.11 });
  },
  // A padlock breaking open: a heavy clunk, a crack, then a triumphant run and a shimmering trill.
  unlock: (s) => {
    s.tone({ dur: 0.12, from: 180, to: 60, duty: 0.5, steps: 5, vol: 0.2 });
    s.noise({ dur: 0.08, rate: 0.6, vol: 0.18 });
    s.noise({ at: 0.14, dur: 0.12, rate: 1.6, to: 0.8, vol: 0.14 });
    arp(s, [79, 84, 88, 91, 96], 0.06, { at: 0.28, duty: 0.25, vol: 0.13 });
    for (let i = 0; i < 8; i++) s.tone({ at: 0.6 + i * 0.05, dur: 0.05, from: midi(i % 2 ? 100 : 103), wave: 'triangle', vol: 0.05 });
  },
};

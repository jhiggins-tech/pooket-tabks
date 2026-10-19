import { STRIKE_BEAT } from '../game/airstrike';
import { midi, type Synth } from './chip';
import { pitchOf } from './score';

/**
 * doctorfox's Air Strike's backing music: an original space-opera cue, played a beat at a time as the
 * strike counts its beats down (game/airstrike.ts: the 'strike-beat' cue, its `size` the beats left
 * before the ships dive in). A beat at a time so it pauses with the game and stops within a beat if the
 * strike goes away; counted back from the dive so it lands on it whatever the comm's length.
 *
 * - On approach (k ≥ 1), under the comm: C minor, bars of Cm, A♭, B♭, G over a galloping bass, a quiet
 *   arpeggio and a horn holding each bar; the last bar before the dive is a build, a snare roll and the
 *   horn climbing G7.
 * - The dive and the strafing run (k = 0 to −7): the theme, lifted into C major (C, B♭, F, G), the
 *   melody climbing up to
 * - the bomb (k = −8): a held C major chord and a crash over the WHOOM.
 */

/** An eighth note (s): two to a beat. */
const EIGHTH = STRIKE_BEAT / 2;

const n = (name: string) => midi(pitchOf(name));

/** Kick, snare and hats, at `at` s. */
function kick(s: Synth, at: number, vol = 0.12): void {
  s.noise({ at, dur: 0.09, rate: 0.35, to: 0.12, vol });
  s.tone({ at, dur: 0.08, from: 150, to: 50, wave: 'triangle', vol: vol * 1.4 });
}
function snare(s: Synth, at: number, vol = 0.09): void {
  s.noise({ at, dur: 0.1, rate: 1.1, vol });
}
function hat(s: Synth, at: number, vol = 0.025): void {
  s.noise({ at, dur: 0.03, rate: 1.8, vol });
}

/** A bar on approach: its bass root, triad (arpeggiated) and the horn's held note. */
interface ApproachBar {
  root: string;
  chord: [string, string, string];
  horn: string;
}

/** The approach's bars, counted back from the dive (`BARS[b % 4]` for the b-th bar from the end). */
const BARS: ApproachBar[] = [
  { root: 'c2', chord: ['c4', 'eb4', 'g4'], horn: 'g4' }, // Cm
  { root: 'g1', chord: ['b3', 'd4', 'g4'], horn: 'b4' }, // G (the build, if it's the last bar)
  { root: 'bb1', chord: ['bb3', 'd4', 'f4'], horn: 'd5' }, // B♭
  { root: 'ab1', chord: ['ab3', 'c4', 'eb4'], horn: 'c5' }, // A♭
];

/** The arpeggio's two eighths on each beat of a bar: which triad notes (3 = the root an octave up). */
const ARP: [number, number][] = [[0, 1], [2, 1], [3, 2], [1, 2]];

/** The build's horn, a beat each: up G7 into the theme's C. */
const BUILD = ['g4', 'b4', 'd5', 'f5'];

/** One beat on approach, `k` beats before the dive. */
function approach(s: Synth, k: number): void {
  const b = Math.ceil(k / 4);
  const pos = (4 - (k % 4)) % 4;
  const bar = BARS[b % 4]!;
  const build = b === 1;
  const root = pitchOf(bar.root);
  // Galloping bass: the root, then up an octave.
  s.tone({ dur: EIGHTH * 0.8, from: midi(root), wave: 'triangle', vol: 0.18 });
  s.tone({ at: EIGHTH, dur: EIGHTH * 0.6, from: midi(root + 12), wave: 'triangle', vol: 0.15 });
  // The arpeggio, quiet under the comm.
  ARP[pos]!.forEach((i, j) => {
    const p = i === 3 ? pitchOf(bar.chord[0]) + 12 : pitchOf(bar.chord[i]!);
    s.tone({ at: j * EIGHTH, dur: EIGHTH * 0.7, from: midi(p), duty: 0.125, vol: 0.04 });
  });
  if (build) {
    // A snare roll swelling into the dive, the horn climbing.
    for (let i = 0; i < 4; i++) snare(s, (i * EIGHTH) / 2, 0.03 + 0.025 * (4 - k) + 0.006 * i);
    s.tone({ dur: STRIKE_BEAT * 0.95, from: n(BUILD[pos]!), duty: 0.25, vol: 0.07, vibrato: [6, 4], env: [[0, 0.6], [0.1, 1], [0.8, 0.9], [1, 0]] });
    return;
  }
  // Drums: kick on 1 and 3, a snare on 2 and 4, hats on the eighths.
  if (pos % 2 === 0) kick(s, 0, 0.09);
  else snare(s, 0, 0.05);
  hat(s, 0);
  hat(s, EIGHTH);
  // The horn holds each bar's note.
  if (pos === 0) s.tone({ dur: STRIKE_BEAT * 3.9, from: n(bar.horn), duty: 0.25, vol: 0.06, vibrato: [5.5, 3], env: [[0, 0], [0.08, 1], [0.85, 0.8], [1, 0]] });
}

/** The theme, two beats a chord: bass root and triad. */
const THEME_CHORDS: { root: string; chord: string[] }[] = [
  { root: 'c2', chord: ['e4', 'g4', 'c5'] }, // C
  { root: 'bb1', chord: ['d4', 'f4', 'bb4'] }, // B♭
  { root: 'f2', chord: ['c4', 'f4', 'a4'] }, // F
  { root: 'g2', chord: ['d4', 'g4', 'b4'] }, // G
];

/** The theme's melody, a beat at a time: [note, eighths] (an empty beat: the last note's still held). */
const THEME: [string, number][][] = [
  [['c5', 1], ['g4', 1]],
  [['c5', 1], ['e5', 1]],
  [['f5', 2]],
  [['d5', 1], ['f5', 1]],
  [['a5', 4]],
  [],
  [['g5', 1], ['a5', 1]],
  [['b5', 1], ['d6', 1]],
];

/** Beat `j` (0 to 7) of the theme, from the dive to the bomb. */
function theme(s: Synth, j: number): void {
  const c = THEME_CHORDS[Math.floor(j / 2)]!;
  const root = pitchOf(c.root);
  s.tone({ dur: EIGHTH * 0.85, from: midi(root), wave: 'triangle', vol: 0.2 });
  s.tone({ at: EIGHTH, dur: EIGHTH * 0.7, from: midi(root + 12), wave: 'triangle', vol: 0.17 });
  // Brassy stabs on the beat and the off-beat.
  for (const at of [0, EIGHTH]) for (const p of c.chord) s.tone({ at, dur: EIGHTH * 0.55, from: n(p), duty: 0.25, vol: 0.035 });
  let at = 0;
  for (const [p, len] of THEME[j]!) {
    s.tone({ at, dur: len * EIGHTH * 0.92, from: n(p), duty: 0.5, vol: 0.09, vibrato: len > 1 ? [6, 5] : undefined, env: [[0, 1], [0.6, 0.85], [1, 0]] });
    at += len * EIGHTH;
  }
  if (j === 0) s.noise({ dur: 0.7, rate: 1.4, to: 0.9, vol: 0.08 }); // a crash into it
  kick(s, 0, 0.11);
  if (j % 2 === 1) snare(s, 0, 0.08);
  hat(s, EIGHTH, 0.03);
  if (j === 7) for (let i = 0; i < 4; i++) snare(s, EIGHTH + (i * EIGHTH) / 4, 0.05 + 0.015 * i); // a fill into the bomb
}

/** The bomb: a held C major chord, the melody's top C, and a crash. */
function finale(s: Synth): void {
  const dur = 1.2;
  const env: [number, number][] = [[0, 1], [0.15, 0.9], [0.7, 0.6], [1, 0]];
  for (const p of ['c4', 'e4', 'g4', 'c5']) s.tone({ dur, from: n(p), duty: 0.25, vol: 0.045, env });
  s.tone({ dur: dur * 0.95, from: n('c6'), duty: 0.5, vol: 0.09, vibrato: [6, 7], env });
  s.tone({ dur, from: n('c2'), wave: 'triangle', vol: 0.2, env });
  s.noise({ dur: 1, rate: 1.4, to: 0.7, vol: 0.1 });
}

/** The beat `k` beats before the dive (negative: after it; −8 is the bomb). */
export function strikeBeat(s: Synth, k: number): void {
  if (k >= 1) approach(s, k);
  else if (k > -8) theme(s, -k);
  else if (k === -8) finale(s);
}

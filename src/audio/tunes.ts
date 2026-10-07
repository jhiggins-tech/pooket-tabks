import type { TuneId } from '../weapons/types';
import { midi, type Duty, type Synth, type Voice } from './chip';

/** A note: MIDI number (null = rest) and length in steps. */
type Note = [number | null, number];

interface Track {
  notes: Note[];
  wave: 'pulse' | 'triangle' | 'noise';
  duty?: Duty;
  vol: number;
  /** Fraction of each note's length that sounds (lower = bouncier). */
  gate: number;
}

interface Tune {
  /** Seconds per step. */
  step: number;
  tracks: Track[];
}

// Pop Goes the Weasel, in 6/8 (one step = one quaver), C major.
const C = 72, D = 74, E = 76, F = 77, G = 79, A = 81;
const around: Note[] = [[C, 2], [C, 1], [D, 2], [D, 1], [E, 1], [G, 1], [E, 1], [C, 3]]; // All around the mulberry bush
const chased: Note[] = [[C, 2], [C, 1], [D, 2], [D, 1], [E, 3], [C, 3]]; // the monkey chased the weasel
const pop: Note[] = [[A, 3], [D, 2], [F, 1], [E, 3], [C, 3]]; // Pop! goes the weasel
const bassA: Note[] = [[48, 3], [55, 3], [48, 3], [55, 3]];
const bassB: Note[] = [[48, 3], [55, 3], [55, 3], [48, 3]];
const bassPop: Note[] = [[53, 3], [50, 3], [55, 3], [48, 3]];
const hats: Note[] = Array.from({ length: 16 }, () => [1, 3] as Note);

// Band Aid's thrasher, in E minor at 180 bpm (one step = one quaver): a bar of hi-hat count-in, then four
// bars of chugging riff over a galloping bass, the last bar a chromatic run down. No drums: he plays those.
const riff = [52, 52, 52, 52, 55, 52, 58, 57];
const riffLift = [52, 52, 52, 52, 55, 57, 58, 60];
const runDown = [64, 63, 62, 61, 60, 59, 58, 52];
const thrash = [...riff, ...riff, ...riffLift, ...runDown];
const countIn: Note = [null, 8];

export const TUNES: Record<TuneId, Tune> = {
  'band-aid': {
    step: 60 / 180 / 2,
    tracks: [
      { notes: [countIn, ...thrash.map((n): Note => [n, 1])], wave: 'pulse', duty: 0.125, vol: 0.12, gate: 0.6 },
      { notes: [countIn, ...thrash.map((n): Note => [n - 12, 1])], wave: 'triangle', vol: 0.2, gate: 0.75 },
      { notes: [...Array.from({ length: 4 }, (): Note => [1, 2]), ...Array.from({ length: 32 }, (): Note => [1, 1])], wave: 'noise', vol: 0.05, gate: 0.2 },
    ],
  },
  'pop-goes-the-weasel': {
    step: 0.16,
    tracks: [
      { notes: [...around, ...chased, ...around, ...pop], wave: 'pulse', duty: 0.25, vol: 0.13, gate: 0.8 },
      { notes: [...bassA, ...bassB, ...bassA, ...bassPop], wave: 'triangle', vol: 0.2, gate: 0.6 },
      { notes: hats, wave: 'noise', vol: 0.04, gate: 0.15 },
    ],
  },
};

/** Steps in one pass of a track. */
export function trackLength(t: Track): number {
  return t.notes.reduce((n, [, len]) => n + len, 0);
}

/** How far ahead notes are scheduled, in seconds. Small, so a cut is instant. */
const LOOKAHEAD = 0.12;

interface Playing {
  tune: Tune;
  /** Song time in seconds. */
  pos: number;
  /** Per track: next note index and its song time. */
  cursors: { i: number; t: number }[];
  voices: { voice: Voice; end: number }[];
}

/**
 * Plays looping chiptunes a few notes ahead of time, so they can pause (with the game) and stop dead
 * mid-note when told to.
 */
export class TunePlayer {
  private readonly playing = new Map<TuneId, Playing>();

  constructor(private readonly synth: Synth) {}

  isPlaying(id: TuneId): boolean {
    return this.playing.has(id);
  }

  start(id: TuneId): void {
    if (this.playing.has(id)) return;
    const tune = TUNES[id];
    this.playing.set(id, { tune, pos: 0, cursors: tune.tracks.map(() => ({ i: 0, t: 0 })), voices: [] });
    this.update(0, false);
  }

  /** Stop dead, cutting off whatever is sounding. */
  stop(id: TuneId): void {
    const p = this.playing.get(id);
    if (!p) return;
    for (const v of p.voices) v.voice.cut();
    this.playing.delete(id);
  }

  stopAll(): void {
    for (const id of [...this.playing.keys()]) this.stop(id);
  }

  /** Advance by dt seconds and schedule the notes coming up. Paused tunes hold their place. */
  update(dt: number, paused: boolean): void {
    if (paused) return;
    for (const p of this.playing.values()) {
      p.pos += dt;
      p.tune.tracks.forEach((track, k) => {
        const c = p.cursors[k]!;
        while (c.t < p.pos + LOOKAHEAD) {
          const [note, len] = track.notes[c.i]!;
          const dur = len * p.tune.step * track.gate;
          const at = Math.max(0, c.t - p.pos);
          if (note !== null) {
            const voice =
              track.wave === 'noise'
                ? this.synth.noise({ at, dur, rate: 1.6, vol: track.vol })
                : this.synth.tone({ at, dur, from: midi(note), wave: track.wave, duty: track.duty, vol: track.vol, env: [[0, 1], [0.7, 0.8], [1, 0]] });
            if (voice) p.voices.push({ voice, end: c.t + dur });
          }
          c.t += len * p.tune.step;
          c.i = (c.i + 1) % track.notes.length; // loop
        }
      });
      p.voices = p.voices.filter((v) => v.end > p.pos);
    }
  }
}

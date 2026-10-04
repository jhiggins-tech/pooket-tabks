/**
 * A tiny score notation for short tunes (the rank-up jingles: stats/ranks.ts), read into timed notes.
 *
 * A part is notes separated by spaces, each lasting some steps (a step is a sixteenth note):
 * - `c5`, `f#4`, `bb3`: a note (letter, `#` or `b`, octave; `c4` is middle C);
 * - `c4+e4+g4`: a chord (the harmony part);
 * - `r`: a rest;
 * - `k`, `s`, `h`, `c`: drums (kick, snare, hi-hat, crash; `k+h` together);
 * - `:3` after any of them: how many steps it lasts. It sticks: the next ones last as long until another
 *   `:n` (a part starts at 1);
 * - `~` after a note: slide from it into the next one.
 */

export type Drum = 'k' | 's' | 'h' | 'c';

export interface ScoreNote {
  /** When it starts and how long it lasts, in steps. */
  at: number;
  len: number;
  /** MIDI notes (one, or a chord); empty for a rest. */
  pitches: number[];
  /** Slide into this (the next note's first pitch) over the note. */
  slideTo?: number;
}

export interface DrumHit {
  at: number;
  len: number;
  drums: Drum[];
}

const LETTERS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const PITCH = /^([a-g])([#b]?)(\d)$/;
const DRUMS = new Set<string>(['k', 's', 'h', 'c']);

/** A note name (`f#4`) as MIDI. */
export function pitchOf(name: string): number {
  const m = PITCH.exec(name);
  if (!m) throw new Error(`not a note: ${name}`);
  return 12 * (Number(m[3]) + 1) + LETTERS[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

/** Each token of a part: what it is, and how many steps (sticky lengths worked out). */
function tokens(src: string): { body: string; slide: boolean; at: number; len: number }[] {
  let len = 1;
  let at = 0;
  const out: { body: string; slide: boolean; at: number; len: number }[] = [];
  for (const tok of src.trim().split(/\s+/)) {
    if (!tok) continue;
    const [head, n] = tok.split(':');
    if (n !== undefined) {
      len = Number(n);
      if (!Number.isInteger(len) || len < 1) throw new Error(`bad length: ${tok}`);
    }
    const slide = head!.endsWith('~');
    out.push({ body: slide ? head!.slice(0, -1) : head!, slide, at, len });
    at += len;
  }
  return out;
}

/** A tune, bass or harmony part. */
export function parsePart(src: string): ScoreNote[] {
  const notes: ScoreNote[] = tokens(src).map((t) => ({ at: t.at, len: t.len, pitches: t.body === 'r' ? [] : t.body.split('+').map(pitchOf) }));
  tokens(src).forEach((t, i) => {
    if (!t.slide) return;
    const next = notes[i + 1]?.pitches[0];
    if (next === undefined) throw new Error(`a slide needs a note after it: ${t.body}~`);
    notes[i]!.slideTo = next;
  });
  return notes;
}

/** A drum part (rests are left out). */
export function parseDrums(src: string): DrumHit[] {
  return tokens(src)
    .filter((t) => t.body !== 'r')
    .map((t) => {
      const drums = t.body.split('+');
      for (const d of drums) if (!DRUMS.has(d)) throw new Error(`not a drum: ${d}`);
      return { at: t.at, len: t.len, drums: drums as Drum[] };
    });
}

/** How many steps a part lasts. */
export function partSteps(src: string): number {
  const all = tokens(src);
  const last = all[all.length - 1];
  return last ? last.at + last.len : 0;
}

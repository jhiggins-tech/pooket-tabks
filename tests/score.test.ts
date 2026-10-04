import { describe, expect, it } from 'vitest';
import { parseDrums, parsePart, partSteps, pitchOf } from '../src/audio/score';

describe('score notation', () => {
  it('note names are MIDI numbers', () => {
    expect(pitchOf('c4')).toBe(60);
    expect(pitchOf('a4')).toBe(69);
    expect(pitchOf('f#4')).toBe(66);
    expect(pitchOf('bb3')).toBe(58);
    expect(() => pitchOf('h4')).toThrow();
  });

  it('lengths stick until the next one; rests and chords take their time', () => {
    const notes = parsePart('c4:2 e4 r:1 g4+c5:4 a4');
    expect(notes.map((n) => [n.at, n.len, n.pitches])).toEqual([
      [0, 2, [60]],
      [2, 2, [64]],
      [4, 1, []],
      [5, 4, [67, 72]],
      [9, 4, [69]],
    ]);
    expect(partSteps('c4:2 e4 r:1 g4+c5:4 a4')).toBe(13);
    expect(partSteps('c4')).toBe(1);
  });

  it('a slide goes into the next note', () => {
    const [a, b] = parsePart('e5~:2 e6');
    expect(a!.slideTo).toBe(88);
    expect(b!.slideTo).toBeUndefined();
    expect(() => parsePart('e5~')).toThrow();
  });

  it('drums, alone or together, rests left out', () => {
    expect(parseDrums('k:2 h r s:1 k+h c:4')).toEqual([
      { at: 0, len: 2, drums: ['k'] },
      { at: 2, len: 2, drums: ['h'] },
      { at: 6, len: 1, drums: ['s'] },
      { at: 7, len: 1, drums: ['k', 'h'] },
      { at: 8, len: 4, drums: ['c'] },
    ]);
    expect(() => parseDrums('x')).toThrow();
  });
});

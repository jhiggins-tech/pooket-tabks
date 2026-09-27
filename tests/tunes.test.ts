import { describe, expect, it } from 'vitest';
import { midi, type NoiseOpts, type Synth, type ToneOpts, type Voice } from '../src/audio/chip';
import { SfxPlayer } from '../src/audio/sfx';
import { trackLength, TunePlayer, TUNES } from '../src/audio/tunes';
import { createRng } from '../src/core/rng';
import { Terrain } from '../src/core/terrain';
import { FIXED_DT } from '../src/game/constants';
import { createGame, fire, selectTier, setAim, step } from '../src/game/game';
import type { Sfx } from '../src/game/state';
import { weaselPop } from '../src/characters/kits';

/** Records notes, with voices that remember being cut. */
class FakeSynth implements Synth {
  notes: { opts: ToneOpts; voice: Voice & { cut: () => void; wasCut: boolean } }[] = [];
  noises = 0;
  tone(opts: ToneOpts): Voice {
    const voice = { wasCut: false, cut() { this.wasCut = true; } };
    this.notes.push({ opts, voice });
    return voice;
  }
  noise(_: NoiseOpts): Voice {
    this.noises++;
    return { cut() {} };
  }
}

const tune = TUNES['pop-goes-the-weasel'];
const C = 72, D = 74, E = 76, G = 79;

describe('Pop Goes the Weasel', () => {
  it("is Weasel Pop's tune", () => {
    expect(weaselPop.tune).toBe('pop-goes-the-weasel');
  });

  it('has the melody, and every part lines up', () => {
    const melody = tune.tracks[0]!.notes.map(([n]) => n);
    expect(melody.slice(0, 8)).toEqual([C, C, D, D, E, G, E, C]); // All around the mulberry bush
    expect(melody.slice(-5)).toEqual([81, D, 77, E, C]); // Pop! goes the weasel
    const lengths = tune.tracks.map(trackLength);
    expect(new Set(lengths).size).toBe(1);
    expect(lengths[0]! % 6).toBe(0); // whole bars of 6/8
  });

  it('plays the notes in order and time, loops, and holds still while paused', () => {
    const synth = new FakeSynth();
    const player = new TunePlayer(synth);
    player.start('pop-goes-the-weasel');
    for (let t = 0; t < 1; t += 1 / 60) player.update(1 / 60, false);
    const lead = synth.notes.filter((n) => n.opts.wave !== 'triangle').map((n) => n.opts.from);
    expect(lead.slice(0, 5)).toEqual([C, C, D, D, E].map(midi));
    const before = synth.notes.length;
    for (let t = 0; t < 1; t += 1 / 60) player.update(1 / 60, true);
    expect(synth.notes.length).toBe(before);
    // Past the end it goes round again.
    const loop = trackLength(tune.tracks[0]!) * tune.step;
    for (let t = 0; t < loop; t += 1 / 60) player.update(1 / 60, false);
    expect(synth.notes.length).toBeGreaterThan(before * 3);
  });

  it('stops dead: whatever is sounding is cut, and nothing more plays', () => {
    const synth = new FakeSynth();
    const player = new TunePlayer(synth);
    player.start('pop-goes-the-weasel');
    for (let t = 0; t < 0.5; t += 1 / 60) player.update(1 / 60, false);
    player.stop('pop-goes-the-weasel');
    const n = synth.notes.length;
    expect(synth.notes.slice(-2).every((x) => x.voice.wasCut)).toBe(true);
    for (let t = 0; t < 1; t += 1 / 60) player.update(1 / 60, false);
    expect(synth.notes.length).toBe(n);
    expect(player.isPlaying('pop-goes-the-weasel')).toBe(false);
  });

  it('the sound player starts it on the tune cue and cuts it (with a POP) on tune-end', () => {
    const synth = new FakeSynth();
    const sfx = new SfxPlayer(synth, () => 0);
    sfx.play({ cue: 'tune', weaponId: 'weasel-pop' });
    expect(sfx.tunes.isPlaying('pop-goes-the-weasel')).toBe(true);
    sfx.play({ cue: 'tune-end', weaponId: 'weasel-pop' });
    expect(sfx.tunes.isPlaying('pop-goes-the-weasel')).toBe(false);
  });
});

describe('the game cues the tune while the weasels walk', () => {
  function game() {
    const g = createGame({
      seed: 21,
      players: [
        { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
        { name: 'tones', colour: '#ff5a5f', characterId: 'tones' },
      ],
    });
    const w = g.terrain.width;
    g.terrain = Terrain.fromHeights(new Float32Array(w).fill(400), w, g.terrain.height, createRng(1));
    for (const p of g.players) p.y = 400;
    return g;
  }

  it('starts when the first weasel lands, and ends the moment the last one pops', () => {
    const g = game();
    const log: (Sfx & { t: number; left: number; walking: boolean })[] = [];
    selectTier(g, 0);
    setAim(g, 60, 45);
    fire(g);
    let t = 0;
    for (; t < 15 && g.phase === 'flying'; t += FIXED_DT) {
      g.sfx = [];
      step(g, FIXED_DT);
      const walking = g.projectiles.some((p) => p.walkDir !== 0);
      for (const e of g.sfx) log.push({ ...e, t, left: g.projectiles.length, walking });
    }
    const starts = log.filter((e) => e.cue === 'tune');
    const ends = log.filter((e) => e.cue === 'tune-end');
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(starts[0]!.walking).toBe(true);
    expect(ends[0]!.left).toBe(0);
    // Same step as the last pop.
    const lastBoom = log.filter((e) => e.cue === 'boom').at(-1)!;
    expect(lastBoom.t).toBe(ends[0]!.t);
    expect(g.tunes).toEqual([]);
  });
});

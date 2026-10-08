import { describe, expect, it } from 'vitest';
import { CUE_SOUNDS, FIRE_SOUNDS, ROUND_SOUNDS, SfxPlayer } from '../src/audio/sfx';
import type { NoiseOpts, Synth, ToneOpts } from '../src/audio/chip';
import { FIXED_DT } from '../src/game/constants';
import { createGame, explode, fire, selectTier, STEAL_SPIN, step } from '../src/game/game';
import type { SfxCue } from '../src/game/state';
import { allWeapons, getWeapon, weaponOf } from '../src/weapons/registry';

/** Records what a recipe plays instead of making noise. */
class Recorder implements Synth {
  tones: ToneOpts[] = [];
  noises: NoiseOpts[] = [];
  tone(o: ToneOpts): void {
    this.tones.push(o);
  }
  noise(o: NoiseOpts): void {
    this.noises.push(o);
  }
  get count(): number {
    return this.tones.length + this.noises.length;
  }
}

function sane(r: Recorder): void {
  expect(r.count).toBeGreaterThan(0);
  for (const t of r.tones) {
    for (const f of [t.from, t.to ?? t.from]) expect(f).toBeGreaterThanOrEqual(20), expect(f).toBeLessThanOrEqual(8000);
    expect(t.dur).toBeGreaterThan(0);
    expect(t.vol ?? 0.2).toBeLessThanOrEqual(0.5);
    expect(t.at ?? 0).toBeGreaterThanOrEqual(0);
  }
  for (const n of r.noises) {
    expect(n.dur).toBeGreaterThan(0);
    expect(n.vol ?? 0.2).toBeLessThanOrEqual(0.5);
  }
}

describe('sound effects', () => {
  it('every weapon has its own firing sound', () => {
    for (const w of allWeapons()) {
      const r = new Recorder();
      expect(FIRE_SOUNDS[w.id], w.id).toBeDefined();
      FIRE_SOUNDS[w.id]!(r, { cue: 'fire', weaponId: w.id, size: 60 });
      sane(r);
    }
  });

  it('burst weapons blip on every round', () => {
    for (const w of allWeapons().filter((w) => 'burst' in w && w.burst)) {
      const r = new Recorder();
      ROUND_SOUNDS[w.id]!(r, { cue: 'round', weaponId: w.id });
      sane(r);
    }
  });

  it('every game event has a sound', () => {
    for (const [cue, recipe] of Object.entries(CUE_SOUNDS)) {
      const r = new Recorder();
      recipe(r, { cue: cue as SfxCue, size: 20 });
      sane(r);
    }
  });

  it('long weapons sound for as long as they last', () => {
    const r = new Recorder();
    FIRE_SOUNDS['ten-2']!(r, { cue: 'fire', weaponId: 'ten-2' });
    const last = Math.max(...r.tones.map((t) => (t.at ?? 0) + t.dur));
    expect(last).toBeGreaterThan(weaponOf('ten-2', 'jetpack').jetpack.chargeTime - 0.4);
  });

  it('throttles rapid repeats (a pill storm) but not different sounds', () => {
    let now = 0;
    const r = new Recorder();
    const player = new SfxPlayer(r, () => now);
    for (let i = 0; i < 50; i++) player.play({ cue: 'boom', weaponId: 'unmedicated', size: 11 });
    expect(player.played).toBe(1);
    player.play({ cue: 'hit', size: 5 });
    expect(player.played).toBe(2);
    now = 0.1;
    player.play({ cue: 'boom', weaponId: 'unmedicated', size: 11 });
    expect(player.played).toBe(3);
  });

  it('an event naming a weapon that doesn\'t exist still plays (it never throws)', () => {
    const player = new SfxPlayer(new Recorder(), () => 0);
    expect(() => player.play({ cue: 'boom', weaponId: 'no-such-weapon', size: 20 })).not.toThrow();
    expect(() => player.play({ cue: 'tune', weaponId: 'no-such-weapon' })).not.toThrow();
    expect(player.played).toBe(2);
  });
});

describe('the game queues sound cues', () => {
  const players = [
    { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
    { name: 'tones', colour: '#ff5a5f', characterId: 'tones' },
  ];

  it('firing, blasts and hits', () => {
    const g = createGame({ seed: 3, players });
    fire(g);
    expect(g.sfx).toContainEqual(expect.objectContaining({ cue: 'fire', weaponId: 'weasel-pop' }));
    explode(g, g.players[1]!.x, g.players[1]!.y - 8, getWeapon('shell'), g.current);
    expect(g.sfx.map((e) => e.cue)).toEqual(expect.arrayContaining(['boom', 'hit']));
  });

  it("Steal's roulette ticks, then ka-chings", () => {
    const g = createGame({ seed: 3, players });
    selectTier(g, 2);
    fire(g);
    for (let t = 0; t < STEAL_SPIN + 0.1; t += FIXED_DT) step(g, FIXED_DT);
    const cues = g.sfx.map((e) => e.cue);
    expect(cues.filter((c) => c === 'tick').length).toBeGreaterThan(10);
    expect(cues.at(-1)).toBe('stolen');
  });

  it('keeps the queue bounded when nobody drains it', () => {
    const g = createGame({ seed: 3, players });
    for (let i = 0; i < 200; i++) explode(g, 10, 10, getWeapon('unmedicated'), g.current);
    expect(g.sfx.length).toBeLessThanOrEqual(64);
  });
});

describe('the XP screen’s sounds', () => {
  it('each plays something sane; the notch blips climb', async () => {
    const { XP_SOUNDS } = await import('../src/audio/xp');
    for (const play of Object.values(XP_SOUNDS)) {
      for (const n of [1, 6]) {
        const r = new Recorder();
        play(r, n);
        sane(r);
      }
    }
    const pitch = (n: number) => {
      const r = new Recorder();
      XP_SOUNDS.notch(r, n);
      return r.tones[0]!.from;
    };
    expect([1, 2, 3, 4, 5, 6].map(pitch)).toEqual([...[1, 2, 3, 4, 5, 6].map(pitch)].sort((a, b) => a - b));
    expect(new Set([1, 2, 3, 4, 5, 6].map(pitch)).size).toBe(6);
  });
});

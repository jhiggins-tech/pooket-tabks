import { describe, expect, it } from 'vitest';
import { longExposure } from '../src/characters/kits';
import { MAX_HP } from '../src/game/constants';
import {
  bestPhoto,
  cameraClock,
  cameraInput,
  cameraReady,
  canFire,
  DEVELOP,
  gradeAt,
  gradeRank,
  REVEAL,
  REVIEW_TIME,
  dialRole,
  exposureOf,
  fire,
  frameCentre,
  frameOf,
  isCamera,
  meter,
  ringFor,
  ringMetres,
  seesAim,
  selectTier,
  tankCentre,
  type CameraAction,
} from '../src/game/game';
import type { GameState } from '../src/game/state';
import { applyPreview, previewOf } from '../src/net/follow';
import { LENSES, MODES, PX_PER_M } from '../src/weapons/camera';
import { run, testGame, untilAiming } from './support/game';

const players = [
  { name: 'kiwicore', colour: '#84cc16', characterId: 'kiwicore' },
  { name: 'kcaj', colour: '#ffc53d', characterId: 'kcaj' },
];

/** kiwicore at 300 and kcaj at 700, on flat ground; kiwicore to play, with Long Exposure selected. */
function game(seed = 4): GameState {
  const g = testGame({ seed, players, xs: [300, 700] });
  g.current = 0;
  selectTier(g, 2);
  return g;
}

/** FIRE: the camera comes up (it's fired once the card's done). */
function raise(g: GameState): void {
  expect(fire(g)).toBe(false);
  expect(g.phase).toBe('shooting');
}

const act = (g: GameState, a: CameraAction) => cameraInput(g, a);
const cues = (g: GameState) => g.sfx.map((e) => e.cue);

/**
 * Everything right, by hand: M, sunny 16 on the 200mm (f/11 at 1/250, ISO 100), Daylight, focused on kcaj,
 * and kcaj on the frame's top-left thirds point (allowing for the hand shake right now).
 */
function nail(g: GameState): void {
  const c = g.camera!;
  c.scene = 1; // Sunny: EV 15, 5500K
  c.mode = 3;
  c.lens = 2;
  c.ap = 5;
  c.sh = 4;
  c.iso = 0;
  c.wb = 2;
  c.flash = false;
  c.af = false;
  const kcaj = g.players[1]!;
  const me = tankCentre(g.players[0]!);
  const at = { x: kcaj.x, y: kcaj.y - 4 };
  c.ring = ringFor(Math.hypot(at.x - me.x, at.y - me.y) / PX_PER_M);
  aimAt(g, at.x, at.y, 1 / 3, 1 / 3);
}

/** Point the frame so (x, y) is at (fx, fy) of the way across and down it, allowing for the shake. */
function aimAt(g: GameState, x: number, y: number, fx: number, fy: number): void {
  const c = g.camera!;
  const { w, h } = frameOf(c);
  c.x = x + w / 2 - w * fx;
  c.y = y + h / 2 - h * fy;
  const f = frameCentre(c);
  c.x += c.x - f.x;
  c.y += c.y - f.y;
}

/** Take the card's three photos (as they are each time) and keep the best. */
function shootCard(g: GameState, between?: (i: number) => void): void {
  for (let i = 0; i < 3; i++) {
    between?.(i);
    act(g, { k: 'shutter' });
    expect(g.camera!.view).toBe('review'); // the last one's too
    act(g, { k: 'next' });
  }
  expect(g.camera!.view).toBe('card');
  act(g, { k: 'keep' }); // skips the showcase
  act(g, { k: 'keep' });
  expect(cameraReady(g)).toBe(true);
}

describe("kiwicore's Long Exposure", () => {
  it('is his tier 3: FIRE raises the camera in M, scrambled, with 20 s on the clock, and the round waits for the card', () => {
    const g = game();
    const kiwi = g.players[0]!;
    expect(kiwi.loadout[2]).toBe('long-exposure');
    expect(isCamera(kiwi, 2)).toBe(true);
    raise(g);
    const c = g.camera!;
    expect(kiwi.ammo[2]).toBe(1);
    expect(canFire(g)).toBe(false);
    expect(cues(g)).toContain('camera-up');
    expect(MODES[c.mode]!.id).toBe('M');
    expect(c.left).toBe(longExposure.camera.shotTime);
    expect(longExposure.camera.shotTime).toBe(20);
    // Scrambled: the exposure's well out and nothing's in the frame.
    const m = meter(g, c);
    expect(Math.abs(m.err)).toBeGreaterThanOrEqual(1.5);
    expect(m.subject).toBeNull();
  });

  it('the scramble comes from the seed: the same match starts the camera the same way', () => {
    const a = game(9);
    const b = game(9);
    raise(a);
    raise(b);
    expect(b.camera).toEqual(a.camera);
  });

  it('the perfect shot: every factor an A+, the most damage, and a PERFECT SHOT on the hit', () => {
    const g = game();
    const kcaj = g.players[1]!;
    raise(g);
    nail(g);
    const m = meter(g, g.camera!);
    expect(m.subject).not.toBeNull();
    expect(m.scores.map((v) => v >= 0.95)).toEqual([true, true, true, true, true, true]);
    shootCard(g, () => nail(g));
    const best = bestPhoto(g.camera!)!;
    expect(best.perfect).toBe(true);
    expect(best.damage).toBe(MODES[3].cap);
    expect(fire(g)).toBe(true);
    expect(g.players[0]!.ammo[2]).toBe(0);
    run(g, DEVELOP.hit - 0.05);
    expect(kcaj.hp).toBe(MAX_HP);
    run(g, 0.1);
    expect(kcaj.hp).toBe(MAX_HP - 77);
    expect(cues(g)).toContain('camera-perfect');
    expect(g.fx.floaters.some((f) => f.text === 'PERFECT SHOT')).toBe(true);
    untilAiming(g);
    expect(g.camera).toBeNull();
    expect(g.current).toBe(1);
  });

  it('every factor counts: out of focus, a slow shutter, high ISO or the wrong white balance each cost damage', () => {
    const perfect = (() => {
      const g = game();
      raise(g);
      nail(g);
      act(g, { k: 'shutter' });
      return g.camera!.photos[0]!.damage;
    })();
    const spoil: [string, (g: GameState) => void, number][] = [
      ['focus', (g) => (g.camera!.ring = 5), 1],
      ['sharpness', (g) => (g.camera!.sh = 0), 2],
      ['noise', (g) => (g.camera!.iso = 6), 3],
      ['white balance', (g) => (g.camera!.wb = 1), 4],
    ];
    for (const [name, f, i] of spoil) {
      const g = game();
      raise(g);
      nail(g);
      f(g);
      act(g, { k: 'shutter' });
      const p = g.camera!.photos[0]!;
      expect(p.scores[i], name).toBeLessThan(0.95);
      expect(p.damage, name).toBeLessThan(perfect);
      expect(p.perfect, name).toBe(false);
    }
  });

  it('composition: dead centre is worse than on a third', () => {
    const g = game();
    raise(g);
    nail(g);
    const thirds = meter(g, g.camera!).scores[5]!;
    const kcaj = g.players[1]!;
    aimAt(g, kcaj.x, kcaj.y - 4, 0.5, 0.5);
    expect(meter(g, g.camera!).scores[5]!).toBeLessThan(thirds);
  });

  it('nothing in the frame: no damage, and the card says so', () => {
    const g = game();
    const kcaj = g.players[1]!;
    raise(g);
    shootCard(g);
    expect(g.camera!.photos.every((p) => p.damage === 0 && !p.mark)).toBe(true);
    fire(g);
    untilAiming(g);
    expect(kcaj.hp).toBe(MAX_HP);
  });

  it('three shots on the card and the best counts, wherever it is on the card', () => {
    const g = game();
    const kcaj = g.players[1]!;
    raise(g);
    shootCard(g, (i) => {
      nail(g);
      if (i !== 1) g.camera!.iso = 6;
    });
    const c = g.camera!;
    expect(c.photos).toHaveLength(3);
    expect(bestPhoto(c)).toBe(c.photos[1]);
    const dmg = c.photos[1]!.damage;
    fire(g);
    untilAiming(g);
    expect(kcaj.hp).toBe(MAX_HP - dmg);
  });

  it('playback moves on by itself after 5 s: to the next shot, and after the last, the card', () => {
    const g = game();
    raise(g);
    for (let i = 0; i < 3; i++) {
      act(g, { k: 'shutter' });
      const c = g.camera!;
      expect(c.view).toBe('review');
      expect(c.left).toBe(REVIEW_TIME);
      cameraClock(g, REVIEW_TIME - 0.1);
      expect(c.view).toBe('review');
      cameraClock(g, 0.2);
      expect(c.view).toBe(i < 2 ? 'aim' : 'card');
      if (i < 2) expect(c.left).toBe(20);
    }
    expect(REVIEW_TIME).toBe(5);
  });

  it('keep best early skips the rest of the card', () => {
    const g = game();
    raise(g);
    nail(g);
    act(g, { k: 'shutter' });
    expect(g.camera!.view).toBe('review');
    act(g, { k: 'keep' });
    expect(g.camera!.view).toBe('card');
    act(g, { k: 'keep' });
    expect(g.camera!.reveal).toBe(REVEAL.end);
    act(g, { k: 'keep' });
    expect(cameraReady(g)).toBe(true);
    expect(g.camera!.photos).toHaveLength(1);
  });

  it('at zero the shutter fires by itself, and the clock is per shot', () => {
    const g = game();
    raise(g);
    cameraClock(g, 19.9);
    expect(g.camera!.photos).toHaveLength(0);
    cameraClock(g, 0.2);
    expect(g.camera!.photos).toHaveLength(1);
    expect(g.camera!.photos[0]!.auto).toBe(true);
    expect(g.camera!.view).toBe('review');
    cameraClock(g, 5); // playback: the clock's stopped
    expect(g.camera!.photos).toHaveLength(1);
    act(g, { k: 'next' });
    expect(g.camera!.left).toBe(20);
  });

  it('the clock warns: a pip at 10 s, then 3, 2, 1', () => {
    const g = game();
    raise(g);
    g.sfx.length = 0;
    for (let t = 0; t < 19.9; t += 0.05) cameraClock(g, 0.05);
    const warnings = g.sfx.filter((e) => e.cue === 'camera-pip' || e.cue === 'camera-count').map((e) => (e.cue === 'camera-pip' ? 'pip' : e.size));
    expect(warnings).toEqual(['pip', 3, 2, 1]);
  });

  it('the showcase: the best photo’s grades land one by one with their gacha sounds, then the count-up and the big reveal', () => {
    const g = game();
    raise(g);
    nail(g);
    act(g, { k: 'shutter' });
    act(g, { k: 'keep' });
    expect(g.camera!.view).toBe('card');
    expect(g.camera!.reveal).toBe(0);
    g.sfx.length = 0;
    // Keep does nothing to the card till it's over (it skips).
    expect(cameraReady(g)).toBe(false);
    for (let t = 0; t < REVEAL.end + 1; t += 0.05) cameraClock(g, 0.05);
    expect(g.camera!.reveal).toBe(REVEAL.end);
    const grades = g.sfx.filter((e) => e.cue === 'camera-grade').map((e) => e.size);
    const best = g.camera!.photos[0]!;
    expect(grades).toEqual([...best.scores.map((v, i) => i * 5 + gradeRank(v)), 30 + 4]);
    expect(g.sfx.map((e) => e.cue)).toEqual(expect.arrayContaining(['camera-tally', 'camera-reveal']));
    expect(g.sfx.find((e) => e.cue === 'camera-reveal')!.size).toBe(3); // a Perfect Shot
    expect(gradeAt(5)).toBeLessThan(REVEAL.overall);
    act(g, { k: 'keep' });
    expect(cameraReady(g)).toBe(true);
  });

  it('skipping the showcase plays just the reveal', () => {
    const g = game();
    raise(g);
    act(g, { k: 'shutter' });
    act(g, { k: 'keep' });
    g.sfx.length = 0;
    act(g, { k: 'keep' });
    expect(g.sfx.map((e) => [e.cue, e.size])).toEqual([['camera-reveal', 0]]); // nothing in it
  });

  it('the easier modes cap what a photo does: P 35, Tv and Av 60, M 77', () => {
    expect(MODES.map((m) => m.cap)).toEqual([35, 60, 60, 77]);
    for (const [mode, cap] of [
      [0, 35],
      [1, 60],
      [2, 60],
    ] as const) {
      const g = game();
      raise(g);
      nail(g);
      g.camera!.mode = mode;
      act(g, { k: 'shutter' });
      const p = g.camera!.photos[0]!;
      expect(p.damage).toBeLessThanOrEqual(cap);
    }
  });

  it('Av and Tv pick the other half of the exposure, and P picks both', () => {
    const g = game();
    raise(g);
    nail(g);
    const c = g.camera!;
    c.mode = 2; // Av
    c.sh = 0;
    expect(Math.abs(meter(g, c).err)).toBeLessThan(0.5);
    c.mode = 1; // Tv
    c.sh = 4;
    c.ap = 0;
    expect(Math.abs(meter(g, c).err)).toBeLessThan(0.5);
    c.mode = 0; // P
    expect(Math.abs(meter(g, c).err)).toBeLessThan(0.5);
    expect(dialRole(c, 'main')).toBe('AUTO');
  });

  it('the dials: in M the main dial is the shutter and the quick dial the aperture; ISO and WB take them over until SET', () => {
    const g = game();
    raise(g);
    const c = g.camera!;
    c.mode = 3;
    c.sh = 3;
    c.ap = 3;
    act(g, { k: 'dial', dial: 'main', d: 1 });
    act(g, { k: 'dial', dial: 'quick', d: -1 });
    expect([c.sh, c.ap]).toEqual([4, Math.max(2, LENSES[c.lens]!.widest)]);
    act(g, { k: 'fn', fn: 'iso' });
    expect(dialRole(c, 'main')).toBe('ISO');
    const iso = c.iso;
    act(g, { k: 'dial', dial: 'main', d: 1 });
    expect(c.iso).toBe(Math.min(6, iso + 1));
    act(g, { k: 'set' });
    expect(dialRole(c, 'main')).toBe('SHUTTER');
    expect(exposureOf(c).sh).toBe(c.sh);
  });

  it('AF-ON focuses on what is under the centre point', () => {
    const g = game();
    raise(g);
    nail(g);
    const c = g.camera!;
    const kcaj = g.players[1]!;
    aimAt(g, kcaj.x, kcaj.y - 4, 0.5, 0.5);
    c.ring = 5;
    act(g, { k: 'afon' }); // MF: does nothing
    expect(c.ring).toBe(5);
    act(g, { k: 'afmf' });
    act(g, { k: 'afon' });
    const me = tankCentre(g.players[0]!);
    expect(ringMetres(c.ring)).toBeCloseTo(Math.hypot(kcaj.x - me.x, kcaj.y - me.y) / PX_PER_M, 0);
    expect(meter(g, c).scores[1]).toBeGreaterThanOrEqual(0.95);
  });

  it('the flash fills in a dark photo, caps its exposure, and blinds whoever it hits: no aim guide on their next turn', () => {
    const g = game();
    const kcaj = g.players[1]!;
    raise(g);
    nail(g);
    const c = g.camera!;
    c.sh = 6; // two stops under
    const dark = meter(g, c).scores[0]!;
    c.flash = true;
    const lit = meter(g, c).scores[0]!;
    expect(lit).toBeGreaterThan(dark);
    expect(lit).toBeLessThanOrEqual(0.8);
    shootCard(g, () => {
      nail(g);
      c.sh = 6;
      c.flash = true;
    });
    fire(g);
    untilAiming(g);
    expect(g.current).toBe(1);
    expect(seesAim(kcaj)).toBe(false);
    expect(cues(g)).toContain('blinded');
    // It wears off at the end of their turn.
    selectTier(g, 0);
    fire(g);
    untilAiming(g);
    expect(seesAim(kcaj)).toBe(true);
  });

  it('other phones see the same viewfinder: the previews carry the camera', () => {
    const g = game();
    const there = game();
    raise(g);
    nail(g);
    act(g, { k: 'fn', fn: 'wb' });
    applyPreview(there, previewOf(g));
    expect(there.phase).toBe('shooting');
    expect(there.camera).toEqual(g.camera);
  });

  it('other phones hear it too: the shutter, the clock’s warnings and the showcase', () => {
    const g = game();
    const there = game();
    raise(g);
    applyPreview(there, structuredClone(previewOf(g)));
    there.sfx.length = 0;
    cameraClock(g, 10.5);
    applyPreview(there, structuredClone(previewOf(g)));
    expect(there.sfx.map((e) => e.cue)).toEqual(['camera-pip']);
    act(g, { k: 'shutter' });
    act(g, { k: 'keep' });
    applyPreview(there, structuredClone(previewOf(g)));
    for (const dt of [0.3, 0.3]) {
      cameraClock(g, dt);
      applyPreview(there, structuredClone(previewOf(g)));
    }
    expect(there.sfx.map((e) => e.cue)).toEqual(['camera-pip', 'camera-shutter', 'camera-grade']);
  });
});

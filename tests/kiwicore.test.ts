import { describe, expect, it } from 'vitest';
import { berettaM2 } from '../src/characters/kits';
import { MAX_HP } from '../src/game/constants';
import { boomerangPoint, fire, selectTier, setAim, tankCentre, wearsCap } from '../src/game/game';
import type { GameState } from '../src/game/state';
import { testGame, untilAiming, whileFlying } from './support/game';

const players = [
  { name: 'kiwicore', colour: '#84cc16', characterId: 'kiwicore' },
  { name: 'kcaj', colour: '#ffc53d', characterId: 'kcaj' },
];

const spec = berettaM2.boomerang;
/** The power that makes a throw reach `range` px. */
const powerFor = (range: number) => (100 * (range - spec.minRange)) / (spec.maxRange - spec.minRange);

/** kiwicore at 300, kcaj 400 px away at 700 (a ridge between them, by default). */
function game(heights: (x: number) => number = (x) => (x > 480 && x < 520 ? 250 : 400)): GameState {
  return testGame({ seed: 5, players, heights, xs: [300, 700] });
}

function throwAt(g: GameState, angle: number, power: number): void {
  selectTier(g, 0);
  setAim(g, angle, power);
  fire(g);
}

describe("kiwicore's berètta M2", () => {
  it('flies through the hills to the end of its loop and back: 20 out, 20 back, on whatever is at the far end', () => {
    const g = game();
    const kcaj = g.players[1]!;
    const solid = g.terrain.solid.reduce((n, v) => n + v, 0);
    throwAt(g, 0, powerFor(400));
    const hits: number[] = [];
    let hp = kcaj.hp;
    whileFlying(g, () => {
      if (kcaj.hp !== hp) hits.push(hp - kcaj.hp);
      hp = kcaj.hp;
    });
    expect(hits).toEqual([spec.damage, spec.damage]); // once a pass, both passes
    expect(kcaj.hp).toBe(MAX_HP - 2 * spec.damage);
    expect(g.terrain.solid.reduce((n, v) => n + v, 0)).toBe(solid); // no crater, no marks
    expect(g.tally[0]!.dealt['beretta-m2']).toBe(2 * spec.damage);
  });

  it('can catch a tank on one pass only: here on the way back', () => {
    const g = game();
    const kcaj = g.players[1]!;
    // At 4/5 of the way round, the cap is 0.65 × its reach out, 25.9° below the aim: aim that much above kcaj.
    const s = 0.8;
    const along = Math.sin(Math.PI * s);
    const across = spec.curl * Math.sin(2 * Math.PI * s);
    const range = 400 / Math.hypot(along, across);
    throwAt(g, (-Math.atan2(across, along) * 180) / Math.PI, powerFor(range));
    whileFlying(g);
    expect(kcaj.hp).toBe(MAX_HP - spec.damage);
  });

  it('the aim sets which way and the power how far: the far end of the loop is right on the aim line', () => {
    const g = game();
    const kiwi = g.players[0]!;
    throwAt(g, 30, 60);
    const b = g.boomerangs[0]!;
    const from = tankCentre(kiwi);
    const tip = boomerangPoint(b, spec.curl, 0.5);
    const reach = spec.minRange + ((spec.maxRange - spec.minRange) * 60) / 100;
    expect(tip.x - from.x).toBeCloseTo(reach * Math.cos(Math.PI / 6), 6);
    expect(from.y - tip.y).toBeCloseTo(reach * Math.sin(Math.PI / 6), 6);
    // It goes out above the aim line and comes back below it, whichever way it's thrown.
    const out = boomerangPoint(b, spec.curl, 0.25);
    expect(out.y).toBeLessThan(from.y - (out.x - from.x) * Math.tan(Math.PI / 6));
    const left = game();
    throwAt(left, 180, 60);
    const lb = left.boomerangs[0]!;
    expect(boomerangPoint(lb, spec.curl, 0.25).y).toBeLessThan(lb.y0);
    expect(boomerangPoint(lb, spec.curl, 0.75).y).toBeGreaterThan(lb.y0);
  });

  it('falls short with too little power, and he catches it unharmed; the turn moves on', () => {
    const g = game();
    const [kiwi, kcaj] = g.players as [typeof g.players[0], typeof g.players[0]];
    throwAt(g, 0, 0);
    expect(g.phase).toBe('flying');
    whileFlying(g);
    expect(g.boomerangs).toEqual([]);
    expect(g.sfx.some((e) => e.cue === 'catch')).toBe(true);
    expect([kiwi.hp, kcaj.hp]).toEqual([MAX_HP, MAX_HP]);
    expect(kiwi.ammo[0]).toBe(4);
    untilAiming(g);
    expect(g.current).toBe(1);
  });

  it('he wears the cap, except while it is flying', () => {
    const g = game();
    const [kiwi, kcaj] = g.players as [typeof g.players[0], typeof g.players[0]];
    expect(wearsCap(g, kiwi)).toBe(true);
    expect(wearsCap(g, kcaj)).toBe(false);
    throwAt(g, 45, 50);
    expect(wearsCap(g, kiwi)).toBe(false);
    whileFlying(g);
    expect(wearsCap(g, kiwi)).toBe(true);
  });
});

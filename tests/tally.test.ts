import { describe, expect, it } from 'vitest';
import { MAX_HP } from '../src/game/constants';
import { fire, selectTier, setAim } from '../src/game/game';
import type { GameState } from '../src/game/state';
import { applySnapshot, takeSnapshot, upgradeSnapshot } from '../src/net/snapshot';
import { allWeapons } from '../src/weapons/registry';
import { testGame, untilAiming, untilNextTurn } from './support/game';

/** kcaj at 200 and `who` at 500 on flat ground; kcaj fires Hyperfixate straight at them. */
function beamed(who = 'kie', hp?: number): GameState {
  const g = testGame({
    players: [
      { name: 'kcaj', colour: '#f0f', characterId: 'kcaj' },
      { name: who, colour: '#4ea8ff', characterId: who },
    ],
    xs: [200, 500],
  });
  if (hp !== undefined) g.players[1]!.hp = hp;
  selectTier(g, 1); // Hyperfixate
  setAim(g, 0, 50);
  fire(g);
  untilNextTurn(g); // the next turn comes up: the burn ticks
  return g;
}

describe('the stats tally', () => {
  it('counts the shot and the hit, and credits the damage (the burn too, though it ticks after the shot’s turn)', () => {
    const g = beamed();
    const [kcaj, kie] = g.tally;
    expect(kcaj!.shots).toEqual({ hyperfixate: 1 });
    expect(kcaj!.hits).toEqual({ hyperfixate: 1 });
    expect(kcaj!.dealt).toEqual({ hyperfixate: 15 + 8 });
    expect(kie!.taken).toBe(23);
    expect(MAX_HP - g.players[1]!.hp).toBe(23);
    expect(g.players[1]!.burn).toMatchObject({ by: 0, weaponId: 'hyperfixate' });
  });

  it('a miss is a shot without a hit; a kill counts once, and only the health that was there', () => {
    const g = beamed('kie', 10);
    expect(g.players[1]!.alive).toBe(false);
    expect(g.tally[0]).toMatchObject({ dealt: { hyperfixate: 10 }, kills: 1 });
    const m = testGame({
      players: [
        { name: 'kcaj', colour: '#f0f', characterId: 'kcaj' },
        { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
      ],
      xs: [200, 500],
    });
    selectTier(m, 1);
    setAim(m, 180, 50); // the other way
    fire(m);
    untilAiming(m);
    expect(m.tally[0]).toMatchObject({ shots: { hyperfixate: 1 }, hits: {}, dealt: {}, kills: 0 });
  });

  it('a jet that lands drop after drop is still one shot, one hit', () => {
    const g = testGame({
      players: [
        { name: 'tones2', colour: '#ffcc1f', characterId: 'tones' },
        { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
      ],
      xs: [200, 260],
    });
    selectTier(g, 0);
    setAim(g, 0, 75);
    fire(g);
    untilAiming(g);
    const t = g.tally[0]!;
    expect(t.shots).toEqual({ 'ten-1': 1 });
    expect(t.hits).toEqual({ 'ten-1': 1 });
    expect(t.dealt['ten-1']).toBe(MAX_HP - g.players[1]!.hp);
  });

  /** tones2 against kie, at `xs`, on the given seed. */
  function tonesVsKie(seed: number, xs: [number, number]): GameState {
    return testGame({
      seed,
      players: [
        { name: 'tones2', colour: '#ffcc1f', characterId: 'tones' },
        { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
      ],
      xs,
    });
  }

  it('ten-2’s mud landing on an enemy is a hit', () => {
    const g = tonesVsKie(12, [300, 360]); // kie under the early flight path, where the exhaust falls
    selectTier(g, 1);
    setAim(g, 55, 60);
    fire(g);
    untilAiming(g);
    const t = g.tally[0]!;
    expect(t.shots).toEqual({ 'ten-2': 1 });
    expect(t.hits).toEqual({ 'ten-2': 1 });
    expect(t.dealt['ten-2']).toBeGreaterThan(0);
  });

  it('ten-3’s spew landing on an enemy is a hit; one that lands on nobody isn’t', () => {
    const g = tonesVsKie(30, [300, 370]);
    selectTier(g, 2);
    setAim(g, 25, 45);
    fire(g);
    untilAiming(g);
    expect(g.tally[0]).toMatchObject({ shots: { 'ten-3': 1 }, hits: { 'ten-3': 1 } });
    expect(g.tally[0]!.dealt['ten-3']).toBe(MAX_HP - g.players[1]!.hp);

    const miss = tonesVsKie(30, [300, 1200]);
    selectTier(miss, 2);
    setAim(miss, 25, 45);
    fire(miss);
    untilAiming(miss);
    expect(miss.tally[0]).toMatchObject({ shots: { 'ten-3': 1 }, hits: {} });
  });

  it('ten-3’s toxic sludge burning an enemy is a hit too', () => {
    const g = tonesVsKie(30, [300, 460]);
    const kie = g.players[1]!;
    selectTier(g, 2);
    setAim(g, 20, 50);
    fire(g);
    // Just one chunk, dropped on the ground beside kie's hull: only the puddle it leaves touches kie.
    g.spews = [];
    g.sludge = [{ x: kie.x + 15, y: 385, vx: 0, vy: 0, ownerId: 0, weaponId: 'ten-3', look: 0.5, age: 1 }];
    let dosed = false;
    untilAiming(g, () => (dosed ||= kie.toxin > 0));
    expect(dosed).toBe(false);
    expect(kie.hp).toBeLessThan(MAX_HP);
    expect(g.tally[0]).toMatchObject({ shots: { 'ten-3': 1 }, hits: { 'ten-3': 1 } });
  });

  it('soaking weapons (streams, gunk) carry no effect flags, and gunk passes its owner’s tanks (tanks.ts applySoak)', () => {
    const soaking = allWeapons().filter((w) => w.kind === 'stream' || 'gunk' in w);
    expect(soaking.length).toBeGreaterThanOrEqual(4);
    for (const w of soaking) {
      expect([w.id, w.dot, w.debuff, w.tattoo, w.pin]).toEqual([w.id, undefined, undefined, undefined, undefined]);
      if ('gunk' in w) expect([w.id, w.friendlyFire]).toEqual([w.id, false]);
    }
  });

  it('moves that do no damage themselves aren’t shots (Twins)', () => {
    const g = testGame({
      players: [
        { name: 'torikloud', colour: '#a78bfa', characterId: 'torikloud' },
        { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
      ],
      xs: [200, 800],
    });
    selectTier(g, 2);
    fire(g);
    untilAiming(g);
    expect(g.tally[0]!.shots).toEqual({});
  });

  it('a stored match from before the tally starts it at nothing, burns and all', () => {
    const g = beamed();
    const snap = takeSnapshot(g);
    delete snap.tally;
    delete snap.tallyShot;
    const burn = (snap.players as { burn: Record<string, unknown> }[])[1]!.burn;
    delete burn.by;
    delete burn.weaponId;
    applySnapshot(g, upgradeSnapshot(snap));
    expect(g.tally).toHaveLength(2);
    expect(g.tally[0]).toEqual({ shots: {}, hits: {}, dealt: {}, taken: 0, self: 0, kills: 0 });
    expect(g.players[1]!.burn).toMatchObject({ by: -1, weaponId: '' });
  });
});

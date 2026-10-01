import { describe, expect, it } from 'vitest';
import { FIXED_DT, MAX_HP, TANK_BODY_HEIGHT } from '../src/game/constants';
import {
  canPickDecoy,
  currentPlayer,
  DECOY_PICK_TIME,
  decoyPickLeft,
  explode,
  finishDecoyPick,
  fire,
  hologramAt,
  hologramsOf,
  isAimless,
  selectTier,
  setAim,
  step,
  targetAt,
  toggleSwapTarget,
} from '../src/game/game';
import type { GameState, Hologram } from '../src/game/state';
import { trollogram } from '../src/characters/kits';
import { shell } from '../src/weapons/registry';
import { passTurn, testGame, untilNextTurn } from './support/game';

const players = [
  { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
  { name: 'kcaj', colour: '#ffc53d', characterId: 'kcaj' },
];

function flatGame(seed = 3): GameState {
  return testGame({ seed, players });
}

/** kie fires Trollogram, kcaj passes, and it's kie's turn again with two decoys out. */
function withDecoys(): GameState {
  const g = flatGame();
  selectTier(g, 1);
  fire(g);
  untilNextTurn(g);
  passTurn(g); // kcaj
  expect(currentPlayer(g).name).toBe('kie');
  return g;
}

describe('Trollogram', () => {
  it("is kie's tier 2 and needs no aiming", () => {
    const g = flatGame();
    expect(g.players[0]!.loadout[1]).toBe(trollogram.id);
    selectTier(g, 1);
    expect(isAimless(g)).toBe(true);
  });

  it('spawns two holograms on the ground, spread out from every tank', () => {
    const g = flatGame();
    selectTier(g, 1);
    fire(g);
    const holos = hologramsOf(g, 0);
    expect(holos).toHaveLength(2);
    const xs = [...g.players.map((p) => p.x), ...holos.map((h) => h.x)];
    for (let i = 0; i < xs.length; i++) {
      for (let j = i + 1; j < xs.length; j++) expect(Math.abs(xs[i]! - xs[j]!)).toBeGreaterThanOrEqual(70);
    }
    for (const h of holos) expect(h.y).toBe(g.terrain.surfaceY(h.x));
    untilNextTurn(g);
    expect(currentPlayer(g).name).toBe('kcaj');
  });

  it('has 3 uses, and each one adds two more holograms', () => {
    const g = flatGame();
    expect(g.players[0]!.ammo[1]).toBe(3);
    const ids: number[][] = [];
    for (let use = 1; use <= 3; use++) {
      selectTier(g, 1);
      fire(g);
      ids.push(hologramsOf(g, 0).map((h) => h.id));
      expect(hologramsOf(g, 0)).toHaveLength(use * 2);
      untilNextTurn(g);
      passTurn(g); // kcaj
    }
    // The earlier ones are still out.
    expect(ids[2]).toEqual(expect.arrayContaining(ids[0]!));
    expect(g.players[0]!.ammo[1]).toBe(0);
  });

  it('holograms are hit like real tanks', () => {
    const g = withDecoys();
    const h = hologramsOf(g, 0)[0]!;
    expect(targetAt(g, h.x, h.y - TANK_BODY_HEIGHT)).toEqual({ kind: 'hologram', holo: h });
  });

  it('unhit holograms stay out turn after turn', () => {
    const g = withDecoys();
    passTurn(g); // kie
    passTurn(g); // kcaj
    passTurn(g); // kie
    expect(hologramsOf(g, 0)).toHaveLength(2);
  });

  it('kie can pick a hologram on his turn; the swap happens only once his shot has landed', () => {
    const g = withDecoys();
    const kie = g.players[0]!;
    const h = hologramsOf(g, 0)[1]!;
    const before = { tank: { x: kie.x, y: kie.y }, holo: { x: h.x, y: h.y } };

    expect(hologramAt(g, h.x + 5, h.y - 10, 20)).toBe(h);
    expect(toggleSwapTarget(g, h.id)).toBe(true);
    expect(g.swapTargetId).toBe(h.id);

    selectTier(g, 0);
    setAim(g, 165, 100); // all three weasels sail off the left edge of the flat map
    fire(g);
    // Mid-turn: nothing has moved yet, and the pick can't be changed any more.
    step(g, FIXED_DT);
    expect({ x: kie.x, y: kie.y }).toEqual(before.tank);
    expect(toggleSwapTarget(g, h.id)).toBe(false);

    untilNextTurn(g);
    expect({ x: kie.x, y: kie.y }).toEqual(before.holo);
    expect({ x: h.x, y: h.y }).toEqual(before.tank);
    expect(g.swapTargetId).toBeNull();
  });

  it('tapping the chosen hologram again cancels the swap', () => {
    const g = withDecoys();
    const kie = g.players[0]!;
    const x0 = kie.x;
    const h = hologramsOf(g, 0)[0]!;
    toggleSwapTarget(g, h.id);
    toggleSwapTarget(g, h.id);
    expect(g.swapTargetId).toBeNull();
    passTurn(g);
    expect(kie.x).toBe(x0);
  });

  it("the opponent can't pick kie's holograms", () => {
    const g = flatGame();
    selectTier(g, 1);
    fire(g);
    untilNextTurn(g);
    expect(currentPlayer(g).name).toBe('kcaj');
    const h = hologramsOf(g, 0)[0]!;
    expect(hologramAt(g, h.x, h.y - 8, 20)).toBeUndefined();
    expect(toggleSwapTarget(g, h.id)).toBe(false);
  });

  it('a hit hologram shows the damage like a real tank, then blows up', () => {
    const g = withDecoys();
    passTurn(g); // kie
    const [kie, kcaj] = g.players as [(typeof g.players)[0], (typeof g.players)[0]];
    const h = hologramsOf(g, 0)[0]!;

    // kcaj lands a direct Heavy-style hit on the hologram (well away from both tanks).
    fire(g);
    g.projectiles = [];
    explode(g, h.x, h.y - TANK_BODY_HEIGHT, shell, kcaj.id);
    expect(g.fx.floaters.at(-1)!.text).toBe(`-${shell.damage}`); // looks like a real hit
    expect(h.hit).toBe(true);
    step(g, FIXED_DT);
    expect(hologramsOf(g, 0)).not.toContain(h);
    expect(g.fx.holoBlasts).toMatchObject([{ ownerId: 0, x: h.x, y: h.y, radius: trollogram.decoyBlast!.radius }]);
    expect(g.fx.explosions.some((e) => e.x === h.x && e.radius === trollogram.decoyBlast!.radius)).toBe(true);
    expect(g.sfx.map((e) => e.cue)).toContain('holo-boom');

    untilNextTurn(g);
    expect(kcaj.hp).toBe(MAX_HP); // no more paying for it
    expect(kie.hp).toBe(MAX_HP);
    expect(hologramsOf(g, 0)).toHaveLength(1);
    step(g, 1);
    expect(g.fx.holoBlasts).toHaveLength(0); // the animation's done
  });

  it('the blast hurts every tank in reach, friend or foe', () => {
    for (const who of [0, 1]) {
      const g = withDecoys();
      passTurn(g); // kie
      const near = g.players[who]!;
      const h = hologramsOf(g, 0)[0]!;
      near.x = h.x + 18; // parked right next to the hologram
      near.y = h.y;
      fire(g);
      g.projectiles = [];
      explode(g, h.x - 22, h.y - TANK_BODY_HEIGHT, shell, 1); // grazes the hologram, not the tank
      expect(near.hp).toBe(MAX_HP);
      expect(h.hit).toBe(true);
      untilNextTurn(g);
      expect(near.hp).toBeLessThan(MAX_HP);
      expect(near.hp).toBeGreaterThan(MAX_HP - trollogram.decoyBlast!.damage - 1);
      expect(g.players[1 - who]!.hp).toBe(MAX_HP); // far away
    }
  });

  it('one blast can set off the next hologram: a chain, one after another', () => {
    const g = withDecoys();
    passTurn(g); // kie
    const [a, b] = hologramsOf(g, 0) as [Hologram, Hologram];
    b.x = a.x + 30;
    b.y = a.y;
    fire(g);
    g.projectiles = [];
    explode(g, a.x - 20, a.y - TANK_BODY_HEIGHT, shell, 1);
    expect([a.hit, b.hit]).toEqual([true, false]);
    step(g, FIXED_DT);
    expect(hologramsOf(g, 0)).toEqual([b]);
    expect(b.hit).toBe(true);
    step(g, FIXED_DT);
    expect(hologramsOf(g, 0)).toEqual([]);
    expect(g.fx.holoBlasts).toHaveLength(2);
  });

  it('a hologram hit after the shot has played out (the last of a stream) blows up as the turn ends', () => {
    const g = withDecoys();
    passTurn(g); // kie
    fire(g);
    g.projectiles = [];
    while (g.phase === 'flying') step(g, FIXED_DT);
    const h = hologramsOf(g, 0)[0]!;
    h.hit = true;
    untilNextTurn(g);
    expect(hologramsOf(g, 0)).not.toContain(h);
    expect(g.fx.holoBlasts).toHaveLength(1);
  });

  it('a Hyperfixate beam into a hologram blows it up, and nobody burns', () => {
    const g = withDecoys();
    passTurn(g); // kie
    const [kie, kcaj] = g.players as [(typeof g.players)[0], (typeof g.players)[0]];
    // Line kcaj up level with a hologram and zap it.
    const h = hologramsOf(g, 0)[0]!;
    h.x = kcaj.x - 150;
    h.y = kcaj.y;
    kie.x = 20;
    selectTier(g, 1);
    setAim(g, 180, 50);
    fire(g);
    expect(g.beams[0]!.hitTank).toBe(true);
    for (let i = 0; i < 300 && g.holograms.includes(h); i++) step(g, FIXED_DT);
    expect(hologramsOf(g, 0)).not.toContain(h);
    expect(g.fx.holoBlasts).toHaveLength(1);
    untilNextTurn(g);
    expect(kcaj.hp).toBe(MAX_HP);
    expect(kcaj.burn).toBeNull();
    expect(kie.burn).toBeNull();
    expect(kie.hp).toBe(MAX_HP);
  });

  it("a swap to a hologram that got hit this turn doesn't happen", () => {
    const g = withDecoys();
    const kie = g.players[0]!;
    const x0 = kie.x;
    const h = hologramsOf(g, 0)[0]!;
    toggleSwapTarget(g, h.id);
    fire(g);
    g.projectiles = [];
    explode(g, h.x, h.y - TANK_BODY_HEIGHT, shell, kie.id); // kie shoots his own decoy
    untilNextTurn(g);
    expect(kie.x).toBe(x0);
    expect(kie.hp).toBe(MAX_HP);
  });

  it('all of kie’s copies shimmer together at the end of his turn, whether or not he swaps', () => {
    for (const swap of [false, true]) {
      const g = withDecoys();
      if (swap) toggleSwapTarget(g, hologramsOf(g, 0)[0]!.id);
      g.fx.shimmers = [];
      passTurn(g);
      expect(g.fx.shimmers.map((s) => s.ownerId)).toEqual([0]);
    }
  });

  it('new holograms phase in; those of a player who is out dissolve, leaving a ghost', () => {
    const g = flatGame();
    selectTier(g, 1);
    fire(g);
    expect(hologramsOf(g, 0).every((h) => h.age === 0)).toBe(true);
    step(g, 0.5);
    expect(hologramsOf(g, 0)[0]!.age).toBeCloseTo(0.5);

    untilNextTurn(g);
    const [h] = g.holograms;
    g.players[0]!.hp = 0;
    g.players[0]!.alive = false;
    passTurn(g);
    expect(g.holograms).toEqual([]);
    expect(g.fx.holoBlasts).toEqual([]); // no blast: they just fade
    expect(g.fx.ghosts[0]).toMatchObject({ x: h!.x, y: h!.y, ownerId: 0 });
  });

  describe('picking a decoy on the turn it is cast', () => {
    it('holds the turn open for a moment to tap one of the new decoys, then swaps into it', () => {
      const g = flatGame();
      const kie = g.players[0]!;
      const start = { x: kie.x, y: kie.y };
      selectTier(g, 1);
      fire(g);
      expect(decoyPickLeft(g)).toBe(DECOY_PICK_TIME);
      const target = hologramsOf(g, 0)[1]!;
      const spot = { x: target.x, y: target.y };
      // A few seconds in, the turn is still open and a decoy can be picked.
      for (let t = 0; t < 3; t += FIXED_DT) step(g, FIXED_DT);
      expect(g.turn).toBe(1);
      expect(canPickDecoy(g)).toBe(true);
      expect(toggleSwapTarget(g, target.id)).toBe(true);
      untilNextTurn(g);
      expect(currentPlayer(g).name).toBe('kcaj');
      expect({ x: kie.x, y: kie.y }).toEqual(spot);
      expect(hologramsOf(g, 0).some((h) => h.x === start.x)).toBe(true);
      expect(canPickDecoy(g)).toBe(true); // kcaj aiming...
      expect(toggleSwapTarget(g, target.id)).toBe(false); // ...but it's not kcaj's decoy
    });

    it('closes after DECOY_PICK_TIME, or straight away when the caster is done', () => {
      const g = flatGame();
      selectTier(g, 1);
      fire(g);
      let t = 0;
      while (g.turn === 1 && t < 30) {
        step(g, FIXED_DT);
        t += FIXED_DT;
      }
      expect(t).toBeGreaterThan(DECOY_PICK_TIME);
      expect(t).toBeLessThan(DECOY_PICK_TIME + 3);

      passTurn(g); // kcaj
      selectTier(g, 1);
      fire(g);
      step(g, FIXED_DT);
      finishDecoyPick(g);
      expect(decoyPickLeft(g)).toBeNull();
      expect(canPickDecoy(g)).toBe(false);
      t = 0;
      while (g.turn === 3 && t < 30) {
        step(g, FIXED_DT);
        t += FIXED_DT;
      }
      expect(t).toBeLessThan(DECOY_PICK_TIME);
    });

    it('other weapons give no pick window once fired', () => {
      const g = withDecoys();
      selectTier(g, 0);
      fire(g);
      expect(canPickDecoy(g)).toBe(false);
      expect(toggleSwapTarget(g, hologramsOf(g, 0)[0]!.id)).toBe(false);
    });
  });
});

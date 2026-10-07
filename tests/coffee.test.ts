import { describe, expect, it } from 'vitest';
import { dicedCoffee } from '../src/characters/kits';
import { canDrinkCoffee, COFFEE_SPIN, coffeeFailChance, coffeeSpun, currentPlayer, fire, hasAmmo, selectTier, step } from '../src/game/game';
import { FIXED_DT } from '../src/game/constants';
import type { GameState } from '../src/game/state';
import type { Rng } from '../src/core/rng';
import { applySnapshot, takeSnapshot } from '../src/net/snapshot';
import { passTurn, testGame, untilAiming } from './support/game';

const COFFEE = 3;

function match(): GameState {
  return testGame({
    seed: 7,
    players: [
      { name: 'gary', colour: '#cbd5e1', characterId: 'garyoldmancorp' },
      { name: 'kcaj', colour: '#ffc53d', characterId: 'kcaj' },
    ],
    xs: [300, 700],
  });
}

/** The spinner's next draws (whether it fails, where it stops): `v` (below the fail chance spills); then as usual. */
function rigged(g: GameState, v: number): void {
  const real = g.rng;
  let left = 2;
  const rng = (() => (left-- > 0 ? v : real())) as Rng;
  rng.state = real.state;
  g.rng = rng;
}

/** Spin Diced Coffee, rigged, and play it out. */
function drink(g: GameState, v: number): void {
  rigged(g, v);
  expect(selectTier(g, COFFEE)).toBe(true);
  expect(fire(g)).toBe(true);
  expect(g.phase).toBe('coffee');
  untilAiming(g);
}

describe('Diced Coffee', () => {
  it('is a bonus move starting at 10% to fail, 10% more after each win', () => {
    expect(dicedCoffee.kind).toBe('coffee');
    expect(dicedCoffee.coffee).toEqual({ failChance: 0.1, failStep: 0.1 });
  });

  it('lactose free: the turn carries on with a shot selected, and the enemy’s next turn is skipped', () => {
    const g = match();
    const gary = g.players[0]!;
    expect(currentPlayer(g)).toBe(gary);
    drink(g, 0.95);
    expect(g.phase).toBe('aiming');
    expect(currentPlayer(g)).toBe(gary);
    expect(gary.extraTurn).toBe(true);
    expect(gary.ammo).toEqual([5, 3, 1, 1]); // still there for next time
    expect(gary.selectedTier).toBe(0);
    // Once a turn.
    expect(canDrinkCoffee(g, gary, COFFEE)).toBe(false);
    expect(selectTier(g, COFFEE)).toBe(false);
    const turn = g.turn;
    passTurn(g);
    expect([g.turn, currentPlayer(g).name, gary.extraTurn]).toEqual([turn + 1, 'gary', false]);
    // A new turn: it can be drunk again, riskier now.
    expect(canDrinkCoffee(g, gary, COFFEE)).toBe(true);
    expect(coffeeFailChance(gary, COFFEE)).toBeCloseTo(0.2);
    passTurn(g);
    expect(currentPlayer(g).name).toBe('kcaj');
  });

  it('every win makes the next spin riskier: 10%, 20%, 30%…', () => {
    const g = match();
    const gary = g.players[0]!;
    const chances: number[] = [];
    for (let i = 0; i < 3; i++) {
      chances.push(coffeeFailChance(gary, COFFEE));
      drink(g, 0.99);
      passTurn(g); // gary goes again
      expect(currentPlayer(g)).toBe(gary);
    }
    expect(chances.map((c) => Math.round(c * 100))).toEqual([10, 20, 30]);
  });

  it('full cream: a little jetpack straight up and back down, harmless; his turn is over and Diced Coffee is gone for good', () => {
    const g = match();
    const [gary, kcaj] = g.players as [GameState['players'][0], GameState['players'][0]];
    const { x, y } = gary;
    const ammo = [...gary.ammo];
    let top = y;
    rigged(g, 0);
    selectTier(g, COFFEE);
    fire(g);
    untilAiming(g, (s) => (top = Math.min(top, s.players[0]!.y)));
    expect(y - top).toBeGreaterThan(30); // it went up
    expect(gary.x).toBe(x); // straight up
    expect(Math.abs(gary.y - y)).toBeLessThan(10); // and back down where it was (on a little splash of cream)
    expect([gary.hp, kcaj.hp]).toEqual([gary.maxHp, kcaj.maxHp]);
    // No shot this turn: straight on to kcaj's.
    expect([g.phase, g.turn, currentPlayer(g)]).toEqual(['aiming', 2, kcaj]);
    expect(gary.ammo).toEqual([...ammo.slice(0, COFFEE), 0]);
    expect(gary.extraTurn).toBe(false);
    passTurn(g);
    expect(currentPlayer(g)).toBe(gary);
    expect(gary.selectedTier).toBe(0); // a shot, not the spilt coffee
    expect(selectTier(g, COFFEE)).toBe(false);
  });

  it('the wheel stops inside the slice of the result: full cream is the first failChance of the way round', () => {
    for (const [v, fail] of [[0.05, true], [0.5, false]] as const) {
      const g = match();
      rigged(g, v);
      selectTier(g, COFFEE);
      fire(g);
      const c = g.coffee!;
      expect(c.fail).toBe(fail);
      for (let t = 0; t < COFFEE_SPIN + 0.1; t += FIXED_DT) step(g, FIXED_DT);
      const at = coffeeSpun(c) % 1;
      expect(at).toBeCloseTo(c.stop, 5);
      expect(at < c.failChance).toBe(fail);
    }
  });

  it('isn’t a shot: with only Diced Coffee left, a player sits out like anyone with nothing to fire', () => {
    const g = match();
    const gary = g.players[0]!;
    gary.ammo = [0, 0, 0, 1];
    expect(hasAmmo(gary)).toBe(false);
    passTurn(g); // gary's turn ends; kcaj's
    expect(currentPlayer(g).name).toBe('kcaj');
    passTurn(g); // gary is skipped
    expect(currentPlayer(g).name).toBe('kcaj');
  });

  it('a win with nothing left to fire ends the turn, and still skips the enemy’s', () => {
    const g = match();
    const gary = g.players[0]!;
    gary.ammo = [1, 0, 0, 1];
    drink(g, 0.9);
    // Fire the last shell, then gary goes again with only the coffee: he sits out after all.
    expect(fire(g)).toBe(true);
    for (let t = 0; t < 30 && g.turn === 1; t += FIXED_DT) step(g, FIXED_DT);
    expect(currentPlayer(g).name).toBe('kcaj');
  });

  it('plays out the same on the other phone from the pre-fire snapshot (online), win or spill', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const here = match();
      here.players[0]!.coffee = { failChance: 0.5, turn: 0 }; // a coin flip: both outcomes come up
      const there = match();
      const snap = takeSnapshot(here);
      here.rng.state = snap.rng = seed;
      applySnapshot(there, snap);
      for (const g of [here, there]) {
        selectTier(g, COFFEE);
        expect(fire(g)).toBe(true);
        untilAiming(g);
      }
      expect(JSON.stringify(takeSnapshot(there))).toBe(JSON.stringify(takeSnapshot(here)));
    }
  });
});

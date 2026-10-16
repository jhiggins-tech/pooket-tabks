import { describe, expect, it } from 'vitest';
import { hoopDreamz } from '../src/characters/kits';
import { MAX_HP, TANK_BODY_HEIGHT } from '../src/game/constants';
import { fire, hoopFor, isHoop, selectTier, setAim } from '../src/game/game';
import type { Basketball, GameState } from '../src/game/state';
import { FLAT_Y, testGame, whileFlying } from './support/game';

const players = [
  { name: 'gary', colour: '#cbd5e1', characterId: 'garyoldmancorp' },
  { name: 'kcaj', colour: '#ffc53d', characterId: 'kcaj' },
];

const spec = hoopDreamz.hoop;

/** garyoldmancorp at 300 and kcaj at 700, on flat ground. */
function game(): GameState {
  return testGame({ seed: 3, players, xs: [300, 700] });
}

/** Shoot Hoop Dreamz at `angle` / `power`; returns the ball. */
function shoot(g: GameState, angle: number, power: number): Basketball {
  selectTier(g, 1);
  setAim(g, angle, power);
  fire(g);
  return g.basketballs[0]!;
}

/** Shoot, then put the ball at (x, y) going (vx, vy) instead. */
function place(g: GameState, x: number, y: number, vx = 0, vy = 0): Basketball {
  return Object.assign(shoot(g, 45, 50), { x, y, vx, vy });
}

/** How much ground there is. */
const solid = (g: GameState) => g.terrain.solid.reduce((n, v) => n + v, 0);

describe("garyoldmancorp's Hoop Dreamz", () => {
  it('is his tier 2, and the hoop hangs over the enemy, backboard on the far side', () => {
    const g = game();
    const [gary, kcaj] = g.players as [typeof g.players[0], typeof g.players[0]];
    expect(gary.loadout[1]).toBe('hoop-dreamz');
    expect(isHoop(gary, 1)).toBe(true);
    expect(isHoop(gary, 0)).toBe(false);
    expect(hoopFor(g, gary, hoopDreamz)).toEqual({ x: kcaj.x, y: FLAT_Y - TANK_BODY_HEIGHT - spec.height, side: 1 });
    expect(hoopFor(g, kcaj, hoopDreamz)).toEqual({ x: gary.x, y: FLAT_Y - TANK_BODY_HEIGHT - spec.height, side: -1 });
  });

  it('through the middle of the rim: a slam dunk, straight down onto them for the full 70 and a crater', () => {
    const g = game();
    const kcaj = g.players[1]!;
    const before = solid(g);
    const h = hoopFor(g, g.players[0]!, hoopDreamz)!;
    place(g, h.x + 3, h.y - 30, 0, 60);
    let dunked = false;
    whileFlying(g, () => (dunked ||= g.basketballs[0]?.dunk !== null && g.basketballs.length > 0));
    expect(dunked).toBe(true);
    expect(g.sfx.some((e) => e.cue === 'swish')).toBe(true);
    expect(kcaj.hp).toBe(MAX_HP - hoopDreamz.damage);
    expect(solid(g)).toBeLessThan(before);
  });

  it('a real shot can make it: aimed and powered right, it drops in', () => {
    // Some power at 60° drops it through the middle.
    const dunks: number[] = [];
    for (let power = 40; power <= 100; power++) {
      const g = game();
      shoot(g, 60, power);
      let dunked = false;
      whileFlying(g, () => (dunked ||= g.basketballs.some((b) => b.dunk !== null)));
      if (dunked) {
        dunks.push(power);
        expect(g.players[1]!.hp).toBe(MAX_HP - hoopDreamz.damage);
      }
    }
    expect(dunks.length).toBeGreaterThan(0);
    expect(dunks.length).toBeLessThan(4); // it takes aiming
  });

  it('off the outside of the rim: a clank, back up and out, no dunk', () => {
    const g = game();
    const kcaj = g.players[1]!;
    const h = hoopFor(g, g.players[0]!, hoopDreamz)!;
    const b = place(g, h.x - spec.rimHalf, h.y - 20, 0, 60);
    let up = false;
    let dunked = false;
    whileFlying(g, () => {
      up ||= b.vy < 0 && b.x < h.x - spec.rimHalf;
      dunked ||= b.dunk !== null;
    });
    expect(g.sfx.some((e) => e.cue === 'clank')).toBe(true);
    expect(up).toBe(true);
    expect(dunked).toBe(false);
    expect(kcaj.hp).toBeGreaterThanOrEqual(MAX_HP - spec.looseDamage);
  });

  it('off the backboard', () => {
    const g = game();
    const h = hoopFor(g, g.players[0]!, hoopDreamz)!;
    const b = place(g, h.x, h.y - 15, 300, 0);
    let back = false;
    whileFlying(g, () => (back ||= b.vx < 0));
    expect(back).toBe(true);
    expect(g.sfx.some((e) => e.cue === 'clank')).toBe(true);
  });

  it('a loose ball that bounces onto an enemy does a piddly 15, once, and leaves the ground alone', () => {
    const g = game();
    const kcaj = g.players[1]!;
    const before = solid(g);
    // Dropped from under the hoop, straight onto kcaj's hull.
    place(g, kcaj.x - 4, kcaj.y - 60, 0, 0);
    whileFlying(g);
    expect(kcaj.hp).toBe(MAX_HP - spec.looseDamage);
    expect(solid(g)).toBe(before);
    expect(g.tally[0]!.dealt['hoop-dreamz']).toBe(spec.looseDamage);
  });

  it('a miss bounces across the ground and comes to a stop: no crater, no harm, the turn moves on', () => {
    const g = game();
    const before = solid(g);
    const b = shoot(g, 150, 20); // away from kcaj
    let bounced = 0;
    whileFlying(g, () => (bounced = Math.max(bounced, b.bounces)));
    expect(bounced).toBeGreaterThan(1);
    expect(g.basketballs).toEqual([]);
    expect(g.players.map((p) => p.hp)).toEqual([MAX_HP, MAX_HP]);
    expect(solid(g)).toBe(before);
    expect(g.players[0]!.ammo[1]).toBe(2);
  });
});

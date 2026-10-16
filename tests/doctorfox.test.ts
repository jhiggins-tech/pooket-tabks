import { describe, expect, it } from 'vitest';
import { foxBomb, hoopDreamz, sly } from '../src/characters/kits';
import { FIXED_DT, FUEL_PER_MATCH } from '../src/game/constants';
import { canFire, explode, fire, hoopFor, isSly, selectTier, sneakClock, sneakLeft, sneakReady } from '../src/game/game';
import type { GameState } from '../src/game/state';
import { nearestEnemyX } from '../src/game/tanks';
import { applyPreview, previewOf } from '../src/net/follow';
import { hold, passTurn, testGame, untilNextTurn } from './support/game';

const players = [
  { name: 'fox', colour: '#fb923c', characterId: 'doctorfox' },
  { name: 'gary', colour: '#cbd5e1', characterId: 'garyoldmancorp' },
];

/** doctorfox at 300 and garyoldmancorp at 700, on flat ground; fox to play, with Sly selected and half his fuel gone. */
function game(): GameState {
  const g = testGame({ seed: 3, players, xs: [300, 700] });
  g.current = 0;
  g.players[0]!.fuel = FUEL_PER_MATCH / 2;
  selectTier(g, 1);
  return g;
}

/** Run Sly's clock (his phone's) for `seconds`. */
function sneakFor(g: GameState, seconds: number, dir = 0): void {
  for (let t = 0; t < seconds; t += FIXED_DT) {
    if (dir) hold(g, dir, FIXED_DT);
    sneakClock(g, FIXED_DT);
  }
}

describe("doctorfox's Sly", () => {
  it('is his tier 2: FIRE puts the smoke up, fills his tank and hides him, and the round waits to be fired', () => {
    const g = game();
    const fox = g.players[0]!;
    expect(isSly(fox, 1)).toBe(true);
    expect(fire(g)).toBe(false); // not fired yet: the sneaking starts
    expect(g.phase).toBe('sneaking');
    expect(fox.fuel).toBe(FUEL_PER_MATCH);
    expect(fox.hidden).toBe(true);
    expect(fox.ammo[1]).toBe(3);
    expect(g.fx.smokes).toHaveLength(1);
    expect(g.sfx.map((s) => s.cue)).toContain('smoke');
    expect(sneakLeft(g)).toBe(sly.sly.time);
  });

  it('he can drive off until time is up, then it fires, his turn ends and he stays hidden', () => {
    const g = game();
    const fox = g.players[0]!;
    fire(g);
    sneakFor(g, 0.5);
    expect(g.sneak!.movedAt).toBeNull();
    sneakFor(g, 3, -1);
    expect(fox.x).toBeLessThan(300 - 80);
    // Moving off: the stealth powerup kicks in (once).
    expect(g.sneak!.movedAt).toBeCloseTo(0.5, 1);
    expect(g.sfx.filter((s) => s.cue === 'stealth')).toHaveLength(1);
    expect(fox.fuel).toBeLessThan(FUEL_PER_MATCH);
    sneakFor(g, sly.sly.time - 3 + FIXED_DT);
    expect(sneakReady(g)).toBe(true);
    const x = fox.x;
    hold(g, -1, 1); // time's up: no more driving
    expect(fox.x).toBe(x);
    expect(fire(g)).toBe(true);
    expect(fox.ammo[1]).toBe(2);
    expect(g.sneak).toBeNull();
    untilNextTurn(g);
    expect(g.current).toBe(1);
    expect(fox.hidden).toBe(true);
    // His next turn: seen again.
    passTurn(g);
    expect(g.current).toBe(0);
    expect(fox.hidden).toBe(false);
  });

  it('FIRE finishes it sooner', () => {
    const g = game();
    fire(g);
    sneakFor(g, 2);
    expect(canFire(g)).toBe(true);
    expect(fire(g)).toBe(true);
    expect(g.phase).toBe('flying');
    untilNextTurn(g);
    expect(g.current).toBe(1);
  });

  it('he can still be hit, and a hit gives him away', () => {
    const g = game();
    const fox = g.players[0]!;
    fire(g);
    sneakFor(g, sly.sly.time + FIXED_DT);
    fire(g);
    untilNextTurn(g);
    explode(g, fox.x, fox.y - 8, foxBomb, 1);
    expect(fox.hp).toBeLessThan(fox.maxHp);
    expect(fox.hidden).toBe(false);
    expect(g.fx.floaters.some((f) => f.text === 'SPOTTED!')).toBe(true);
  });

  it('weapons that seek out the nearest enemy can’t find him', () => {
    const g = game();
    const [fox, gary] = g.players as [typeof g.players[0], typeof g.players[0]];
    expect(nearestEnemyX(g, gary.x, gary.id)).toBe(fox.x);
    fire(g);
    expect(nearestEnemyX(g, gary.x, gary.id)).toBeNull();
    expect(hoopFor(g, gary, hoopDreamz)).toBeNull();
  });

  it('the other phone follows it in the previews: the smoke, and he’s gone', () => {
    const here = game();
    const there = game();
    fire(here);
    sneakFor(here, 1, 1);
    applyPreview(there, previewOf(here));
    expect(there.phase).toBe('sneaking');
    expect(there.players[0]!.hidden).toBe(true);
    expect(there.players[0]!.x).toBe(here.players[0]!.x);
    expect(there.fx.smokes).toHaveLength(1);
    expect(there.sneak!.movedAt).not.toBeNull();
  });
});

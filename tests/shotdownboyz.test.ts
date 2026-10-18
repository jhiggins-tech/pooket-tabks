import { describe, expect, it } from 'vitest';
import { DRIVE_SPEED, FIXED_DT, FUEL_PER_MATCH } from '../src/game/constants';
import { currentPlayer, fire, selectTier } from '../src/game/game';
import { canMove } from '../src/game/statuses';
import type { GameState } from '../src/game/state';
import { passTurn, testGame, hold } from './support/game';

const players = [
  { name: 'Boyz', colour: '#f87171', characterId: 'shotdownboyz' },
  { name: 'Kie', colour: '#4ea8ff', characterId: 'kie' },
];

function match(heights?: (x: number) => number): GameState {
  return testGame({ seed: 50, players, heights, xs: [300, 800] });
}

describe("ShotDownBoyz's beta movement", () => {
  it('activates the digger once per turn without spending its bonus slot', () => {
    const g = match();
    const p = currentPlayer(g);
    expect(selectTier(g, 3)).toBe(true);
    expect(fire(g)).toBe(true);
    expect(p.diggerActive).toBe(true);
    expect(p.ammo[3]).toBe(1);
    expect(selectTier(g, 3)).toBe(false);

    passTurn(g);
    expect(p.diggerActive).toBe(false);
    passTurn(g);
    expect(currentPlayer(g)).toBe(p);
    expect(selectTier(g, 3)).toBe(true);
  });

  it('drives horizontally through hills, carving a tunnel, but still stops at another tank', () => {
    const g = match((x) => (x >= 330 ? 350 : 400));
    const p = currentPlayer(g);
    expect(selectTier(g, 3)).toBe(true);
    fire(g);
    hold(g, 1, 2);
    expect(p.x).toBeGreaterThan(350);
    expect(p.y).toBe(400);
    expect(g.terrain.isSolid(360, 390)).toBe(false);

    const blocked = match();
    const digger = currentPlayer(blocked);
    blocked.players[1]!.x = 340;
    expect(selectTier(blocked, 3)).toBe(true);
    fire(blocked);
    hold(blocked, 1, 2);
    expect(blocked.players[1]!.x - digger.x).toBeGreaterThanOrEqual(22);
    expect(blocked.players[1]!.x - digger.x).toBeLessThan(23);
  });

  it('cannot drive while pinned', () => {
    const g = match();
    const p = currentPlayer(g);
    p.pinned = { active: true };
    selectTier(g, 3);
    fire(g);
    const x = p.x;
    hold(g, 1, 1);
    expect(canMove(p)).toBe(false);
    expect(p.x).toBe(x);
  });

  it('refills one empty fuel tank at the start of the next turn, once', () => {
    const g = match();
    const p = currentPlayer(g);
    p.fuel = DRIVE_SPEED * 0.2;
    selectTier(g, 3);
    fire(g);
    hold(g, 1, 1);
    expect(p.fuel).toBe(0);
    passTurn(g);
    passTurn(g);
    expect(currentPlayer(g)).toBe(p);
    expect(p.fuel).toBe(FUEL_PER_MATCH);
    expect(p.dieselAvailable).toBe(false);
    expect(p.dieselCanTime).toBeGreaterThan(0);

    p.fuel = 0;
    passTurn(g);
    passTurn(g);
    expect(p.fuel).toBe(0);
    expect(p.dieselCanTime).toBeCloseTo(2.4 - FIXED_DT * 2, 5);
  });
});

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
    expect(g.terrain.isSolid(360, 380)).toBe(true);
    expect(p.diggerFacing).toBe(1);
    expect(g.sfx.some((e) => e.cue === 'digger')).toBe(true);

    hold(g, -1, 0.2);
    expect(p.diggerFacing).toBe(-1);

    const blocked = match();
    const digger = currentPlayer(blocked);
    blocked.players[1]!.x = 340;
    expect(selectTier(blocked, 3)).toBe(true);
    fire(blocked);
    hold(blocked, 1, 2);
    expect(blocked.players[1]!.x - digger.x).toBeGreaterThanOrEqual(22);
    expect(blocked.players[1]!.x - digger.x).toBeLessThan(23);
    expect(blocked.sfx.some((e) => e.cue === 'digger')).toBe(true);
  });

  it('lays a flat bed of dirt under itself over air, and levels its tunnel floor', () => {
    // A cliff edge at 330, a drop to 500 beyond it, and a hill at 420 to tunnel through.
    const g = match((x) => (x < 330 ? 400 : x < 420 ? 500 : 350));
    const p = currentPlayer(g);
    selectTier(g, 3);
    fire(g);
    hold(g, 1, 6);
    expect(p.x).toBeGreaterThan(440);
    expect(p.y).toBe(400);
    for (const x of [340, 370, 400, 430]) {
      expect(g.terrain.groundBelow(x, 390)).toBe(400); // flat, at the hull's base (in the tunnel too)
      expect(g.terrain.isSolid(x, 450)).toBe(true); // filled right down to the old ground
    }
    expect(g.terrain.isSolid(430, 395)).toBe(false); // the tunnel's still open above it
    expect(g.fx.splashes.some((sp) => sp.opaque)).toBe(true); // clods of dirt kicked out

    // Tanks settling at the end of the turn don't fall: he's on solid ground.
    passTurn(g);
    expect(p.y).toBe(400);
  });

  it("doesn't bury a tank below its bridge", () => {
    const g = match((x) => (x < 330 ? 400 : 500));
    const p = currentPlayer(g);
    const below = g.players[1]!;
    below.x = 380;
    below.y = 500;
    selectTier(g, 3);
    fire(g);
    hold(g, 1, 4);
    expect(p.x).toBeGreaterThan(400);
    expect(g.terrain.isSolid(380, 470)).toBe(true); // the bridge, over its head
    expect(g.terrain.isSolid(380, 495)).toBe(false);
    expect(g.terrain.isSolid(380, 488)).toBe(false);
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
    expect(g.sfx.some((e) => e.cue === 'digger')).toBe(false);
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

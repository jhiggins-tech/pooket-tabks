import { describe, expect, it } from 'vitest';
import { fire } from '../src/game/game';
import { applyPreview, previewOf, putState, shotResolved } from '../src/net/follow';
import { encodeSolid, takeSnapshot } from '../src/net/snapshot';
import { testGame, untilAiming, whileFlying } from './support/game';

const players = [
  { name: 'A', characterId: 'tones', colour: '#f00' },
  { name: 'B', characterId: 'tones', colour: '#00f' },
];

describe('following a match', () => {
  it("a preview moves the current player's aim, only for this turn while aiming", () => {
    const g = testGame({ seed: 5, players });
    const p = g.players[g.current]!;
    applyPreview(g, { ...previewOf(g), angle: 70, power: 33 });
    expect([p.angle, p.power]).toEqual([70, 33]);
    applyPreview(g, { ...previewOf(g), turn: g.turn + 1, angle: 10 });
    expect(p.angle).toBe(70);
    fire(g);
    applyPreview(g, { ...previewOf(g), angle: 10 });
    expect(p.angle).toBe(70);
  });

  it("a shot is resolved once the next turn is up; putState snaps back to a snapshot and its terrain", () => {
    const g = testGame({ seed: 5, players });
    const snap = takeSnapshot(g);
    const terrain = encodeSolid(g.terrain);
    const turn = g.turn;
    fire(g);
    whileFlying(g);
    expect(shotResolved(g, turn)).toBe(false);
    untilAiming(g);
    expect(shotResolved(g, turn)).toBe(true);
    putState(g, snap, terrain);
    expect([g.turn, g.phase, encodeSolid(g.terrain)]).toEqual([turn, 'aiming', terrain]);
  });
});

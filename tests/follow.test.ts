import { describe, expect, it } from 'vitest';
import { fire } from '../src/game/game';
import { applyPreview, previewOf, putState, ResultBuffer, shotResolved, SYNC_GRACE } from '../src/net/follow';
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

  it("torikloud's twin: its own aim, which tank is aimed, and where a twin's being placed all go with the preview", () => {
    const tori = [
      { name: 'T', characterId: 'torikloud', colour: '#a78bfa' },
      { name: 'B', characterId: 'tones', colour: '#00f' },
    ];
    const g = testGame({ seed: 5, players: tori });
    const other = testGame({ seed: 5, players: tori });
    const p = g.players[g.current]!;
    p.twinSpot = 333;
    applyPreview(other, previewOf(g));
    expect(other.players[g.current]!.twinSpot).toBe(333);
    p.twin = { x: 450, y: 400, hp: 50, burn: null, soak: 0, soakColour: '#fff', toxin: 0, toxinRate: 0, age: 0, angle: 120, power: 30 };
    other.players[g.current]!.twin = { ...p.twin, angle: 45, power: 60 };
    p.aimTwin = true;
    applyPreview(other, previewOf(g));
    expect(other.players[g.current]!.twin).toMatchObject({ angle: 120, power: 30 });
    expect(other.players[g.current]!.aimTwin).toBe(true);
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

  it('a result that comes in mid-shot waits out the grace period; each step clears only its own part', () => {
    const b = new ResultBuffer<string>();
    expect(b.due(10)).toBeNull(); // nothing pending: no waiting
    b.fired({ turn: 3, owner: 1 });
    b.resultIn('r');
    expect(b.due(SYNC_GRACE - 1)).toBeNull();
    expect(b.due(1)).toBe('r');
    b.dropResult();
    expect([b.shot, b.pending]).toEqual([{ turn: 3, owner: 1 }, null]);
    b.resultIn('r2');
    b.settledHere(); // the shot's done here; the result stays
    expect([b.shot, b.pending]).toEqual([null, 'r2']);
    b.cleared();
    expect([b.shot, b.pending]).toEqual([null, null]);
    // A known result (a replay) has its own grace, until the next one is applied.
    b.known('k', 60);
    expect(b.due(SYNC_GRACE + 1)).toBeNull();
    b.applied();
    b.resultIn('r3');
    expect(b.due(SYNC_GRACE)).toBe('r3');
  });

  it('a shot is resolved by the game it is followed in', () => {
    const g = testGame({ seed: 5, players });
    const b = new ResultBuffer<string>();
    expect(b.resolved(g)).toBe(false);
    b.fired({ turn: g.turn, owner: g.current });
    fire(g);
    whileFlying(g);
    expect(b.resolved(g)).toBe(false);
    untilAiming(g);
    expect([b.resolved(g), b.resolved(null)]).toEqual([true, false]);
  });
});

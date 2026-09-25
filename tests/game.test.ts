import { describe, expect, it } from 'vitest';
import { FIXED_DT, MAX_HP } from '../src/game/constants';
import { createGame, currentPlayer, explode, fire, setAim, step } from '../src/game/game';
import type { GameState } from '../src/game/state';
import { basicShell } from '../src/weapons/registry';

const players = [
  { name: 'Alice', colour: '#e5484d' },
  { name: 'Bob', colour: '#3e8ef7' },
];

function runUntil(state: GameState, done: (s: GameState) => boolean, maxSeconds = 20): void {
  for (let t = 0; t < maxSeconds; t += FIXED_DT) {
    if (done(state)) return;
    step(state, FIXED_DT);
  }
  throw new Error(`condition not met within ${maxSeconds}s (phase=${state.phase})`);
}

describe('game', () => {
  it('spawns tanks resting on the ground', () => {
    const g = createGame({ seed: 7, players });
    for (const p of g.players) {
      expect(p.y).toBe(g.terrain.surfaceY(p.x));
      expect(p.hp).toBe(MAX_HP);
    }
    expect(g.players[0]!.x).toBeLessThan(g.players[1]!.x);
  });

  it('is reproducible from a seed', () => {
    const a = createGame({ seed: 99, players });
    const b = createGame({ seed: 99, players });
    expect(a.players.map((p) => [p.x, p.y])).toEqual(b.players.map((p) => [p.x, p.y]));
    expect(a.terrain.solid).toEqual(b.terrain.solid);
  });

  it('fires, carves a crater, and passes the turn', () => {
    const g = createGame({ seed: 3, players });
    const solidBefore = g.terrain.solid.reduce((n, v) => n + v, 0);
    expect(currentPlayer(g).name).toBe('Alice');

    setAim(g, 60, 45);
    expect(fire(g)).toBe(true);
    expect(g.phase).toBe('flying');
    expect(fire(g)).toBe(false); // can't double-fire

    runUntil(g, (s) => s.phase === 'aiming');
    const solidAfter = g.terrain.solid.reduce((n, v) => n + v, 0);
    expect(solidAfter).toBeLessThan(solidBefore);
    expect(currentPlayer(g).name).toBe('Bob');
    expect(g.turn).toBe(2);
  });

  it('a shot that leaves the map is a dud but still passes the turn', () => {
    const g = createGame({ seed: 3, players });
    setAim(g, 180, 100); // Alice fires left, off the edge
    const solidBefore = g.terrain.solid.reduce((n, v) => n + v, 0);
    fire(g);
    runUntil(g, (s) => s.phase === 'aiming');
    // Might clip a hill on the way out; the point is the turn advances.
    expect(currentPlayer(g).name).toBe('Bob');
    expect(g.terrain.solid.reduce((n, v) => n + v, 0)).toBeLessThanOrEqual(solidBefore);
  });

  it('damages tanks by distance and drops them into the crater', () => {
    const g = createGame({ seed: 5, players });
    const bob = g.players[1]!;
    const yBefore = bob.y;
    explode(g, bob.x, bob.y, basicShell);
    expect(bob.hp).toBeLessThan(MAX_HP);
    expect(bob.y).toBeGreaterThan(yBefore);
    expect(g.players[0]!.hp).toBe(MAX_HP);
  });

  it('ends the game when only one tank survives', () => {
    const g = createGame({ seed: 5, players });
    g.players[1]!.hp = 1;
    fire(g);
    // Replace the in-flight shell with a direct hit on Bob.
    g.projectiles = [];
    explode(g, g.players[1]!.x, g.players[1]!.y - 8, basicShell);
    runUntil(g, (s) => s.phase === 'gameover');
    expect(g.winner?.name).toBe('Alice');
  });
});

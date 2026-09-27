import { describe, expect, it } from 'vitest';
import { createGame, currentPlayer, firstPlayer } from '../src/game/game';
import { takeSnapshot } from '../src/net/snapshot';

const players = [
  { name: 'A', colour: '#f00', characterId: 'tones' },
  { name: 'B', colour: '#00f', characterId: 'kie' },
];

describe('who goes first', () => {
  it('is player 1 unless asked otherwise', () => {
    expect(createGame({ seed: 5, players }).current).toBe(0);
    expect(currentPlayer(createGame({ seed: 5, players, first: 1 })).name).toBe('B');
  });

  it('random: the seed decides, so every phone agrees, and both players get to start', () => {
    const picks = Array.from({ length: 400 }, (_, i) => firstPlayer(1000 + i * 7919, 2, 'random'));
    const ones = picks.filter((p) => p === 1).length;
    expect(ones).toBeGreaterThan(150);
    expect(ones).toBeLessThan(250);
    for (const seed of [1, 42, 0xffffffff, 123456789]) {
      expect(createGame({ seed, players, first: 'random' }).current).toBe(firstPlayer(seed, 2, 'random'));
      expect(firstPlayer(seed, 2, 'random')).toBe(firstPlayer(seed, 2, 'random'));
    }
  });

  it('leaves the map and the gameplay RNG alone', () => {
    const seed = [1, 2, 3, 4, 5, 6].find((s) => firstPlayer(s, 2, 'random') === 1)!;
    const a = takeSnapshot(createGame({ seed, players }));
    const b = takeSnapshot(createGame({ seed, players, first: 'random' }));
    expect(b.current).toBe(1);
    expect({ ...b, current: 0 }).toEqual(a);
  });
});

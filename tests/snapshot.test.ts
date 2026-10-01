import { describe, expect, it } from 'vitest';
import { createGame, explode, fire, setAim, step } from '../src/game/game';
import { FIXED_DT } from '../src/game/constants';
import { decodeMsg, encodeMsg } from '../src/net/wire';
import { applySnapshot, decodeSolid, encodeSolid, takeSnapshot } from '../src/net/snapshot';
import { getWeapon } from '../src/weapons/registry';

const players = [
  { name: 'a', colour: '#f00', characterId: 'kie' },
  { name: 'b', colour: '#00f', characterId: 'tones' },
];

describe('snapshots', () => {
  it('restore a game exactly, and it plays on identically (rng included)', () => {
    const A = createGame({ seed: 9, players });
    setAim(A, 60, 70);
    const snap = takeSnapshot(A);
    const B = createGame({ seed: 9, players });
    B.rng(); // knock B's randomness out of step
    B.players[0]!.x += 40;
    applySnapshot(B, snap);
    fire(A);
    fire(B);
    for (let i = 0; i < 400; i++) {
      step(A, FIXED_DT);
      step(B, FIXED_DT);
    }
    expect(takeSnapshot(B)).toEqual(takeSnapshot(A));
  });

  it('keep Infinity and the winner through the wire format', () => {
    const A = createGame({ seed: 9, players });
    A.projectiles.push({ x: 1, y: 2, vx: 0, vy: 0, weaponId: 'weasel-pop', ownerId: 0, trail: [], bounces: 0, age: 0, walkDir: 1, walkTime: 0, fuseDist: Infinity });
    A.winner = A.players[1]!;
    const B = createGame({ seed: 9, players });
    applySnapshot(B, decodeMsg(encodeMsg(takeSnapshot(A))) as ReturnType<typeof takeSnapshot>);
    expect(B.projectiles[0]!.fuseDist).toBe(Infinity);
    expect(B.winner).toBe(B.players[1]);
  });

  it('terrain: a compact run-length mask that patches the other phone to match', () => {
    const A = createGame({ seed: 9, players });
    const B = createGame({ seed: 9, players });
    for (let i = 0; i < 8; i++) explode(A, 150 + i * 100, 300, getWeapon('marathon'));
    A.terrain.addDirt(600, 200, 12, [92, 62, 36]);
    const code = encodeSolid(A.terrain);
    expect(code.length).toBeLessThan(12_000);
    // (Big masks: compared byte for byte; a deep toEqual on them takes seconds.)
    const firstDifference = (x: Uint8Array, y: Uint8Array) => (x.length !== y.length ? 0 : x.findIndex((v, i) => v !== y[i]));
    expect(firstDifference(decodeSolid(code, A.terrain.solid.length), A.terrain.solid)).toBe(-1);
    expect(B.terrain.patchSolid(decodeSolid(code, B.terrain.solid.length))).toBeGreaterThan(100);
    expect(firstDifference(B.terrain.solid, A.terrain.solid)).toBe(-1);
    const i = 200 * B.terrain.width + 600;
    expect(B.terrain.pixels[i * 4 + 3]).toBe(255); // the new dirt is drawn
    expect(B.terrain.takeDirty()).not.toBeNull();
  });
});

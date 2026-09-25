import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/game/constants';
import { createGame, currentPlayer, fire, setAim, step, volleyOffsets } from '../src/game/game';
import { doublePark, shell } from '../src/weapons/registry';

const players = [
  { name: 'kcaj', colour: '#ffc53d', characterId: 'kcaj' },
  { name: 'tones', colour: '#ff5a5f', characterId: 'tones' },
];

describe('Double Park', () => {
  it('is a small-blast, two-cone volley with an ice cream sprite', () => {
    expect(doublePark.blastRadius).toBeLessThan(shell.blastRadius);
    expect(doublePark.volley).toEqual({ count: 2, spreadDeg: 2 });
    expect(doublePark.sprite).toBe('ice-cream-cone');
  });

  it('fans its projectiles ±2° either side of the aim', () => {
    expect(volleyOffsets(doublePark)).toEqual([-2, 2]);
    expect(volleyOffsets(shell)).toEqual([0]);
    expect(volleyOffsets({ ...shell, volley: { count: 3, spreadDeg: 4 } })).toEqual([-4, 0, 4]);
  });

  it('fires two cones at aim ±2° with equal speed, for one round of ammo', () => {
    const g = createGame({ seed: 11, players });
    setAim(g, 50, 70);
    fire(g);
    expect(g.projectiles).toHaveLength(2);
    const angles = g.projectiles.map((p) => (Math.atan2(-p.vy, p.vx) * 180) / Math.PI);
    expect(angles[0]).toBeCloseTo(48);
    expect(angles[1]).toBeCloseTo(52);
    const speeds = g.projectiles.map((p) => Math.hypot(p.vx, p.vy));
    expect(speeds[0]).toBeCloseTo(speeds[1]!);
    expect(g.projectiles.every((p) => p.weaponId === 'double-park')).toBe(true);
    expect(g.players[0]!.ammo).toEqual([4, 3, 1]);
  });

  it('waits for both cones to land before passing the turn', () => {
    const g = createGame({ seed: 11, players });
    setAim(g, 60, 55);
    fire(g);
    let sawOneLeft = false;
    for (let t = 0; t < 20 && g.phase !== 'aiming'; t += FIXED_DT) {
      if (g.projectiles.length === 1) {
        sawOneLeft = true;
        expect(g.phase).toBe('flying');
      }
      step(g, FIXED_DT);
    }
    expect(sawOneLeft).toBe(true);
    expect(currentPlayer(g).name).toBe('tones');
  });

});

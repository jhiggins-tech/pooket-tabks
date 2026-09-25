import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/game/constants';
import { createGame, currentPlayer, explode, fire, setAim, step, volleyOffsets } from '../src/game/game';
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

import { Terrain } from '../src/core/terrain';
import { createRng } from '../src/core/rng';
import { MAX_HP } from '../src/game/constants';
import { damagePlayer, isAimless, muzzle, selectTier, traceBeam } from '../src/game/game';
import type { GameState } from '../src/game/state';
import { hyperfixate, unmedicated } from '../src/weapons/registry';

function run(g: GameState, until: (g: GameState) => boolean, seconds = 30): void {
  for (let t = 0; t < seconds && !until(g); t += FIXED_DT) step(g, FIXED_DT);
  if (!until(g)) throw new Error(`timed out in phase ${g.phase}`);
}

/** kcaj vs tones on dead-flat ground, so shots are predictable. */
function flatGame(): GameState {
  const g = createGame({ seed: 4, players });
  const w = g.terrain.width;
  const h = g.terrain.height;
  g.terrain = Terrain.fromHeights(new Float32Array(w).fill(400), w, h, createRng(1));
  for (const p of g.players) p.y = 400;
  return g;
}

/** On flat ground both tank centres are level, so a horizontal beam hits tones square on. */
function aimAtEnemy(g: GameState): void {
  g.players[0]!.angle = 0;
}

describe('Hyperfixate', () => {
  it('is a straight beam with a 3-turn burn', () => {
    expect(hyperfixate.kind).toBe('beam');
    expect(hyperfixate.dot).toEqual({ damagePerTurn: 8, turns: 3 });
  });

  it('travels in a straight line from the barrel (no gravity arc)', () => {
    const g = flatGame();
    const kcaj = g.players[0]!;
    setAim(g, 20, 5); // power is irrelevant to a beam
    const m = muzzle(kcaj);
    const end = traceBeam(g, kcaj);
    const angle = (Math.atan2(-(end.y - m.y), end.x - m.x) * 180) / Math.PI;
    expect(angle).toBeCloseTo(20, 0);
  });

  it('a direct hit deals impact damage, then burns at the start of each of the victim’s next 3 turns', () => {
    const g = flatGame();
    const [kcaj, tones] = g.players as [(typeof g.players)[0], (typeof g.players)[0]];
    selectTier(g, 1);
    aimAtEnemy(g);
    fire(g);
    expect(tones.hp).toBe(MAX_HP - 15);
    expect(tones.burn?.turnsLeft).toBe(3);
    expect(g.beams).toHaveLength(1);
    expect(g.beams[0]!.hitTank).toBe(true);
    expect(kcaj.ammo).toEqual([5, 2, 1]);

    // Let the shot resolve, then have both players pass their turns without firing.
    const passTurn = () => {
      g.phase = 'settling';
      g.settleTimer = 0;
      step(g, FIXED_DT);
    };
    const hpAtTurnStart: number[] = [];
    run(g, (s) => s.phase === 'aiming');
    for (let turn = 0; turn < 4; turn++) {
      expect(currentPlayer(g)).toBe(tones);
      hpAtTurnStart.push(tones.hp);
      passTurn(); // tones
      passTurn(); // kcaj
    }
    expect(hpAtTurnStart).toEqual([MAX_HP - 23, MAX_HP - 31, MAX_HP - 39, MAX_HP - 39]);
    expect(tones.burn).toBeNull();
  });

  it('a burn tick can finish a player off and end the game', () => {
    const g = flatGame();
    const tones = g.players[1]!;
    tones.hp = 20; // 15 impact + 8 burn
    selectTier(g, 1);
    aimAtEnemy(g);
    fire(g);
    expect(tones.alive).toBe(true);
    run(g, (s) => s.phase === 'gameover');
    expect(tones.alive).toBe(false);
    expect(g.winner?.name).toBe('kcaj');
  });

  it('burns a small hole where it hits the ground and does no damage', () => {
    const g = flatGame();
    const kcaj = g.players[0]!;
    // A bank of earth between the tanks for the beam to hit.
    const w = g.terrain.width;
    g.terrain = Terrain.fromHeights(
      Float32Array.from({ length: w }, (_, x) => (x > kcaj.x + 40 && x < kcaj.x + 60 ? 300 : 400)),
      w,
      g.terrain.height,
      createRng(2),
    );
    const before = g.terrain.solid.reduce((n, v) => n + v, 0);
    selectTier(g, 1);
    aimAtEnemy(g);
    fire(g);
    expect(g.beams[0]!.hitTank).toBe(false);
    expect(g.beams[0]!.x2).toBeCloseTo(kcaj.x + 41, 0);
    expect(g.terrain.solid.reduce((n, v) => n + v, 0)).toBeLessThan(before);
    expect(g.players.every((p) => p.hp === MAX_HP)).toBe(true);
  });
});

describe('Unmedicated', () => {
  it('ignores aiming entirely', () => {
    const g = flatGame();
    selectTier(g, 2);
    expect(isAimless(g)).toBe(true);
    const { angle, power } = g.players[0]!;
    setAim(g, 10, 99);
    expect(g.players[0]!.angle).toBe(angle);
    expect(g.players[0]!.power).toBe(power);
    selectTier(g, 0);
    expect(isAimless(g)).toBe(false);
  });

  it('rains pills across the whole stage', () => {
    const g = flatGame();
    selectTier(g, 2);
    fire(g);
    expect(g.projectiles).toHaveLength(unmedicated.rainCount!);
    const xs = g.projectiles.map((p) => p.x);
    expect(Math.min(...xs)).toBeLessThan(g.terrain.width * 0.1);
    expect(Math.max(...xs)).toBeGreaterThan(g.terrain.width * 0.9);
    expect(g.projectiles.every((p) => p.y < 0 && p.weaponId === 'unmedicated')).toBe(true);
  });

  it('each pill bounces twice, then detonates on the third touch', () => {
    const g = flatGame();
    selectTier(g, 2);
    fire(g);
    // Keep one pill, well away from both tanks.
    const pill = g.projectiles[0]!;
    Object.assign(pill, { x: g.terrain.width / 2, y: 300, vx: 0, vy: 0 });
    g.projectiles = [pill];
    let maxBounces = 0;
    run(g, (s) => {
      maxBounces = Math.max(maxBounces, pill.bounces);
      return s.projectiles.length === 0;
    });
    expect(maxBounces).toBe(2);
    expect(g.terrain.isSolid(g.terrain.width / 2, 402)).toBe(false); // micro crater
  });

  it('the downpour wears the enemy down but never hurts kcaj', () => {
    const g = createGame({ seed: 4, players });
    const [kcaj, tones] = g.players as [(typeof g.players)[0], (typeof g.players)[0]];
    selectTier(g, 2);
    fire(g);
    run(g, (s) => s.phase === 'aiming' || s.phase === 'gameover');
    expect(kcaj.hp).toBe(MAX_HP);
    expect(tones.hp).toBeLessThan(MAX_HP);
    expect(tones.hp).toBeGreaterThan(0);
  });
});

describe('damage numbers', () => {
  it('spawn a floater that rises and fades from the damaged tank', () => {
    const g = flatGame();
    const tones = g.players[1]!;
    damagePlayer(g, tones, 12);
    expect(g.floaters).toHaveLength(1);
    const f = g.floaters[0]!;
    expect(f.text).toBe('-12');
    expect(Math.abs(f.x - tones.x)).toBeLessThan(10);
    const y0 = f.y;
    const x0 = f.x;
    step(g, 0.5);
    expect(f.y).toBeLessThan(y0); // up into the sky
    expect(f.x).not.toBe(x0); // sloping off to one side
    step(g, 2);
    expect(g.floaters).toHaveLength(0);
  });

  it('every blast that hurts a tank shows its number', () => {
    const g = flatGame();
    const tones = g.players[1]!;
    explode(g, tones.x, tones.y - 8, shell);
    expect(g.floaters.map((f) => f.text)).toEqual([`-${MAX_HP - tones.hp}`]);
  });
});

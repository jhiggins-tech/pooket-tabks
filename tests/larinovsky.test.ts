import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { Terrain } from '../src/core/terrain';
import { FIXED_DT, MAX_HP, TANK_BODY_HEIGHT } from '../src/game/constants';
import { createGame, currentPlayer, explode, fire, isAimless, offence, selectTier, setAim, step } from '../src/game/game';
import type { GameState } from '../src/game/state';
import { pillPusher, shell, takeANap, theRizzler } from '../src/weapons/registry';

const players = [
  { name: 'larinovsky', colour: '#34d399', characterId: 'larinovsky' },
  { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
];

function game(): GameState {
  const g = createGame({ seed: 60, players });
  const w = g.terrain.width;
  g.terrain = Terrain.fromHeights(new Float32Array(w).fill(400), w, g.terrain.height, createRng(1));
  g.players[0]!.x = 300;
  g.players[1]!.x = 700;
  for (const p of g.players) p.y = 400;
  return g;
}

function resolve(g: GameState): void {
  for (let t = 0; t < 20 && g.phase === 'flying'; t += FIXED_DT) step(g, FIXED_DT);
}

/** End the current turn without firing. */
function pass(g: GameState): void {
  g.phase = 'settling';
  g.settleTimer = 0;
  step(g, FIXED_DT);
}

describe('Pill Pusher', () => {
  it('fires a series of pills one after another, for one round', () => {
    const g = game();
    selectTier(g, 0);
    setAim(g, 45, 60);
    fire(g);
    expect(g.projectiles).toHaveLength(0); // not all at once
    const seen = new Set<object>();
    let firstAt = -1;
    let lastAt = -1;
    let t = 0;
    for (; t < 10 && g.phase === 'flying'; t += FIXED_DT) {
      step(g, FIXED_DT);
      for (const p of g.projectiles) {
        if (!seen.has(p)) {
          if (firstAt < 0) firstAt = t;
          lastAt = t;
        }
        seen.add(p);
      }
    }
    expect(seen.size).toBe(pillPusher.burst!.count);
    expect(lastAt - firstAt).toBeCloseTo(pillPusher.burst!.interval * (pillPusher.burst!.count - 1), 1);
    expect(g.players[0]!.ammo[0]).toBe(4);
  });

  it('the pills walk across the target area and each one pops', () => {
    const g = game();
    const before = g.terrain.solid.reduce((n, v) => n + v, 0);
    selectTier(g, 0);
    setAim(g, 60, 55);
    fire(g);
    const speeds: number[] = [];
    for (let t = 0; t < 10 && g.phase === 'flying'; t += FIXED_DT) {
      step(g, FIXED_DT);
      for (const p of g.projectiles) if (p.age === FIXED_DT) speeds.push(Math.hypot(p.vx, p.vy));
    }
    expect(new Set(speeds.map((v) => Math.round(v))).size).toBeGreaterThan(1);
    expect(before - g.terrain.solid.reduce((n, v) => n + v, 0)).toBeGreaterThan(300);
  });
});

describe('the Rizzler', () => {
  it('its blast damages and cooks the enemy', () => {
    const g = game();
    const kie = g.players[1]!;
    selectTier(g, 1);
    fire(g);
    g.projectiles = [];
    explode(g, kie.x, kie.y - TANK_BODY_HEIGHT, theRizzler, 0);
    expect(kie.hp).toBe(MAX_HP - theRizzler.damage);
    expect(kie.cooked).toEqual({ active: false, multiplier: 0.5 });
    expect(g.floaters.some((f) => f.text === 'COOKED')).toBe(true);
  });

  it('a cooked enemy deals half damage on their next turn only', () => {
    const g = game();
    const [lari, kie] = g.players as [(typeof g.players)[0], (typeof g.players)[0]];
    fire(g);
    g.projectiles = [];
    g.bursts = [];
    explode(g, kie.x, kie.y - TANK_BODY_HEIGHT, theRizzler, lari.id);
    resolve(g);
    pass(g); // -> kie's turn: cooked
    expect(currentPlayer(g)).toBe(kie);
    expect(offence(g, kie.id)).toBe(0.5);
    let hp = lari.hp;
    explode(g, lari.x, lari.y - TANK_BODY_HEIGHT, shell, kie.id); // kie lands a direct hit
    expect(hp - lari.hp).toBe(Math.round(shell.damage * 0.5));
    pass(g); // -> larinovsky
    expect(kie.cooked).toBeNull();
    pass(g); // -> kie again, full strength
    expect(offence(g, kie.id)).toBe(1);
    hp = lari.hp;
    explode(g, lari.x, lari.y - TANK_BODY_HEIGHT, shell, kie.id);
    expect(hp - lari.hp).toBe(shell.damage);
  });

  it('cooking weakens damage over time too (toxic sludge burns at half strength)', () => {
    const burnFor = (cooked: boolean) => {
      const g = createGame({ seed: 61, players: [players[0]!, { name: 'tones', colour: '#ff5a5f', characterId: 'tones' }] });
      const w = g.terrain.width;
      g.terrain = Terrain.fromHeights(new Float32Array(w).fill(400), w, g.terrain.height, createRng(1));
      const [lari, tones] = g.players as [(typeof g.players)[0], (typeof g.players)[0]];
      lari.x = 300;
      tones.x = 700;
      for (const p of g.players) p.y = 400;
      if (cooked) tones.cooked = { active: true, multiplier: 0.5 };
      // tones' ten-3 sludge right next to larinovsky
      g.puddles.push({ x: lari.x + 12, y: 400, radius: 7, ownerId: tones.id, weaponId: 'ten-3', age: 0, ttl: 2.5 });
      g.phase = 'flying';
      resolve(g);
      return MAX_HP - lari.hp;
    };
    const full = burnFor(false);
    const half = burnFor(true);
    expect(full).toBeGreaterThan(20);
    expect(half).toBeGreaterThanOrEqual(Math.floor(full / 2) - 1);
    expect(half).toBeLessThanOrEqual(Math.ceil(full / 2) + 1);
  });

  it('hitting a decoy with the Rizzler cooks nobody', () => {
    const g = createGame({ seed: 62, players });
    const kie = g.players[1]!;
    g.holograms.push({ id: 99, ownerId: kie.id, x: 500, y: g.terrain.surfaceY(500), hits: [], soak: 0, soakShooterId: -1, soakColour: '#fff', age: 1 });
    fire(g);
    g.projectiles = [];
    g.bursts = [];
    explode(g, 500, g.terrain.surfaceY(500) - TANK_BODY_HEIGHT, theRizzler, 0);
    expect(kie.cooked).toBeNull();
    expect(g.players[0]!.cooked).toBeNull();
  });
});

describe('Take a Nap', () => {
  it('needs no aiming, dozes for a bit, then wakes at full health', () => {
    const g = game();
    const lari = g.players[0]!;
    lari.hp = 37;
    selectTier(g, 2);
    expect(isAimless(g)).toBe(true);
    fire(g);
    for (let t = 0; t < takeANap.heal!.napTime - 0.2; t += FIXED_DT) step(g, FIXED_DT);
    expect(lari.hp).toBe(37); // still asleep
    expect(g.floaters.some((f) => f.text === 'z' || f.text === 'Z')).toBe(true);
    resolve(g);
    expect(lari.hp).toBe(MAX_HP);
    expect(g.floaters.some((f) => f.text === `+${MAX_HP - 37}`)).toBe(true);
    expect(lari.ammo[2]).toBe(0);
    for (let t = 0; t < 3 && g.phase !== 'aiming'; t += FIXED_DT) step(g, FIXED_DT);
    expect(currentPlayer(g).name).toBe('kie');
  });
});

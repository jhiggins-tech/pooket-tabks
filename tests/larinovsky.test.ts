import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { Terrain } from '../src/core/terrain';
import { FIXED_DT, MAX_HP, TANK_BODY_HEIGHT } from '../src/game/constants';
import { createGame, currentPlayer, explode, fire, isAimless, offence, selectTier, setAim, step } from '../src/game/game';
import type { GameState, Projectile } from '../src/game/state';
import { pillPusher, takeANap, theRizzler, womenInScam } from '../src/characters/kits';
import { getWeapon, shell } from '../src/weapons/registry';
import { passTurn, testGame, whileFlying } from './support/game';

const players = [
  { name: 'larinovsky', colour: '#34d399', characterId: 'larinovsky' },
  { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
];

function game(): GameState {
  return testGame({ seed: 60, players, xs: [300, 700] });
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
    // A mixed handful: each pill in the series looks different.
    const looks = [...seen].map((pr) => pillPusher.spriteVariants![(pr as { variant?: number }).variant ?? 0]);
    expect(new Set(looks).size).toBe(pillPusher.burst!.count);
    expect(looks).toContain('pill-round');
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
    whileFlying(g);
    passTurn(g); // -> kie's turn: cooked
    expect(currentPlayer(g)).toBe(kie);
    expect(offence(g, kie.id)).toBe(0.5);
    let hp = lari.hp;
    explode(g, lari.x, lari.y - TANK_BODY_HEIGHT, shell, kie.id); // kie lands a direct hit
    expect(hp - lari.hp).toBe(Math.round(shell.damage * 0.5));
    passTurn(g); // -> larinovsky
    expect(kie.cooked).toBeNull();
    passTurn(g); // -> kie again, full strength
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
      whileFlying(g);
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
    g.holograms.push({ id: 99, ownerId: kie.id, x: 500, y: g.terrain.surfaceY(500), weaponId: 'trollogram', hit: false, soak: 0, soakColour: '#fff', age: 1 });
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
    whileFlying(g);
    expect(lari.hp).toBe(MAX_HP);
    expect(g.floaters.some((f) => f.text === `+${MAX_HP - 37}`)).toBe(true);
    expect(lari.ammo[2]).toBe(0);
    for (let t = 0; t < 3 && g.phase !== 'aiming'; t += FIXED_DT) step(g, FIXED_DT);
    expect(currentPlayer(g).name).toBe('kie');
  });

  it('wakes with Pill Pusher and the Rizzler fully restocked, but not another nap (or a spent Women in Scam)', () => {
    const g = game();
    const lari = g.players[0]!;
    lari.ammo = [1, 0, 1, 1];
    selectTier(g, 2);
    fire(g);
    whileFlying(g);
    expect(lari.ammo).toEqual([5, 3, 0, 1]);
    expect(g.floaters.some((f) => f.text === 'Ammo restocked')).toBe(true);
  });

  it("keeps a stolen round on top of a full stock, and doesn't brag about a restock that changed nothing", () => {
    const g = game();
    const lari = g.players[0]!;
    lari.ammo = [6, 3, 1, 1];
    selectTier(g, 2);
    fire(g);
    whileFlying(g);
    expect(lari.ammo).toEqual([6, 3, 0, 1]);
    expect(g.floaters.some((f) => f.text === 'Ammo restocked')).toBe(false);
  });
});

describe('Women in Scam', () => {
  /** larinovsky (player 0) arms the scam, then fires a harmless shot straight up; kie's turn comes up. */
  function armed(): GameState {
    const g = game();
    selectTier(g, 3);
    expect(isAimless(g)).toBe(true);
    expect(fire(g)).toBe(true);
    expect(g.phase).toBe('aiming'); // a bonus move: still larinovsky's turn
    expect(currentPlayer(g).name).toBe('larinovsky');
    expect(g.players[0]!.ammo[3]).toBe(0);
    expect(g.players[0]!.selectedTier).toBe(0);
    expect(g.players[0]!.scam).toEqual({ loot: null });
    passTurn(g);
    expect(currentPlayer(g).name).toBe('kie');
    expect(g.players[0]!.scam).not.toBeNull(); // still on for kie's turn
    return g;
  }

  /** kie fires Weasel Pop (tier 1), with the shot's blast landing on larinovsky's tank. */
  function kieHitsLari(g: GameState): void {
    selectTier(g, 0);
    fire(g);
    g.projectiles = [];
    g.bursts = [];
    const lari = g.players[0]!;
    explode(g, lari.x, lari.y - TANK_BODY_HEIGHT / 2, getWeapon('weasel-pop'), 1);
    explode(g, lari.x, lari.y - TANK_BODY_HEIGHT / 2, getWeapon('weasel-pop'), 1); // hit twice: still one round
    whileFlying(g);
    for (let t = 0; t < 3 && g.phase !== 'aiming'; t += FIXED_DT) step(g, FIXED_DT);
  }

  it("is a bonus move: an enemy hit on larinovsky's tank next turn earns a round of that weapon", () => {
    const g = armed();
    const lari = g.players[0]!;
    kieHitsLari(g);
    expect(lari.hp).toBeLessThan(MAX_HP);
    expect(currentPlayer(g).name).toBe('larinovsky');
    expect(lari.scam).toBeNull();
    expect(lari.loadout).toEqual(['pill-pusher', 'the-rizzler', 'take-a-nap', 'women-in-scam', 'weasel-pop']);
    expect(lari.ammo[4]).toBe(1);
    expect(g.floaters.some((f) => f.text.startsWith('SCAMMED'))).toBe(true);
    // And it fires like any other weapon.
    expect(selectTier(g, 4)).toBe(true);
    setAim(g, 60, 50);
    expect(fire(g)).toBe(true);
    expect(lari.ammo[4]).toBe(0);
  });

  it('a miss earns nothing, and the scam is over after that one enemy turn', () => {
    const g = armed();
    const lari = g.players[0]!;
    passTurn(g); // kie's turn, no hit
    expect(currentPlayer(g).name).toBe('larinovsky');
    expect(lari.scam).toBeNull();
    expect(lari.loadout).toHaveLength(4);
    passTurn(g); // larinovsky's own turn
    kieHitsLari(g); // too late
    expect(lari.loadout).toHaveLength(4);
  });

  it("only larinovsky's own tank counts, and only an enemy's attack", () => {
    const g = armed();
    const lari = g.players[0]!;
    // kie's shot hits kie; and a burn ticking as larinovsky's turn comes up isn't an attack.
    lari.burn = { damagePerTurn: 5, turnsLeft: 1, colour: '#f00' };
    selectTier(g, 0);
    fire(g);
    g.projectiles = [];
    g.bursts = [];
    const kie = g.players[1]!;
    explode(g, kie.x, kie.y - TANK_BODY_HEIGHT / 2, getWeapon('weasel-pop'), 1);
    whileFlying(g);
    for (let t = 0; t < 3 && g.phase !== 'aiming'; t += FIXED_DT) step(g, FIXED_DT);
    expect(lari.hp).toBe(MAX_HP - 5);
    expect(lari.loadout).toHaveLength(4);
  });

  it("is once a match: Take a Nap doesn't bring it back", () => {
    const g = armed();
    passTurn(g);
    selectTier(g, 2);
    fire(g);
    whileFlying(g);
    expect(g.players[0]!.ammo).toEqual([5, 3, 0, 0]);
  });

  it('with nothing left to fire after it, the turn passes (and the scam still stands)', () => {
    const g = game();
    const lari = g.players[0]!;
    lari.ammo = [0, 0, 0, 1];
    selectTier(g, 3);
    fire(g);
    for (let t = 0; t < 3 && g.phase !== 'aiming'; t += FIXED_DT) step(g, FIXED_DT);
    expect(currentPlayer(g).name).toBe('kie');
    expect(lari.scam).not.toBeNull();
  });

  it('describes itself as a bonus move', () => {
    expect(womenInScam.info).toMatch(/doesn’t use your turn/);
  });
});

describe('the Rizzler homes in', () => {
  /** Throw a projectile of `weaponId` from larinovsky along a fixed path; returns its closest approach to kie. */
  function lob(g: GameState, weaponId: string, from: { x: number; y: number }, v: { x: number; y: number }): number {
    const kie = g.players[1]!;
    const pr: Projectile = { x: from.x, y: from.y, vx: v.x, vy: v.y, weaponId, ownerId: 0, trail: [], bounces: 0, age: 0, walkDir: 0, walkTime: 0 };
    g.projectiles.push(pr);
    g.phase = 'flying';
    let closest = Infinity;
    for (let t = 0; t < 10 && g.projectiles.includes(pr); t += FIXED_DT) {
      closest = Math.min(closest, Math.hypot(pr.x - kie.x, pr.y - (kie.y - TANK_BODY_HEIGHT / 2)));
      step(g, FIXED_DT);
    }
    return closest;
  }
  // Sails over kie's head, a little too high.
  const PATH = [{ x: 450, y: 300 }, { x: 450, y: -100 }] as const;

  it('a near miss (within its range) curves in and hits, even a fast one', () => {
    const control = game();
    const closest = lob(control, shell.id, ...PATH);
    expect(control.players[1]!.hp).toBe(MAX_HP); // a plain shell on this path misses...
    expect(closest).toBeGreaterThan(40);
    expect(closest).toBeLessThan(theRizzler.homing!.radius); // ...but passes within range

    const g = game();
    lob(g, theRizzler.id, ...PATH);
    const kie = g.players[1]!;
    expect(kie.hp).toBeLessThan(MAX_HP - theRizzler.damage * 0.6);
    expect(kie.cooked).not.toBeNull();
    expect(g.sfx.some((e) => e.cue === 'lock-on')).toBe(true);

    const quick = game();
    expect(lob(quick, shell.id, { x: 450, y: 300 }, { x: 550, y: -100 })).toBeLessThan(theRizzler.homing!.radius);
    expect(quick.players[1]!.hp).toBe(MAX_HP);
    const fastOne = game();
    lob(fastOne, theRizzler.id, { x: 450, y: 300 }, { x: 550, y: -100 });
    expect(fastOne.players[1]!.hp).toBeLessThan(MAX_HP);
  });

  it('a wide miss (out of range) flies on by', () => {
    const g = game();
    const closest = lob(g, theRizzler.id, { x: 450, y: 300 }, { x: 550, y: -250 });
    expect(closest).toBeGreaterThan(theRizzler.homing!.radius);
    expect(g.players[1]!.hp).toBe(MAX_HP);
    expect(g.sfx.some((e) => e.cue === 'lock-on')).toBe(false);
  });

  it('never homes in on its own side', () => {
    const g = game();
    const lari = g.players[0]!;
    // Right past larinovsky's own tank.
    const pr: Projectile = { x: lari.x - 60, y: lari.y - 90, vx: 200, vy: 0, weaponId: theRizzler.id, ownerId: 0, trail: [], bounces: 0, age: 0, walkDir: 0, walkTime: 0 };
    g.projectiles.push(pr);
    g.phase = 'flying';
    for (let i = 0; i < 20; i++) step(g, FIXED_DT);
    expect(pr.homing).toBeFalsy();
  });

  it('says so in its info', () => {
    expect(theRizzler.info).toMatch(/homes/);
    expect(theRizzler.info).toContain(`${theRizzler.homing!.radius}px`);
  });
});

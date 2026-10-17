import { describe, expect, it } from 'vitest';
import { FIXED_DT, MAX_HP, TANK_BODY_HEIGHT } from '../src/game/constants';
import { explode, fire, selectTier, setAim, step } from '../src/game/game';
import type { GameState, Projectile } from '../src/game/state';
import { mrBean, theRizzler } from '../src/characters/kits';
import { shell } from '../src/weapons/registry';
import { testGame, whileFlying } from './support/game';

const players = [
  { name: 'garyoldmancorp', colour: '#cbd5e1', characterId: 'garyoldmancorp' },
  { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
];

function game(): GameState {
  return testGame({ seed: 61, players, xs: [300, 700] });
}

/** Throw one projectile of `weaponId` from gary along a fixed path; returns its closest approach to kie. */
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

describe('Mr Bean', () => {
  it('rapid-fires ten beans along the aim, for one round, spreading a little', () => {
    const g = game();
    selectTier(g, 0);
    setAim(g, 45, 60);
    fire(g);
    expect(g.projectiles).toHaveLength(0); // not all at once
    const seen = new Map<object, number>();
    let t = 0;
    while (g.bursts.length > 0 && t < 3) {
      step(g, FIXED_DT);
      t += FIXED_DT;
      for (const pr of g.projectiles) if (pr.weaponId === mrBean.id && !seen.has(pr)) seen.set(pr, Math.atan2(-pr.vy, pr.vx));
    }
    expect(seen.size).toBe(10);
    expect(t).toBeLessThan(mrBean.burst.interval * 10 + 0.1); // rapid
    const angles = [...seen.values()].map((a) => (a * 180) / Math.PI);
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(2); // a spread...
    expect(Math.max(...angles) - Math.min(...angles)).toBeLessThan(mrBean.burst.aimJitterDeg * 2 + 1); // ...a slight one
    expect(g.players[0]!.ammo[0]).toBe(4);
  });

  it('a bean that hits does 2, wherever on the tank it lands', () => {
    const g = game();
    const kie = g.players[1]!;
    explode(g, kie.x + 10, kie.y - TANK_BODY_HEIGHT, mrBean, 0);
    expect(kie.hp).toBe(MAX_HP - 2);
    explode(g, kie.x, kie.y - TANK_BODY_HEIGHT, mrBean, 0);
    expect(kie.hp).toBe(MAX_HP - 4);
  });

  it('homes in harder than the Rizzler: further out, and it turns tighter', () => {
    expect(mrBean.homing.radius).toBeGreaterThan(theRizzler.homing.radius);
    expect(mrBean.homing.turnRate).toBeGreaterThan(theRizzler.homing.turnRate);
    // Sails well over kie: out of the Rizzler's reach, in the beans'.
    const path = [{ x: 450, y: 300 }, { x: 550, y: -250 }] as const;
    const control = game();
    const closest = lob(control, shell.id, ...path);
    expect(control.players[1]!.hp).toBe(MAX_HP);
    expect(closest).toBeGreaterThan(theRizzler.homing.radius);
    expect(closest).toBeLessThan(mrBean.homing.radius);
    const rizz = game();
    lob(rizz, theRizzler.id, ...path);
    expect(rizz.players[1]!.hp).toBe(MAX_HP);
    const bean = game();
    lob(bean, mrBean.id, ...path);
    expect(bean.players[1]!.hp).toBe(MAX_HP - 2);
    expect(bean.sfx.some((e) => e.cue === 'lock-on' && e.weaponId === mrBean.id)).toBe(true);
  });

  it('a near miss: most of the burst still lands', () => {
    const g = game();
    selectTier(g, 0);
    // Aimed to land well short of kie (the Rizzler, aimed the same, misses).
    setAim(g, 50, 45);
    fire(g);
    whileFlying(g);
    const hits = (MAX_HP - g.players[1]!.hp) / 2;
    expect(hits).toBeGreaterThanOrEqual(7);
    expect(g.players[0]!.hp).toBe(MAX_HP);
  });

  it('says so in its info', () => {
    expect(mrBean.info).toContain('10 coffee beans');
    expect(mrBean.info).toContain(`${mrBean.homing.radius}px`);
    expect(mrBean.info).toContain(`${mrBean.damage} damage each`);
  });
});

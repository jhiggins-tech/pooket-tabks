import { describe, expect, it } from 'vitest';
import { AMMO_PER_TIER } from '../src/characters/roster';
import { FIXED_DT, FUEL_PER_MATCH } from '../src/game/constants';
import { callClock, canUseSlot, currentPlayer, fire, pressArrow, selectTier, step } from '../src/game/game';
import { cancelCall, drawStratagems, launchAt } from '../src/game/stratagems';
import type { GameState } from '../src/game/state';
import { getWeapon, weaponOf } from '../src/weapons/registry';
import { STRATAGEMS, stratagemOf, type Arrow } from '../src/weapons/stratagems';
import { FLAT_Y, hold, passTurn, stepUntil, testGame, untilAiming, untilNextTurn, whileFlying } from './support/game';

const players = [
  { name: 'Boyz', colour: '#f87171', characterId: 'shotdownboyz' },
  { name: 'Kie', colour: '#4ea8ff', characterId: 'kie' },
];

/** A flat match, ShotDownBoyz at 300 (first) and kie at 800, with the stratagems given ready. */
function match(ids: string[] = ['railcannon', 'orbital-laser', 'autocannon-sentry', 'smg', 'resupply']): GameState {
  const g = testGame({ seed: 50, players, xs: [300, 800] });
  g.current = 0;
  g.players[0]!.stratagems = ids.map((id) => ({ id, rearm: 0 }));
  return g;
}

/** Key a whole combo. */
function key(g: GameState, combo: string): void {
  for (const a of combo) pressArrow(g, a as Arrow);
}

/** What `id` calls in comes down at x (as if a beacon had landed there), and plays out; then it's his turn again. */
function callIn(g: GameState, id: string, x: number): void {
  g.drops.push({ ownerId: 0, stratagem: id, x, y: FLAT_Y, t: 0, beamX: x, beamY: FLAT_Y, pulses: 0, podY: null, done: false });
  g.phase = 'flying';
  untilAiming(g);
  g.current = 0;
}

describe('the stratagems', () => {
  it('have distinct combos, none the start of another, and real weapons to drop', () => {
    for (const a of STRATAGEMS) {
      expect(a.combo, a.id).toMatch(/^[UDLR]{4,6}$/);
      for (const b of STRATAGEMS) if (a !== b) expect(b.combo.startsWith(a.combo), `${a.id} / ${b.id}`).toBe(false);
      if (a.category === 'weapon') expect(getWeapon(a.weaponId).id).toBe(a.weaponId);
    }
    // Helldivers 2's own combos.
    expect(stratagemOf('orbital-laser').combo).toBe('RDURD');
    expect(stratagemOf('railcannon').combo).toBe('RUDDR');
    expect(stratagemOf('resupply').combo).toBe('DDUR');
  });

  it('are all there every match', () => {
    expect(drawStratagems()).toEqual(STRATAGEMS.map((s) => s.id));
    const g = testGame({ seed: 77, players });
    expect(g.players[0]!.stratagems.map((s) => s.id)).toEqual(STRATAGEMS.map((s) => s.id));
  });
});

describe('keying a stratagem', () => {
  it('FIRE brings up the d-pad; a wrong arrow wipes the input; the finished combo throws the beacon', () => {
    const g = match();
    const p = currentPlayer(g);
    expect(selectTier(g, 1)).toBe(true);
    expect(fire(g)).toBe(false);
    expect(g.phase).toBe('calling');
    expect(p.ammo[1]).toBe(AMMO_PER_TIER[1]);

    pressArrow(g, 'R');
    expect(g.call!.input).toBe('R');
    pressArrow(g, 'L'); // nothing starts R L
    expect(g.call!.input).toBe('');
    expect(g.call!.wrongAt).not.toBeNull();
    key(g, 'RUDD');
    expect(fire(g)).toBe(false); // not finished yet
    pressArrow(g, 'R');
    expect(g.call!.picked).toBe('railcannon');

    p.angle = 90;
    p.power = 25;
    expect(fire(g)).toBe(true);
    expect(g.call).toBeNull();
    expect(p.ammo[1]).toBe(AMMO_PER_TIER[1]! - 1);
    expect(g.projectiles.some((pr) => pr.stratagem === 'railcannon')).toBe(true);
    expect(p.stratagems.find((s) => s.id === 'railcannon')!.rearm).toBe(stratagemOf('railcannon').cooldown + 1);
  });

  it('out of time, it’s called off with nothing spent', () => {
    const g = match();
    const p = currentPlayer(g);
    selectTier(g, 1);
    fire(g);
    pressArrow(g, 'D');
    for (let t = 0; t < 10.1; t += FIXED_DT) callClock(g, FIXED_DT);
    expect(g.call!.done).toBe(true);
    expect(g.call!.picked).toBeNull();
    expect(fire(g)).toBe(false);
    cancelCall(g);
    expect(g.phase).toBe('aiming');
    expect(p.ammo[1]).toBe(AMMO_PER_TIER[1]);
    expect(p.stratagems.every((s) => s.rearm === 0)).toBe(true);
  });

  it('a stratagem re-arms over his next turns, and its card can’t be keyed meanwhile', () => {
    const g = match(['railcannon', 'resupply']);
    const p = currentPlayer(g);
    selectTier(g, 1);
    fire(g);
    key(g, 'RUDDR');
    p.angle = 90;
    p.power = 20;
    fire(g);
    untilAiming(g);
    const rail = p.stratagems.find((s) => s.id === 'railcannon')!;
    const cooldown = stratagemOf('railcannon').cooldown;
    passTurn(g); // kie's turn over: his next turn starts
    expect(currentPlayer(g)).toBe(p);
    expect(rail.rearm).toBe(cooldown);
    selectTier(g, 1);
    fire(g);
    key(g, 'RUDDR');
    expect(g.call!.picked).toBeNull(); // re-arming: R fits nothing ready
    for (let k = 1; k < cooldown; k++) {
      passTurn(g);
      passTurn(g);
    }
    expect(rail.rearm).toBe(1);
    passTurn(g);
    passTurn(g);
    expect(rail.rearm).toBe(0);
  });

  it('with every one re-arming the slot can’t be used; if that’s all he has left, the soonest re-arms at once', () => {
    const g = match(['railcannon']);
    const p = currentPlayer(g);
    p.stratagems[0]!.rearm = 4;
    expect(canUseSlot(g, p, 1)).toBe(false);
    p.ammo[0] = 0;
    p.ammo[2] = 0;
    passTurn(g);
    passTurn(g);
    expect(currentPlayer(g)).toBe(p);
    expect(canUseSlot(g, p, 1)).toBe(true);
  });
});

describe('what comes down', () => {
  it('the Railcannon: huge damage on the beacon, and it hurts him too if it’s at his feet', () => {
    const g = match();
    const [boyz, kie] = g.players as [GameState['players'][0], GameState['players'][0]];
    callIn(g, 'railcannon', 800);
    expect(kie.hp).toBeLessThanOrEqual(kie.maxHp - 80);
    expect(g.terrain.isSolid(800, FLAT_Y + 2)).toBe(false);

    const own = match();
    callIn(own, 'railcannon', 305);
    expect(own.players[0]!.hp).toBeLessThan(boyz.maxHp - 50);
  });

  it('the Orbital Laser burns in pulses, drifting onto an enemy close by and cutting a trench', () => {
    const g = match();
    const kie = g.players[1]!;
    callIn(g, 'orbital-laser', 740);
    expect(kie.hp).toBeLessThan(kie.maxHp - 25);
    expect(g.terrain.isSolid(770, FLAT_Y + 2)).toBe(false);
  });

  it('a sentry drops and fires each time anyone fires, until its three rounds are gone', () => {
    const g = match();
    const kie = g.players[1]!;
    callIn(g, 'autocannon-sentry', 500);
    expect(g.sentries).toHaveLength(1);
    const hp = kie.hp;
    // Kie's turn: Kie fires (straight up, a harmless miss), and the sentry fires too.
    g.current = 1;
    g.phase = 'aiming';
    kie.selectedTier = 0;
    kie.angle = 90;
    kie.power = 5;
    fire(g);
    expect(g.sentries[0]!.shots).toBe(2);
    untilAiming(g);
    expect(kie.hp).toBeLessThan(hp);
    for (let i = 0; i < 2; i++) {
      const who = currentPlayer(g);
      who.angle = 90;
      who.power = 5;
      who.selectedTier = 0;
      fire(g);
      untilNextTurn(g);
    }
    expect(g.sentries).toHaveLength(0);
  });

  it('the Autocannon fires a short burst of rounds dead straight at the nearest enemy, no drop', () => {
    const g = match();
    const kie = g.players[1]!;
    callIn(g, 'autocannon-sentry', 500);
    const boyz = g.players[0]!;
    boyz.angle = 90;
    boyz.power = 5;
    fire(g);
    const rounds = g.projectiles.filter((pr) => pr.weaponId === 'autocannon-shell');
    expect(rounds).toHaveLength(5);
    expect(rounds.filter((pr) => pr.wait === undefined)).toHaveLength(1);
    const first = rounds[0]!;
    const vy = first.vy;
    step(g, 0.05);
    expect(first.vy).toBe(vy); // (no gravity)
    expect(Math.sign(first.vx)).toBe(Math.sign(kie.x - 500));
    const hp = kie.hp;
    untilAiming(g);
    expect(kie.hp).toBeLessThan(hp);
  });

  it('the Tesla Tower zaps every tank close by, his own included', () => {
    const g = match();
    const [boyz, kie] = g.players as [GameState['players'][0], GameState['players'][0]];
    kie.x = 360;
    kie.y = FLAT_Y;
    callIn(g, 'tesla-tower', 330);
    boyz.angle = 90;
    boyz.power = 5;
    fire(g);
    untilAiming(g);
    expect(kie.hp).toBeLessThan(kie.maxHp);
    expect(boyz.hp).toBeLessThan(boyz.maxHp);
  });

  it('a weapon pod hurts whoever it lands on, and they get it: it takes their tier 1’s place', () => {
    const g = match();
    const kie = g.players[1]!;
    const rounds = kie.ammo[0];
    callIn(g, 'smg', 800);
    expect(kie.hp).toBe(kie.maxHp - 8);
    expect(g.crates).toHaveLength(0);
    expect(kie.loadout[0]).toBe('smg');
    expect(kie.ammo[0]).toBe(rounds);

    const own = match();
    callIn(own, 'spear', 300);
    expect(own.players[0]!.hp).toBe(own.players[0]!.maxHp - 8);
    expect(own.players[0]!.loadout[0]).toBe('spear');
  });

  it('driving into a weapon pod swaps it in for the Pistol, rounds and all', () => {
    const g = match();
    const boyz = g.players[0]!;
    callIn(g, 'smg', 600);
    expect(g.crates).toHaveLength(1);
    g.crates[0]!.x = 330;
    boyz.ammo[0] = 2;
    hold(g, 1, 2);
    expect(g.crates).toHaveLength(0);
    expect(boyz.loadout[0]).toBe('smg');
    expect(boyz.ammo[0]).toBe(2);
  });

  it('Resupply: a jerry can in reserve, 3 Pistol rounds and 1 Stratagem round, never past full', () => {
    const g = match();
    const boyz = g.players[0]!;
    callIn(g, 'resupply', 320);
    boyz.ammo[0] = 1;
    boyz.ammo[1] = AMMO_PER_TIER[1]!;
    boyz.hp = 50;
    const cans = boyz.dieselCans;
    hold(g, 1, 0.5);
    expect(boyz.hp).toBe(50 + Math.round(boyz.maxHp * 0.3));
    expect(boyz.dieselCans).toBe(cans + 1);
    expect(boyz.ammo[0]).toBe(4);
    expect(boyz.ammo[1]).toBe(AMMO_PER_TIER[1]);
    expect(boyz.loadout[0]).toBe('pistol');
  });

  it('anyone can drive into a Resupply: 30% health back (not past full) and a full tank of fuel', () => {
    const g = match();
    const kie = g.players[1]!;
    callIn(g, 'resupply', 780);
    g.current = 1;
    kie.fuel = 10;
    kie.hp = kie.maxHp - 10;
    hold(g, -1, 0.3);
    expect(g.crates).toHaveLength(0);
    expect(kie.hp).toBe(kie.maxHp);
    expect(kie.fuel).toBeGreaterThan(FUEL_PER_MATCH - 10); // (topped up mid-drive)
    expect(kie.dieselCans).toBe(0);
  });

  it('a beacon thrown straight up comes down beside him and calls it in there', () => {
    const g = match(['resupply']);
    const p = currentPlayer(g);
    selectTier(g, 1);
    fire(g);
    key(g, 'DDUR');
    p.angle = 90;
    p.power = 30;
    fire(g);
    stepUntil(g, (s) => s.drops.length > 0, 5);
    expect(Math.abs(g.drops[0]!.x - p.x)).toBeLessThan(15);
    whileFlying(g);
    step(g, FIXED_DT);
    // It came down right by him: picked up as it landed.
    expect(g.crates).toHaveLength(0);
    expect(p.dieselCans).toBe(2);
  });
});

describe('the weapon drops', () => {
  it('the Spear, right over an enemy, pops up and slams straight down on them', () => {
    const g = match();
    const kie = g.players[1]!;
    kie.x = 600;
    kie.y = FLAT_Y;
    g.phase = 'flying';
    const pr = { x: 560, y: FLAT_Y - 150, vx: 300, vy: 0, weaponId: 'spear', ownerId: 0, trail: [], bounces: 0, age: 0, walkDir: 0, walkTime: 0 } as GameState['projectiles'][0];
    g.projectiles.push(pr);
    stepUntil(g, () => pr.attack !== undefined, 2);
    expect(pr.attack).toBe('pop');
    expect(pr.vx).toBe(0);
    expect(pr.vy).toBeLessThan(0);
    const top = pr.y;
    stepUntil(g, () => pr.attack === 'slam', 2);
    expect(pr.y).toBeLessThan(top); // (it went up first)
    expect(pr.vx).toBe(0);
    const hp = kie.hp;
    untilAiming(g);
    expect(Math.abs(pr.x - kie.x)).toBeLessThanOrEqual(8);
    expect(kie.hp).toBeLessThan(hp - 25);
  });

  it('the Grenade Pistol’s grenade bounces three times before it goes off', () => {
    expect(weaponOf('grenade-pistol', 'ballistic').bounces).toBe(3);
  });
});

describe('the Autocannon’s aim', () => {
  it('works out a launch that lands on the target', () => {
    const v = launchAt(100, 300, 500, 350, [35])!;
    // Fly it: where is it when it's back at x = 500?
    const t = 400 / v.vx;
    expect(300 + v.vy * t + 0.5 * 400 * t * t).toBeCloseTo(350, 3);
    expect(launchAt(100, 300, 120, 0, [35])).toBeNull(); // too steep for 35°
  });
});

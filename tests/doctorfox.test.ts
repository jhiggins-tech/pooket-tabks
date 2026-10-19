import { describe, expect, it } from 'vitest';
import { airStrike, hoopDreamz, sly } from '../src/characters/kits';
import { FIXED_DT, FUEL_PER_MATCH } from '../src/game/constants';
import { STRIKE, STRIKE_BEAT, canFire, explode, fire, hoopFor, isAimless, isSly, shipAt, strikeClock, selectTier, sneakClock, sneakLeft, sneakReady, step } from '../src/game/game';
import type { GameState } from '../src/game/state';
import { nearestEnemyX } from '../src/game/tanks';
import { COMMS, PILOTS, TYPE_RATE } from '../src/weapons/comms';
import { applyPreview, previewOf } from '../src/net/follow';
import { hold, passTurn, stepUntil, testGame, untilNextTurn } from './support/game';

const players = [
  { name: 'fox', colour: '#fb923c', characterId: 'doctorfox' },
  { name: 'gary', colour: '#cbd5e1', characterId: 'garyoldmancorp' },
];

/** doctorfox at 300 and garyoldmancorp at 700, on flat ground; fox to play, with Sly selected and half his fuel gone. */
function game(): GameState {
  const g = testGame({ seed: 3, players, xs: [300, 700] });
  g.current = 0;
  g.players[0]!.fuel = FUEL_PER_MATCH / 2;
  selectTier(g, 1);
  return g;
}

/** Run Sly's clock (his phone's) for `seconds`, holding ◀ / ▶ (`dir`) or not (as main.ts drives every tick). */
function sneakFor(g: GameState, seconds: number, dir = 0): void {
  for (let t = 0; t < seconds; t += FIXED_DT) {
    hold(g, dir, FIXED_DT);
    sneakClock(g, FIXED_DT);
  }
}

describe("doctorfox's Sly", () => {
  it('is his tier 2: FIRE puts the smoke up, fills his tank and hides him, and the round waits to be fired', () => {
    const g = game();
    const fox = g.players[0]!;
    expect(isSly(fox, 1)).toBe(true);
    expect(fire(g)).toBe(false); // not fired yet: the sneaking starts
    expect(g.phase).toBe('sneaking');
    expect(fox.fuel).toBe(FUEL_PER_MATCH);
    expect(fox.hidden).toBe(true);
    expect(fox.ammo[1]).toBe(3);
    expect(g.fx.smokes).toHaveLength(1);
    expect(g.sfx.map((s) => s.cue)).toContain('smoke');
    expect(sneakLeft(g)).toBe(sly.sly.time);
  });

  it('he can drive off until time is up, then it fires, his turn ends and he stays hidden', () => {
    const g = game();
    const fox = g.players[0]!;
    fire(g);
    sneakFor(g, 0.5);
    expect(g.sneak!.movedAt).toBeNull();
    sneakFor(g, 3, -1);
    expect(fox.x).toBeLessThan(300 - 80);
    // Moving off: the stealth powerup kicks in (once).
    expect(g.sneak!.movedAt).toBeCloseTo(0.5, 1);
    expect(g.sfx.filter((s) => s.cue === 'stealth')).toHaveLength(1);
    expect(fox.fuel).toBeLessThan(FUEL_PER_MATCH);
    sneakFor(g, sly.sly.time - 3 + FIXED_DT);
    expect(sneakReady(g)).toBe(true);
    const x = fox.x;
    hold(g, -1, 1); // time's up: no more driving
    expect(fox.x).toBe(x);
    expect(fire(g)).toBe(true);
    expect(fox.ammo[1]).toBe(2);
    expect(g.sneak).toBeNull();
    untilNextTurn(g);
    expect(g.current).toBe(1);
    expect(fox.hidden).toBe(true);
    // His next turn: seen again.
    passTurn(g);
    expect(g.current).toBe(0);
    expect(fox.hidden).toBe(false);
  });

  it('FIRE finishes it sooner', () => {
    const g = game();
    fire(g);
    sneakFor(g, 2);
    expect(canFire(g)).toBe(true);
    expect(fire(g)).toBe(true);
    expect(g.phase).toBe('flying');
    untilNextTurn(g);
    expect(g.current).toBe(1);
  });

  it('he can still be hit, and a hit gives him away', () => {
    const g = game();
    const fox = g.players[0]!;
    fire(g);
    sneakFor(g, sly.sly.time + FIXED_DT);
    fire(g);
    untilNextTurn(g);
    explode(g, fox.x, fox.y - 8, airStrike, 1);
    expect(fox.hp).toBeLessThan(fox.maxHp);
    expect(fox.hidden).toBe(false);
    expect(g.fx.floaters.some((f) => f.text === 'SPOTTED!')).toBe(true);
  });

  it('weapons that seek out the nearest enemy can’t find him', () => {
    const g = game();
    const [fox, gary] = g.players as [typeof g.players[0], typeof g.players[0]];
    expect(nearestEnemyX(g, gary.x, gary.id)).toBe(fox.x);
    fire(g);
    expect(nearestEnemyX(g, gary.x, gary.id)).toBeNull();
    expect(hoopFor(g, gary, hoopDreamz)).toBeNull();
  });

  it('the other phone follows it in the previews: the smoke, and he’s gone', () => {
    const here = game();
    const there = game();
    fire(here);
    sneakFor(here, 1, 1);
    applyPreview(there, previewOf(here));
    expect(there.phase).toBe('sneaking');
    expect(there.players[0]!.hidden).toBe(true);
    expect(there.players[0]!.x).toBe(here.players[0]!.x);
    expect(there.fx.smokes).toHaveLength(1);
    expect(there.sneak!.movedAt).not.toBeNull();
  });
});

describe("doctorfox's Air Strike", () => {
  /** fox to play, with Air Strike selected. */
  function strikeGame(): GameState {
    const g = testGame({ seed: 3, players, xs: [300, 700] });
    g.current = 0;
    selectTier(g, 2);
    return g;
  }

  it('is his tier 3: no aiming, three Arwings on the nearest enemy, a comm, lasers and the bomb', () => {
    const g = strikeGame();
    const gary = g.players[1]!;
    expect(isAimless(g)).toBe(true);
    expect(fire(g)).toBe(true);
    const s = g.airstrike!;
    expect(s.mark).toEqual({ kind: 'tank', playerId: 1, twin: false });
    expect(s.dir).toBe(1);
    expect(COMMS[s.pilot]).toBeDefined();
    expect(s.aims).toHaveLength(airStrike.airstrike.lasers);
    expect(s.aims.every((a) => Math.abs(a) <= airStrike.airstrike.spread)).toBe(true);
    // The ships come out of the ping on the horizon, small, and are full size over the target.
    expect(shipAt(s, 0, 0.1)).toBeNull();
    expect(shipAt(s, 0, STRIKE.arrive + 0.01)!.scale).toBeLessThan(0.2);
    const c = strikeClock(s);
    expect(shipAt(s, 0, c.strafe)!.scale).toBe(1);
    // Nothing fires until the comm is over: the ping, the approach and the comm come first.
    expect(c.commEnd).toBeGreaterThan(STRIKE.comm + COMMS[s.pilot]!.line.length / TYPE_RATE);
    stepUntil(g, () => g.airstrike!.t >= c.commEnd, 10);
    expect(g.airstrike!.bolts).toHaveLength(0);
    expect(gary.hp).toBe(gary.maxHp);
    untilNextTurn(g);
    expect(g.airstrike).toBeNull();
    expect(g.current).toBe(1);
    const cues = g.sfx.map((e) => e.cue);
    for (const cue of ['kira', 'arwings', 'comm', 'smart-bomb'] as const) expect(cues).toContain(cue);
    // The bomb lands on him (up to 40), plus whatever lasers hit.
    expect(gary.hp).toBeLessThanOrEqual(gary.maxHp - 30);
    expect(gary.hp).toBeGreaterThanOrEqual(gary.maxHp - airStrike.damage - airStrike.airstrike.lasers * airStrike.airstrike.laserDamage);
  });

  it('has backing music on the beat: counted down to the dive, then the theme, landing on the bomb', () => {
    const g = strikeGame();
    fire(g);
    const s = g.airstrike!;
    const c = strikeClock(s);
    const beats: { k: number; t: number }[] = [];
    let bombAt = -1;
    while (g.airstrike) {
      const from = g.sfx.length;
      step(g, FIXED_DT);
      for (const e of g.sfx.slice(from)) {
        if (e.cue === 'strike-beat') beats.push({ k: e.size!, t: s.t });
        if (e.cue === 'smart-bomb') bombAt = s.t;
      }
    }
    const ks = beats.map((b) => b.k);
    expect(ks[ks.length - 1]).toBe(-8);
    ks.forEach((k, i) => i > 0 && expect(k).toBe(ks[i - 1]! - 1));
    expect(beats[0]!.t).toBeGreaterThanOrEqual(STRIKE.arrive);
    expect(beats[0]!.t - STRIKE_BEAT).toBeLessThan(STRIKE.arrive);
    expect(beats.find((b) => b.k === 0)!.t).toBeCloseTo(c.dive, 1);
    expect(beats.find((b) => b.k === -8)!.t).toBe(bombAt);
  });

  it('plays out the same on both phones', () => {
    const a = strikeGame();
    const b = strikeGame();
    fire(a);
    fire(b);
    untilNextTurn(a);
    untilNextTurn(b);
    expect(a.players.map((p) => p.hp)).toEqual(b.players.map((p) => p.hp));
  });

  it('can’t find an enemy hidden by Sly', () => {
    const g = strikeGame();
    g.players[1]!.hidden = true;
    fire(g);
    expect(g.airstrike).toBeNull();
    expect(g.fx.floaters.some((f) => f.text === 'NO TARGET')).toBe(true);
    untilNextTurn(g);
    expect(g.players[1]!.hp).toBe(g.players[1]!.maxHp);
  });

  it('has 50 comms, every one from a pilot with a portrait', () => {
    expect(COMMS).toHaveLength(50);
    for (const c of COMMS) {
      expect(PILOTS[c.pilot]).toBeDefined();
      expect(c.line.length).toBeLessThanOrEqual(60);
    }
  });
});

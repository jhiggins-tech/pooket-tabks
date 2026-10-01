import { describe, expect, it } from 'vitest';
import { TANK_BODY_HEIGHT } from '../src/game/constants';
import { fire, selectTier } from '../src/game/game';
import type { GameState, Player } from '../src/game/state';
import { canMove, offence, turnEnding, turnStarting, vulnerable } from '../src/game/statuses';
import { applyHit, targetAt } from '../src/game/tanks';
import type { WeaponDef } from '../src/weapons/types';
import { testGame, untilNextTurn } from './support/game';

/** A weapon with every effect a hit can have, of no particular kind. */
const everything: WeaponDef = {
  id: 'shell',
  name: 'Everything',
  shortName: 'Everything',
  info: '',
  blastRadius: 0,
  damage: 0,
  dot: { damagePerTurn: 6, turns: 2 },
  debuff: { offenceMultiplier: 0.5 },
  tattoo: { multiplier: 1.25, turns: 2 },
  pin: true,
};

/** torikloud (with a twin at x = 450) against kcaj. */
function withTwin(): GameState {
  const g = testGame({
    players: [
      { name: 'tori', colour: '#a78bfa', characterId: 'torikloud' },
      { name: 'kcaj', colour: '#ffc53d', characterId: 'kcaj' },
    ],
    xs: [200, 800],
  });
  selectTier(g, 2);
  fire(g); // Twins
  Object.assign(g.players[0]!.twin!, { x: 450, y: 400 });
  untilNextTurn(g);
  return g;
}

const at = (g: GameState, x: number, y: number) => targetAt(g, x, y - TANK_BODY_HEIGHT)!;

describe('a hit, from any weapon', () => {
  it('leaves every effect its weapon has: burn on the tank hit, the rest on its player', () => {
    const g = withTwin();
    const [tori, kcaj] = g.players as [Player, Player];
    expect(applyHit(g, at(g, 450, 400), everything, kcaj.id, 10)).toBe(true);
    expect(tori.twin!.hp).toBe(75 - 10);
    expect(tori.twin!.burn).toMatchObject({ damagePerTurn: 6, turnsLeft: 2 });
    expect(tori.burn).toBeNull(); // the main tank wasn't hit
    expect(tori.cooked).toEqual({ active: false, multiplier: 0.5 });
    expect(tori.tattoo).toEqual({ multiplier: 1.25, turnsLeft: 2 });
    expect(tori.pinned).toEqual({ active: false });
    expect(g.fx.floaters.map((f) => f.text)).toEqual(expect.arrayContaining(['COOKED', 'TATTOOED', 'PINNED']));
  });

  it('a hit that destroys the tank leaves no burn, but its player is still cooked (if alive)', () => {
    const g = withTwin();
    const tori = g.players[0]!;
    tori.twin!.hp = 5;
    expect(applyHit(g, at(g, 450, 400), everything, 1, 10)).toBe(false);
    expect(tori.twin).toBeNull();
    expect(tori.burn).toBeNull();
    expect(tori.cooked).not.toBeNull();
  });

  it("a weapon without friendly fire doesn't touch its own player", () => {
    const g = withTwin();
    const tori = g.players[0]!;
    expect(applyHit(g, at(g, 200, 400), { ...everything, friendlyFire: false }, tori.id, 10)).toBe(true);
    expect(tori.hp).toBe(75);
    expect(tori.cooked).toBeNull();
  });

  it("a refund-on-miss round knows when it's hit an enemy (not its own player)", () => {
    const g = withTwin();
    g.refund = { playerId: 1, tier: 0, hit: false };
    applyHit(g, at(g, 800, 400), everything, 1, 1);
    expect(g.refund.hit).toBe(false);
    applyHit(g, at(g, 450, 400), everything, 1, 1);
    expect(g.refund.hit).toBe(true);
  });
});

describe('statuses run their course', () => {
  it('cooked and pinned take hold for the next turn and go at its end; a tattoo counts its turns down', () => {
    const g = withTwin();
    const tori = g.players[0]!;
    applyHit(g, at(g, 200, 400), everything, 1, 1);
    expect(offence(g, tori.id)).toBe(1); // not yet: pending
    expect(canMove(tori)).toBe(true);
    turnStarting(tori);
    expect(offence(g, tori.id)).toBe(0.5);
    expect(canMove(tori)).toBe(false);
    expect(vulnerable(tori, 20)).toBe(25);
    turnEnding(tori);
    expect(offence(g, tori.id)).toBe(1);
    expect(canMove(tori)).toBe(true);
    expect(tori.tattoo!.turnsLeft).toBe(1);
    turnEnding(tori);
    expect(tori.tattoo).toBeNull();
  });
});

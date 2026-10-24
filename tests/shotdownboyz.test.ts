import { describe, expect, it } from 'vitest';
import { DRIVE_SPEED, FIXED_DT, FUEL_PER_MATCH } from '../src/game/constants';
import { currentPlayer, fire, hasAmmo, passEmptyTurn, selectTier } from '../src/game/game';
import { canMove } from '../src/game/statuses';
import { repaintBunkers, slitOf } from '../src/game/bunker';
import type { GameState } from '../src/game/state';
import { FLAT_Y, passTurn, testGame, hold, untilNextTurn, whileFlying } from './support/game';

const players = [
  { name: 'Boyz', colour: '#f87171', characterId: 'shotdownboyz' },
  { name: 'Kie', colour: '#4ea8ff', characterId: 'kie' },
];

function match(heights?: (x: number) => number): GameState {
  return testGame({ seed: 50, players, heights, xs: [300, 800] });
}

describe("ShotDownBoyz's beta movement", () => {
  it('activates the digger once per turn without spending its bonus slot', () => {
    const g = match();
    const p = currentPlayer(g);
    expect(selectTier(g, 3)).toBe(true);
    expect(fire(g)).toBe(true);
    expect(p.diggerActive).toBe(true);
    expect(p.ammo[3]).toBe(1);
    expect(selectTier(g, 3)).toBe(false);

    passTurn(g);
    expect(p.diggerActive).toBe(false);
    passTurn(g);
    expect(currentPlayer(g)).toBe(p);
    expect(selectTier(g, 3)).toBe(true);
  });

  it('drives horizontally through hills, carving a tunnel, but still stops at another tank', () => {
    const g = match((x) => (x >= 330 ? 350 : 400));
    const p = currentPlayer(g);
    expect(selectTier(g, 3)).toBe(true);
    fire(g);
    hold(g, 1, 2);
    expect(p.x).toBeGreaterThan(350);
    expect(p.y).toBe(400);
    expect(g.terrain.isSolid(360, 390)).toBe(false);
    expect(g.terrain.isSolid(360, 380)).toBe(true);
    expect(p.diggerFacing).toBe(1);
    expect(g.sfx.some((e) => e.cue === 'digger')).toBe(true);

    hold(g, -1, 0.2);
    expect(p.diggerFacing).toBe(-1);

    const blocked = match();
    const digger = currentPlayer(blocked);
    blocked.players[1]!.x = 340;
    expect(selectTier(blocked, 3)).toBe(true);
    fire(blocked);
    hold(blocked, 1, 2);
    expect(blocked.players[1]!.x - digger.x).toBeGreaterThanOrEqual(22);
    expect(blocked.players[1]!.x - digger.x).toBeLessThan(23);
    expect(blocked.sfx.some((e) => e.cue === 'digger')).toBe(true);
  });

  it('lays a flat bed of dirt under itself over air, and levels its tunnel floor', () => {
    // A cliff edge at 330, a drop to 500 beyond it, and a hill at 420 to tunnel through.
    const g = match((x) => (x < 330 ? 400 : x < 420 ? 500 : 350));
    const p = currentPlayer(g);
    selectTier(g, 3);
    fire(g);
    hold(g, 1, 6);
    expect(p.x).toBeGreaterThan(440);
    expect(p.y).toBe(400);
    for (const x of [340, 370, 400, 430]) {
      expect(g.terrain.groundBelow(x, 390)).toBe(400); // flat, at the hull's base (in the tunnel too)
      expect(g.terrain.isSolid(x, 450)).toBe(true); // filled right down to the old ground
    }
    expect(g.terrain.isSolid(430, 395)).toBe(false); // the tunnel's still open above it
    expect(g.fx.splashes.some((sp) => sp.opaque)).toBe(true); // clods of dirt kicked out

    // Tanks settling at the end of the turn don't fall: he's on solid ground.
    passTurn(g);
    expect(p.y).toBe(400);
  });

  it("doesn't bury a tank below its bridge", () => {
    const g = match((x) => (x < 330 ? 400 : 500));
    const p = currentPlayer(g);
    const below = g.players[1]!;
    below.x = 380;
    below.y = 500;
    selectTier(g, 3);
    fire(g);
    hold(g, 1, 4);
    expect(p.x).toBeGreaterThan(400);
    expect(g.terrain.isSolid(380, 470)).toBe(true); // the bridge, over its head
    expect(g.terrain.isSolid(380, 495)).toBe(false);
    expect(g.terrain.isSolid(380, 488)).toBe(false);
  });

  it('cannot drive while pinned', () => {
    const g = match();
    const p = currentPlayer(g);
    p.pinned = { active: true };
    selectTier(g, 3);
    fire(g);
    const x = p.x;
    hold(g, 1, 1);
    expect(canMove(p)).toBe(false);
    expect(p.x).toBe(x);
    expect(g.sfx.some((e) => e.cue === 'digger')).toBe(false);
  });

  it('refills one empty fuel tank at the start of the next turn from his one jerry can', () => {
    const g = match();
    const p = currentPlayer(g);
    p.fuel = DRIVE_SPEED * 0.2;
    selectTier(g, 3);
    fire(g);
    hold(g, 1, 1);
    expect(p.fuel).toBe(0);
    passTurn(g);
    passTurn(g);
    expect(currentPlayer(g)).toBe(p);
    expect(p.fuel).toBe(FUEL_PER_MATCH);
    expect(p.dieselCans).toBe(0);
    expect(p.dieselCanTime).toBeGreaterThan(0);

    p.fuel = 0;
    passTurn(g);
    passTurn(g);
    expect(p.fuel).toBe(0);
    expect(p.dieselCanTime).toBeCloseTo(2.4 - FIXED_DT * 2, 5);
  });
});

describe("ShotDownBoyz's Prepper", () => {
  /** Dig him in at x 300 on flat ground, the slit at `angle`, and let it build. */
  function bunkered(angle = 60): GameState {
    const g = match();
    const p = currentPlayer(g);
    p.angle = angle;
    expect(selectTier(g, 2)).toBe(true);
    expect(fire(g)).toBe(true);
    untilNextTurn(g);
    return g;
  }
  /** The pixel `r` px out from the pivot at `deg`. */
  const at = (g: GameState, deg: number, r: number) => {
    const b = g.players[0]!.bunker!;
    return [Math.floor(b.x + Math.cos((deg * Math.PI) / 180) * r), Math.floor(b.y - Math.sin((deg * Math.PI) / 180) * r)] as const;
  };
  /** Solid pixels within 32 px of the pivot. */
  const walls = (g: GameState) => {
    const b = g.players[0]!.bunker!;
    let n = 0;
    for (let y = b.y - 32; y <= b.y; y++) for (let x = b.x - 32; x <= b.x + 32; x++) if (Math.hypot(x - b.x, y - b.y) < 32 && g.terrain.isSolid(x, y)) n++;
    return n;
  };

  it('digs him 8 px in and builds brick walls round him, open in a 35° slit along his aim', () => {
    const g = bunkered(60);
    const p = g.players[0]!;
    expect(p.y).toBe(FLAT_Y + 8);
    expect(p.bunker).toMatchObject({ x: 300, y: FLAT_Y, slit: 60 });
    expect(p.bunker!.bricks).toBeGreaterThan(400);
    for (const deg of [10, 90, 120, 170]) expect(g.terrain.isSolid(...at(g, deg, 27))).toBe(true);
    for (const deg of [46, 60, 74]) expect(g.terrain.isSolid(...at(g, deg, 27))).toBe(false);
    expect(g.terrain.isSolid(...at(g, 120, 15))).toBe(false); // room inside for the barrel
    // Brick red, not soil.
    const [x, y] = at(g, 120, 27.5);
    const i = (y * g.terrain.width + x) * 4;
    expect(g.terrain.pixels[i]!).toBeGreaterThan(g.terrain.pixels[i + 1]! + 50);
  });

  it('boxes him in with its walls alone, and the Digger can tunnel him out', () => {
    const g = bunkered(60);
    const p = g.players[0]!;
    passTurn(g);
    expect(currentPlayer(g)).toBe(p);
    expect(canMove(p)).toBe(true); // no lock: it's the bricks
    for (const dir of [1, -1]) {
      hold(g, dir, 2);
      expect(Math.abs(p.x - 300)).toBeLessThan(22);
    }
    hold(g, 1, 0.1); // back to the middle-ish, then dig out to the right
    selectTier(g, 3);
    expect(fire(g)).toBe(true);
    hold(g, 1, 3);
    expect(p.x).toBeGreaterThan(300 + 31);
  });

  it('keeps the slit above the ground when he aims down', () => {
    expect(slitOf(300)).toBe(0);
    expect(slitOf(200)).toBe(180);
    expect(slitOf(135)).toBe(135);
  });

  it('lets a shot out through the slit, but stops one aimed at his own wall', () => {
    const g = bunkered(60);
    const p = g.players[0]!;
    const before = walls(g);
    passTurn(g);
    expect(currentPlayer(g)).toBe(p);
    Object.assign(p, { angle: 60, power: 70 });
    selectTier(g, 0);
    fire(g);
    whileFlying(g);
    expect(walls(g)).toBe(before);

    untilNextTurn(g);
    passTurn(g);
    p.angle = 150;
    selectTier(g, 0);
    fire(g);
    whileFlying(g);
    expect(walls(g)).toBeLessThan(before);
  });

  it('stands until most of it is knocked down', () => {
    const g = bunkered(60);
    const p = g.players[0]!;
    const b = p.bunker!;
    g.terrain.carveCircle(b.x - 25, b.y - 20, 8);
    passTurn(g);
    expect(p.bunker).not.toBeNull();
    g.terrain.carveCircle(b.x, b.y - 20, 30);
    passTurn(g);
    expect(p.bunker).toBeNull();
    expect(g.sfx.some((e) => e.cue === 'bunker-down')).toBe(true);
  });

  it('puts the brick colours back after the terrain is patched from another phone', () => {
    const g = bunkered(60);
    const [x, y] = at(g, 120, 27.5);
    const i = (y * g.terrain.width + x) * 4;
    const red = g.terrain.pixels[i];
    g.terrain.pixels[i] = 90;
    repaintBunkers(g);
    expect(g.terrain.pixels[i]).toBe(red);
  });
});

describe("ShotDownBoyz's Digger and the end of the match", () => {
  it('doesn’t keep him taking turns once his shots are spent: he sits out, and the match ends', () => {
    const g = match();
    const [boyz, kie] = g.players;
    boyz!.ammo = [0, 0, 0, 1];
    expect(hasAmmo(boyz!)).toBe(false);
    passTurn(g);
    expect(currentPlayer(g)).toBe(kie);
    kie!.ammo = kie!.ammo.map(() => 0);
    boyz!.hp = 40;
    passTurn(g);
    expect(g.phase).toBe('gameover');
    expect(g.winner).toBe(kie);
  });

  it('passes a turn left with nothing to fire (a match saved while the Digger kept him in)', () => {
    const g = match();
    const [boyz, kie] = g.players;
    expect(passEmptyTurn(g)).toBe(false);
    boyz!.ammo = [0, 0, 0, 1];
    const turn = g.turn;
    expect(passEmptyTurn(g)).toBe(true);
    expect(currentPlayer(g)).toBe(kie);
    expect(g.turn).toBe(turn + 1);
    expect(g.phase).toBe('aiming');
    // With nobody left with anything, it's over.
    kie!.ammo = kie!.ammo.map(() => 0);
    expect(passEmptyTurn(g)).toBe(true);
    expect(g.phase).toBe('gameover');
  });
});

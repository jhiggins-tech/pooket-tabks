import { describe, expect, it } from 'vitest';
import { FIXED_DT, MAX_HP } from '../src/game/constants';
import { createGame, currentPlayer, drive, finishDecoyPick, hologramsOf, selectTier, setAim, step, toggleSwapTarget } from '../src/game/game';
import type { GameState, PlayerConfig } from '../src/game/state';
import { NetSession } from '../src/net/session';
import { takeSnapshot } from '../src/net/snapshot';
import { loopback } from '../src/net/transport';

const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

async function connected(host = 'tones', guest = 'kie', first: number | 'random' = 0) {
  const [ta, tb] = loopback();
  const a = new NetSession(ta, 'host');
  const b = new NetSession(tb, 'guest');
  for (const s of [a, b]) s.onStart = (seed: number, players: PlayerConfig[]) => createGame({ seed, players, first });
  a.setPick({ name: 'A', characterId: host });
  b.setPick({ name: 'B', characterId: guest });
  await flush();
  expect(a.ready && b.ready).toBe(true);
  const players: PlayerConfig[] = [
    { name: 'A', characterId: host, colour: '#f00' },
    { name: 'B', characterId: guest, colour: '#00f' },
  ];
  a.start(1234, players);
  await flush();
  return { a, b, A: a.game!, B: b.game! };
}

/** Run both phones until the shot has played out and the next player can act (or game over). */
async function playOut(a: NetSession, b: NetSession, A: GameState, B: GameState, slowB = false) {
  for (let i = 0; i < 120 * 40; i++) {
    step(A, FIXED_DT);
    if (!slowB || i % 2 === 0) step(B, FIXED_DT);
    a.tick(FIXED_DT);
    b.tick(FIXED_DT);
    if (i % 8 === 0) await flush();
    const next = A.current === 0 ? a : b;
    if ((A.phase === 'gameover' && B.phase === 'gameover') || (next.canAct() && A.phase === 'aiming' && B.phase === 'aiming' && A.turn === B.turn && i > 10)) break;
  }
  await flush();
}

const same = (A: GameState, B: GameState) => {
  const strip = (s: GameState) => {
    const snap = takeSnapshot(s) as Record<string, unknown>;
    // Cosmetics are allowed to differ mid-way: the other phone snaps to the result as it was when the
    // shooter's turn ended, while the shooter's own animations kept going.
    delete snap.floaters;
    delete snap.shimmers;
    delete snap.ghosts;
    snap.holograms = (snap.holograms as Record<string, unknown>[]).map(({ age: _age, ...h }) => h);
    return snap;
  };
  expect(strip(B)).toEqual(strip(A));
  expect(B.terrain.solid).toEqual(A.terrain.solid);
};

describe('networked match', { timeout: 30_000 }, () => {
  it('both phones start from the same game, host first', async () => {
    const { a, b, A, B } = await connected();
    same(A, B);
    expect(a.canAct()).toBe(true);
    expect(b.canAct()).toBe(false);
  });

  it('the guest can go first: then only the guest can fire, and both stay identical', async () => {
    const { a, b, A, B } = await connected('tones', 'kie', 1);
    expect(a.canAct()).toBe(false);
    expect(b.canAct()).toBe(true);
    expect(a.fire()).toBe(false);
    setAim(B, 120, 60);
    expect(b.fire()).toBe(true);
    await playOut(a, b, A, B);
    same(A, B);
    expect(a.canAct()).toBe(true);
  });

  it('streams the aim and driving to the other phone, but not the secret decoy pick', async () => {
    const { a, A, B } = await connected();
    setAim(A, 70, 33);
    selectTier(A, 1);
    for (let t = 0; t < 0.7; t += FIXED_DT) {
      if (t < 0.5) drive(A, 1, FIXED_DT); // then lets go, and the last position goes out too
      a.tick(FIXED_DT);
    }
    await flush();
    const [pa, pb] = [currentPlayer(A), currentPlayer(B)];
    expect({ x: pb.x, angle: pb.angle, power: pb.power, tier: pb.selectedTier, fuel: pb.fuel }).toEqual({ x: pa.x, angle: pa.angle, power: pa.power, tier: pa.selectedTier, fuel: pa.fuel });
    expect(B.swapTargetId).toBeNull();
  });

  it('a decoy picked on the casting turn stays secret until the result, then both phones agree', async () => {
    const { a, b, A, B } = await connected('kie', 'tones');
    selectTier(A, 1); // Trollogram
    expect(a.fire()).toBe(true);
    await flush();
    const target = hologramsOf(A, 0)[0]!;
    const spot = target.x;
    toggleSwapTarget(A, target.id);
    for (let i = 0; i < 60; i++) {
      step(A, FIXED_DT);
      step(B, FIXED_DT);
    }
    finishDecoyPick(A);
    expect(B.swapTargetId).toBeNull();
    await playOut(a, b, A, B);
    same(A, B);
    expect(B.players[0]!.x).toBe(spot);
  });

  it('never sends the secret swap target with a shot', async () => {
    const { a, b, A, B } = await connected('kie', 'tones');
    selectTier(A, 1);
    a.fire();
    await playOut(a, b, A, B);
    selectTier(B, 0);
    setAim(B, 90, 10); // straight up, well away from the decoys
    b.fire();
    await playOut(a, b, A, B);
    toggleSwapTarget(A, hologramsOf(A, 0)[0]!.id);
    expect(A.swapTargetId).not.toBeNull();
    a.fire();
    await flush();
    expect(B.swapTargetId).toBeNull();
    await playOut(a, b, A, B);
    same(A, B);
  });

  it('only the phone whose turn it is can fire; turns alternate and both stay identical', async () => {
    const { a, b, A, B } = await connected();
    expect(b.fire()).toBe(false);
    for (let turn = 0; turn < 4; turn++) {
      const [me, S] = A.current === 0 ? [a, A] : [b, B];
      setAim(S, S.current === 0 ? 60 : 120, 55 + turn * 5);
      expect(me.fire()).toBe(true);
      await playOut(a, b, A, B);
      same(A, B);
      expect(A.turn).toBe(turn + 2);
    }
  });

  it("the shooter's result wins: drift on the other phone is corrected at the end of the turn", async () => {
    const { a, b, A, B } = await connected();
    setAim(A, 55, 62);
    a.fire();
    await flush();
    for (let i = 0; i < 30; i++) step(B, FIXED_DT);
    // Something rounds differently on B: a stray crater and different health.
    B.terrain.carveCircle(500, 300, 30);
    B.players[1]!.hp = 7;
    await playOut(a, b, A, B);
    same(A, B);
    expect(B.players[1]!.hp).toBe(A.players[1]!.hp);
    expect(A.players[1]!.hp).toBeGreaterThan(7);
  });

  it("a slower phone finishes its animation before snapping to the result, and can't act until then", async () => {
    const { a, b, A, B } = await connected();
    setAim(A, 60, 60);
    a.fire();
    await playOut(a, b, A, B, true);
    same(A, B);
    expect(b.canAct()).toBe(true);
  });

  it("kie's Steal plays out the same on both phones", async () => {
    const { a, b, A, B } = await connected('kie', 'tones');
    selectTier(A, 2);
    a.fire();
    for (let i = 0; i < 120 * 6; i++) {
      step(A, FIXED_DT);
      step(B, FIXED_DT);
      a.tick(FIXED_DT);
      b.tick(FIXED_DT);
      if (i % 8 === 0) await flush();
    }
    expect(A.phase).toBe('aiming');
    expect(A.current).toBe(0); // still kie's turn
    expect(B.players[0]!.loadout[2]).toBe(A.players[0]!.loadout[2]);
    expect(B.players[1]!.ammo).toEqual(A.players[1]!.ammo);
    expect(a.canAct()).toBe(true);
  });

  it('plays a whole match to the end in sync', async () => {
    const { a, b, A, B } = await connected();
    A.players[1]!.hp = 5; // one good hit ends it
    B.players[1]!.hp = 5;
    let guard = 0;
    while (A.phase !== 'gameover' && guard++ < 12) {
      const [me, S] = A.current === 0 ? [a, A] : [b, B];
      const target = S.players[1 - S.current]!;
      const shooter = currentPlayer(S);
      // Lob roughly at the other tank.
      const dx = target.x - shooter.x;
      setAim(S, dx > 0 ? 45 : 135, Math.min(100, Math.sqrt(Math.abs(dx) * 400) / 7.2));
      me.fire();
      await playOut(a, b, A, B);
    }
    expect(A.phase).toBe('gameover');
    expect(B.phase).toBe('gameover');
    expect(B.winner?.name).toBe(A.winner?.name);
    expect(A.players.some((p) => p.hp < MAX_HP)).toBe(true);
  });

  it('notices when the other phone leaves', async () => {
    const { a, b } = await connected();
    let lost = false;
    b.onLost = () => (lost = true);
    a.leave();
    await flush();
    expect(lost).toBe(true);
    expect(b.canAct()).toBe(false);
  });
});

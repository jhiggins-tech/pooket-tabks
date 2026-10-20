import { describe, expect, it } from 'vitest';
import { FIXED_DT, MAX_HP } from '../src/game/constants';
import { createGame, currentPlayer, drive, finishDecoyPick, hologramsOf, selectTier, setAim, step, toggleSwapTarget } from '../src/game/game';
import type { GameState, PlayerConfig } from '../src/game/state';
import type { GameRecord } from '../src/net/record';
import { NetSession } from '../src/net/session';
import { RULES, WIRE } from '../src/net/version';
import { connectedPair, expectSameMatch, phone } from './support/net';
import { flush } from './support/wait';

const onStart = (seed: number, players: PlayerConfig[], first: number) => createGame({ seed, players, first });

/** A match between the host (`host`'s character) and the guest (`guest`'s), who joined and has the first go. */
function connected(host = 'tones', guest = 'kie') {
  const players: PlayerConfig[] = [
    { name: 'A', characterId: host, colour: '#f00' },
    { name: 'B', characterId: guest, colour: '#00f' },
  ];
  return connectedPair({ seed: 1234, players, onStart });
}

/** Run both phones until the shot has played out and the next player can act (or game over). */
async function playOut(a: NetSession, b: NetSession, A: GameState, B: GameState, slowA = false) {
  for (let i = 0; i < 120 * 40; i++) {
    if (!slowA || i % 2 === 0) step(A, FIXED_DT);
    step(B, FIXED_DT);
    a.tick(FIXED_DT);
    b.tick(FIXED_DT);
    if (i % 8 === 0) await flush();
    const next = B.current === 0 ? a : b;
    if ((A.phase === 'gameover' && B.phase === 'gameover') || (next.canAct() && A.phase === 'aiming' && B.phase === 'aiming' && A.turn === B.turn && i > 10)) break;
  }
  await flush();
}

// Holograms' ages may differ mid-way: the other phone snaps to the result as it was when the shooter's
// turn ended, while the shooter's own animations kept going.
const same = (A: GameState, B: GameState) => expectSameMatch(A, B, { ignoreHologramAge: true });

describe('networked match', { timeout: 30_000 }, () => {
  it('the guest starts the match as it joins, and has the first go; the host opens the same game', async () => {
    const { a, b, A, B, room } = await connected();
    same(A, B);
    expect(B.current).toBe(1);
    expect(b.canAct()).toBe(true);
    expect(a.canAct()).toBe(false);
    expect(a.fire()).toBe(false);
    expect(room.rec).toMatchObject({ v: WIRE, rules: RULES, n: 1, fired: 0, moves: [], flying: null, setup: { seed: 1234, first: 1 } });
    expect([a.localPick?.name, a.remotePick?.name, b.localPick?.name, b.remotePick?.name]).toEqual(['A', 'B', 'B', 'A']);
  });

  it('the guest fires, the host watches it play out and snaps to its result; then it is the host’s go', async () => {
    const { a, b, A, B } = await connected();
    setAim(B, 120, 60);
    expect(b.fire()).toBe(true);
    await flush();
    expect(A.phase).not.toBe('aiming'); // playing it out
    await playOut(a, b, A, B);
    same(A, B);
    expect(a.canAct()).toBe(true);
    expect(b.canAct()).toBe(false);
  });

  it('streams the aim and driving to the other phone, but not the secret decoy pick', async () => {
    const { b, A, B } = await connected();
    setAim(B, 110, 33);
    selectTier(B, 1);
    for (let t = 0; t < 0.7; t += FIXED_DT) {
      if (t < 0.5) drive(B, -1, FIXED_DT); // then lets go, and the last position goes out too
      b.tick(FIXED_DT);
    }
    await flush();
    const [pa, pb] = [currentPlayer(A), currentPlayer(B)];
    expect({ x: pa.x, angle: pa.angle, power: pa.power, tier: pa.selectedTier, fuel: pa.fuel }).toEqual({ x: pb.x, angle: pb.angle, power: pb.power, tier: pb.selectedTier, fuel: pb.fuel });
    expect(A.swapTargetId).toBeNull();
  });

  it('a decoy picked on the casting turn stays secret until the result, then both phones agree', async () => {
    const { a, b, A, B } = await connected('tones', 'kie');
    selectTier(B, 1); // Trollogram
    expect(b.fire()).toBe(true);
    await flush();
    const target = hologramsOf(B, 1)[0]!;
    const spot = target.x;
    toggleSwapTarget(B, target.id);
    for (let i = 0; i < 60; i++) {
      step(A, FIXED_DT);
      step(B, FIXED_DT);
    }
    finishDecoyPick(B);
    expect(A.swapTargetId).toBeNull();
    await playOut(a, b, A, B);
    same(A, B);
    expect(A.players[1]!.x).toBe(spot);
  });

  it('a bonus move (Women in Scam) reaches the other phone, and the turn carries on to the real shot', async () => {
    const { a, b, A, B } = await connected('kie', 'larinovsky');
    selectTier(B, 3);
    expect(b.fire()).toBe(true);
    await playOut(a, b, A, B);
    expect(B.phase).toBe('aiming');
    expect(A.players[1]!.scam).toEqual({ loot: null });
    expect(A.players[1]!.ammo[3]).toBe(0);
    expect(b.canAct()).toBe(true);
    expect(a.canAct()).toBe(false);
    setAim(B, 90, 10);
    expect(b.fire()).toBe(true);
    await playOut(a, b, A, B);
    same(A, B);
    expect(a.canAct()).toBe(true);
    expect(A.players[1]!.scam).not.toBeNull();
  });

  it('never puts the secret swap target in the record with a shot', async () => {
    const { a, b, A, B, room } = await connected('tones', 'kie');
    selectTier(B, 1);
    b.fire();
    await playOut(a, b, A, B);
    selectTier(A, 0);
    setAim(A, 90, 10); // straight up, well away from the decoys
    a.fire();
    await playOut(a, b, A, B);
    toggleSwapTarget(B, hologramsOf(B, 1)[0]!.id);
    expect(B.swapTargetId).not.toBeNull();
    b.fire();
    await flush();
    expect(room.rec!.flying!.snap.swapTargetId).toBeNull();
    expect(room.rec!.snap.swapTargetId).toBeNull();
    expect(A.swapTargetId).toBeNull();
    await playOut(a, b, A, B);
    same(A, B);
  });

  it('only the phone whose turn it is can fire; turns alternate and both stay identical', async () => {
    const { a, b, A, B } = await connected();
    expect(a.fire()).toBe(false);
    for (let turn = 0; turn < 4; turn++) {
      const [me, S] = B.current === 1 ? [b, B] : [a, A];
      setAim(S, S.current === 0 ? 60 : 120, 55 + turn * 5);
      expect(me.fire()).toBe(true);
      await playOut(a, b, A, B);
      same(A, B);
      expect(A.turn).toBe(turn + 2);
    }
  });

  it("the shooter's result wins: drift on the other phone is corrected at the end of the turn", async () => {
    const { a, b, A, B } = await connected();
    setAim(B, 125, 62);
    b.fire();
    await flush();
    for (let i = 0; i < 30; i++) step(A, FIXED_DT);
    // Something rounds differently on A: a stray crater and different health.
    A.terrain.carveCircle(500, 300, 30);
    A.players[0]!.hp = 7;
    await playOut(a, b, A, B);
    same(A, B);
    expect(A.players[0]!.hp).toBe(B.players[0]!.hp);
    expect(B.players[0]!.hp).toBeGreaterThan(7);
  });

  it("a slower phone finishes its animation before snapping to the result, and can't act until then", async () => {
    const { a, b, A, B } = await connected();
    setAim(B, 120, 60);
    b.fire();
    await playOut(a, b, A, B, true);
    same(A, B);
    expect(a.canAct()).toBe(true);
  });

  it("kie's Steal plays out the same on both phones", async () => {
    const { a, b, A, B } = await connected('tones', 'kie');
    selectTier(B, 2);
    b.fire();
    for (let i = 0; i < 120 * 6; i++) {
      step(A, FIXED_DT);
      step(B, FIXED_DT);
      a.tick(FIXED_DT);
      b.tick(FIXED_DT);
      if (i % 8 === 0) await flush();
    }
    expect(B.phase).toBe('aiming');
    expect(B.current).toBe(1); // still kie's turn
    expect(A.players[1]!.loadout[2]).toBe(B.players[1]!.loadout[2]);
    expect(A.players[0]!.ammo).toEqual(B.players[0]!.ammo);
    expect(b.canAct()).toBe(true);
  });

  it('plays a whole match to the end in sync', async () => {
    const { a, b, A, B } = await connected();
    A.players[0]!.hp = 5; // one good hit ends it
    B.players[0]!.hp = 5;
    let guard = 0;
    while (B.phase !== 'gameover' && guard++ < 12) {
      const [me, S] = B.current === 1 ? [b, B] : [a, A];
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
    expect(A.winner?.name).toBe(B.winner?.name);
    expect(B.players.some((p) => p.hp < MAX_HP)).toBe(true);
  });

  it('a record from a newer version: this phone is told to reload (and stops following), the room as it is', async () => {
    const { a, room } = await connected();
    let outdated: string | null = null;
    a.on('outdated', (w) => (outdated = w));
    room.put({ ...room.rec!, n: room.rec!.n + 1, by: 'newer-phone', rules: RULES + 1 } as GameRecord);
    await flush();
    expect(outdated).toBe('us');
    expect(a.ended).toBe(true);
    expect(room.rec!.rules).toBe(RULES + 1); // nothing written over it
  });

  it('away: this phone is out of the match (nothing written or taken in), but the game stays to look at', async () => {
    const { a, b, A } = await connected();
    expect(a.peerAway).toBe(false);
    b.away();
    await flush();
    expect(a.peerAway).toBe(true);
    expect(b.ended).toBe(true);
    expect(b.game).not.toBeNull();
    expect(b.canAct()).toBe(false);
    expect(b.fire()).toBe(false);
    void A;
  });

  it('the other player coming back is noticed (the live dot)', async () => {
    const { a, b, room } = await connected();
    const seen: boolean[] = [];
    a.on('peerAway', (away) => seen.push(away));
    b.away();
    await flush();
    const back = phone(room, 'guest', onStart);
    back.open(room.rec!, b.seen);
    await flush();
    expect(seen).toEqual([true, false]);
  });

  it('two phones racing to record a result: only one counts, and the other takes it', async () => {
    const { a, b, A, B, room } = await connected();
    setAim(B, 120, 60);
    b.fire();
    await flush();
    // The host thinks the guest has gone (it hasn't): both record the shot's result.
    a.peerAway = true;
    await playOut(a, b, A, B);
    same(A, B);
    expect(room.rec!.flying).toBeNull();
    expect(room.rec!.moves.map((m) => m.seq)).toEqual([1]);
    expect(a.canAct()).toBe(true);
  });
});

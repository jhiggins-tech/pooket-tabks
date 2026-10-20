import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/game/constants';
import { createGame, setAim, step } from '../src/game/game';
import type { PlayerConfig } from '../src/game/state';
import { memoryRoom } from '../src/net/channel';
import { FORFEIT_MS, forfeitDue, gameStatus, opponentName, type GameRecord, type StoredGame } from '../src/net/record';
import { OLDEST_RULES, RULES, WIRE } from '../src/net/version';
import { connectedPair, expectSameMatch, phone, runPhones, type MemoryRoom } from './support/net';
import { flush, settled } from './support/wait';

const PLAYERS: PlayerConfig[] = [
  { name: 'A', characterId: 'tones', colour: '#f00' },
  { name: 'B', characterId: 'kcaj', colour: '#00f' },
];
const onStart = (seed: number, players: PlayerConfig[], first: number) => createGame({ seed, players, first });

const connected = () => connectedPair({ seed: 4321, players: PLAYERS, onStart });

/** A phone opening the match later (`seen`: the newest move it saw played out last time). */
function opens(room: MemoryRoom, role: 'host' | 'guest', seen?: number) {
  const s = phone(room, role, onStart);
  s.open(room.rec!, seen);
  return s;
}

describe('the game record', () => {
  it('is written when the match starts, when a move is fired and when it has played out', async () => {
    const { a, b, B, room } = await connected();
    expect(room.rec).toMatchObject({ v: WIRE, rules: RULES, n: 1, setup: { seed: 4321, rules: RULES, first: 1 }, fired: 0, moves: [], flying: null });
    expect(room.rec!.snap.turn).toBe(1);
    setAim(B, 120, 40);
    b.fire();
    expect(room.rec).toMatchObject({ n: 2, fired: 1, flying: { turn: 1, owner: 1, seq: 1 } });
    await runPhones([a, b], settled(b, 2));
    await flush();
    expect(room.rec).toMatchObject({ n: 3, fired: 1, flying: null });
    expect(room.rec!.moves.map((m) => [m.seq, m.owner])).toEqual([[1, 1]]);
    expect(room.rec!.snap).toMatchObject({ turn: 2, current: 0, phase: 'aiming' });
  });

  it("the guest takes the first go with the host away; the host opens the game later, watches it, and takes theirs", async () => {
    const room = memoryRoom();
    const guest = phone(room, 'guest', onStart);
    guest.start(99, PLAYERS);
    await flush();
    expect(guest.peerAway).toBe(true); // the host isn't here
    const G = guest.game!;
    setAim(G, 120, 40);
    expect(guest.fire()).toBe(true);
    await runPhones([guest], settled(guest, 2));
    await flush();
    guest.away();

    // Later: the host opens it (never seen a move): the guest's go again, then its own.
    const host = opens(room, 'host');
    expect(host.replaying).toBe(true);
    expect(host.canAct()).toBe(false);
    await runPhones([host], () => host.game!.phase !== 'aiming', { seconds: 3 }); // the aim shown, then it's fired
    expect(host.canAct()).toBe(false);
    await runPhones([host], () => host.canAct());
    expect(host.replaying).toBe(false);
    expectSameMatch(G, host.game!); // as the guest left it
    expect(host.remotePick).toEqual({ name: 'B', characterId: 'kcaj' });
    expect(host.seen).toBe(1);

    // Its go, recorded for the guest to find.
    setAim(host.game!, 60, 40);
    expect(host.fire()).toBe(true);
    await runPhones([host], settled(host, 3));
    await flush();
    expect(room.rec!.snap.turn).toBe(3);
    expect(room.rec!.moves.map((m) => [m.seq, m.owner])).toEqual([[2, 0]]);
  });

  it('a phone that has seen their move already (it was there) isn’t shown it again', async () => {
    const { a, b, B, room } = await connected();
    setAim(B, 120, 40);
    b.fire();
    await runPhones([a, b], () => a.canAct());
    const seen = a.seen;
    expect(seen).toBe(1);
    a.away();
    const back = opens(room, 'host', seen);
    expect(back.replaying).toBe(false);
    expect(back.canAct()).toBe(true);
    expectSameMatch(B, back.game!);
  });

  it('every move they made since this phone last looked is replayed, in order (an extra turn, say)', async () => {
    const { a, b, B, room } = await connected();
    a.away();
    // The guest's go, then (as if an extra turn) another.
    setAim(B, 120, 40);
    b.fire();
    await runPhones([b], settled(b, 2));
    B.current = 1; // (its turn again)
    setAim(B, 110, 50);
    expect(b.fire()).toBe(true);
    await runPhones([b], settled(b, 3));
    await flush();
    expect(room.rec!.moves.map((m) => m.seq)).toEqual([1, 2]);
    const shots: number[] = [];
    const back = phone(room, 'host', onStart);
    back.on('shot', (s) => shots.push(s.seq));
    back.open(room.rec!, 0);
    await runPhones([back], () => back.canAct() || (!back.replaying && back.game!.phase === 'aiming'));
    expect(shots).toEqual([1, 2]);
    expectSameMatch(B, back.game!);
  });

  it('Skip jumps straight to how things stand', async () => {
    const { a, b, B, room } = await connected();
    a.away();
    setAim(B, 120, 40);
    b.fire();
    await runPhones([b], settled(b, 2));
    await flush();
    const back = opens(room, 'host');
    expect(back.replaying).toBe(true);
    back.skip();
    expect(back.replaying).toBe(false);
    expect(back.canAct()).toBe(true);
    expectSameMatch(B, back.game!);
  });

  it("with both phones there, the other player's move plays out live, then the turn's theirs to take", async () => {
    const { a, b, A, B } = await connected();
    setAim(B, 120, 40);
    b.fire();
    await flush();
    expect(a.replaying).toBe(false); // watched as it happens, not caught up on
    expect(A.phase).not.toBe('aiming');
    await runPhones([a, b], () => a.canAct());
    expectSameMatch(A, B);
  });

  it("a phone that vanished mid-shot doesn't undo it: whoever opens the game next plays it out and records the result", async () => {
    const { a, b, B, room } = await connected();
    a.away();
    setAim(B, 120, 40);
    b.fire();
    for (let i = 0; i < 20; i++) step(B, FIXED_DT);
    b.away(); // gone mid-shot
    expect(room.rec!.flying).toMatchObject({ turn: 1, owner: 1, seq: 1 });

    const back = opens(room, 'host');
    await runPhones([back], () => back.canAct());
    await flush();
    expect(back.game!.turn).toBe(2);
    expect(room.rec!.flying).toBeNull();
    expect(room.rec!.snap.turn).toBe(2);
    expect(room.rec!.moves.map((m) => [m.seq, m.owner])).toEqual([[1, 1]]);
  });

  it('the shooter coming back to its own shot in flight plays it out and records it too', async () => {
    const { a, b, B, room } = await connected();
    a.away();
    setAim(B, 120, 40);
    b.fire();
    b.away();
    const back = opens(room, 'guest', 1);
    await runPhones([back], settled(back, 2));
    await runPhones([back], () => room.rec!.snap.turn === 2, { seconds: 1 });
    expect(back.canAct()).toBe(false); // the host's turn now
    expect(room.rec!.flying).toBeNull();
  });

  it('opened on a second phone while the first is still in it: both follow the record and stay in step', async () => {
    const { a, b, A, B, room } = await connected();
    a.away();
    const a2 = opens(room, 'host', a.seen);
    await flush();
    setAim(B, 120, 40);
    b.fire();
    await runPhones([a2, b], () => a2.canAct());
    expectSameMatch(a2.game!, B);
    void A;
  });

  it('resigning ends it for both, and the record says so', async () => {
    const { a, b, room } = await connected();
    a.resign();
    await flush();
    for (const s of [a, b]) {
      expect(s.game!.phase).toBe('gameover');
      expect(s.game!.winner?.name).toBe('B');
      expect(s.game!.endReason).toBe('resigned');
    }
    expect(room.rec!.snap).toMatchObject({ phase: 'gameover', winner: 1, endReason: 'resigned' });
  });

  it("three days without a move: whoever's turn it is forfeits", async () => {
    const { a, b, room } = await connected();
    a.away();
    b.away();
    const g: StoredGame = { rec: room.rec!, ts: Date.now() - FORFEIT_MS - 1 };
    expect(forfeitDue(g)).toBe(true);
    expect(forfeitDue({ ...g, ts: Date.now() - FORFEIT_MS + 60_000 })).toBe(false);
    const back = opens(room, 'host');
    back.forfeit();
    expect(back.game!.phase).toBe('gameover');
    expect(back.game!.winner?.name).toBe('A'); // it was B's turn
    expect(back.game!.endReason).toBe('timeout');
    await flush();
    expect(room.rec!.snap).toMatchObject({ phase: 'gameover', winner: 0 });
  });

  it('says how each game stands, for the My games list', async () => {
    const { a, room } = await connected();
    const g = (): StoredGame => ({ rec: room.rec!, ts: Date.now() });
    expect(gameStatus(g(), 1)).toBe('your-turn');
    expect(gameStatus(g(), 0)).toBe('their-turn');
    expect(opponentName(g(), 0)).toBe('B');
    expect(opponentName(g(), 1)).toBe('A');
    expect(gameStatus({ ...g(), ts: Date.now() - FORFEIT_MS - 1 }, 1)).toBe('lost');
    expect(gameStatus({ ...g(), ts: Date.now() - FORFEIT_MS - 1 }, 0)).toBe('won');
    a.resign();
    await flush();
    expect(gameStatus(g(), 0)).toBe('lost');
    expect(gameStatus(g(), 1)).toBe('won');
  });

  it('a match carries on across rules changes it can survive; one from a newer build needs a reload', async () => {
    const { room } = await connected();
    const g = (rec: Partial<GameRecord>, setupRules = room.rec!.setup.rules): StoredGame => ({
      rec: { ...room.rec!, ...rec, setup: { ...room.rec!.setup, rules: setupRules } },
      ts: Date.now(),
    });
    expect(gameStatus(g({}), 1)).toBe('your-turn');
    // Started on rules this build still carries on (a balance tweak since): fine.
    expect(gameStatus(g({}, OLDEST_RULES), 1)).toBe('your-turn');
    // Started before the oldest rules this build can carry on, or stored in an older wire format: over.
    expect(gameStatus(g({}, OLDEST_RULES - 1), 1)).toBe('old');
    expect(gameStatus(g({ v: WIRE - 1 }), 1)).toBe('old');
    // Last played on a newer build (or stored in a newer format): this phone should reload first.
    expect(gameStatus(g({ rules: RULES + 1 }), 1)).toBe('newer');
    expect(gameStatus(g({ v: WIRE + 1 }), 1)).toBe('newer');
  });
});

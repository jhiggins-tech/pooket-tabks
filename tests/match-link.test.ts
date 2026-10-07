import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { concede, createGame } from '../src/game/game';
import type { PlayerConfig } from '../src/game/state';
import type { Listing } from '../src/net/lobby';
import { HostedRoom, joinRoom, rejoinRoom } from '../src/net/rooms';
import { Rtdb } from '../src/net/rtdb';
import { findSeat } from '../src/net/seat';
import { NetSession } from '../src/net/session';
import { loopback } from '../src/net/transport';
import { leaving, MatchLink, MatchSlot, type MatchEnd } from '../src/ui/online/match';
import { startRtdb } from './support/rtdb';
import { flush, until } from './support/wait';

/** Node has no localStorage: a minimal one (seats, and this phone's device id). */
const storage = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) },
});
beforeEach(() => storage.clear());

const PLAYERS: PlayerConfig[] = [
  { name: 'H', characterId: 'kcaj', colour: '#fc0' },
  { name: 'G', characterId: 'tones', colour: '#f55' },
];
const onStart = (seed: number, players: PlayerConfig[]) => createGame({ seed, players });
const pick = () => ({ name: 'H', characterId: 'kcaj' });

/** This phone's match (as host, room FROG) over a loopback, and the other phone's session. */
async function linked(where: 'lobby' | 'match' | 'over' | 'rejoining', slot?: MatchSlot) {
  const [a, b] = loopback();
  const seat = { code: 'FROG', role: 'host' as const, id: 'h' };
  const link = slot ? slot.open(a, seat, { lobby: 'test', pick }) : new MatchLink(a, seat, { lobby: 'test', pick });
  const them = new NetSession(b, 'guest');
  for (const s of [link.session, them]) s.onStart = onStart;
  const lost = vi.fn();
  them.on('lost', lost);
  link.session.setPick(pick());
  them.setPick({ name: 'G', characterId: 'tones' });
  await flush();
  if (where === 'rejoining') {
    link.session.rejoin(); // (and not caught up yet)
    return { link, them, lost };
  }
  if (where === 'match' || where === 'over') link.session.start(7, PLAYERS);
  if (where === 'over') concede(link.session.game!, 1, 'resigned');
  await flush();
  return { link, them, lost };
}

describe('MatchLink: one match on this phone, and how it ends', () => {
  it('leaving it from the menu: by where it is', async () => {
    expect(leaving((await linked('lobby')).link.session)).toBe('leave');
    expect(leaving((await linked('match')).link.session)).toBe('left');
    expect(leaving((await linked('over')).link.session)).toBe('done');
    expect(leaving((await linked('rejoining')).link.session)).toBe('away');
  });

  const cases: [where: Parameters<typeof linked>[0], how: MatchEnd, seat: 'kept' | 'left' | 'left-seen' | 'forgotten', heard: 'away' | 'bye' | 'nothing'][] = [
    ['rejoining', 'away', 'kept', 'away'],
    ['match', 'away', 'kept', 'away'],
    ['match', 'left', 'left-seen', 'away'],
    ['over', 'done', 'forgotten', 'away'],
    ['lobby', 'leave', 'forgotten', 'bye'],
    ['match', 'stand-down', 'left', 'nothing'],
  ];
  for (const [where, how, seat, heard] of cases) {
    it(`${how} (${where}): the seat ${seat}, the other phone hears ${heard}`, async () => {
      const { link, them, lost } = await linked(where);
      expect(findSeat('FROG')).toMatchObject({ role: 'host', id: 'h', left: false });
      const listing = { stop: vi.fn() };
      link.listing = listing as unknown as Listing;
      link.end(how);
      link.end('leave'); // (once)
      await flush();
      expect(link.ended && link.session.ended).toBe(true);
      expect(listing.stop).toHaveBeenCalledOnce();
      const s = findSeat('FROG');
      if (seat === 'forgotten') expect(s).toBeNull();
      else expect(s).toMatchObject({ left: seat !== 'kept', ...(seat === 'left-seen' ? { seen: link.session.game!.turn } : {}) });
      expect(seat === 'left' ? s?.seen : undefined).toBeUndefined();
      expect(them.peerAway).toBe(heard === 'away');
      expect(lost).toHaveBeenCalledTimes(heard === 'bye' ? 1 : 0);
    });
  }

  it('lost (the session ended by itself): the seat forgotten, the listing stopped', async () => {
    const { link, them } = await linked('lobby');
    const listing = { stop: vi.fn() };
    link.listing = listing as unknown as Listing;
    them.leave();
    await flush();
    expect(link.session.ended).toBe(true);
    link.end('lost');
    expect(findSeat('FROG')).toBeNull();
    expect(listing.stop).toHaveBeenCalledOnce();
  });

  it('drop (a guest who went quiet in the lobby): lets the pipe go, keeps the seat and the listing', async () => {
    const { link, them } = await linked('lobby');
    const listing = { stop: vi.fn() };
    link.listing = listing as unknown as Listing;
    link.end('drop');
    link.session.setPick({ name: 'H2', characterId: 'kcaj' });
    await flush();
    expect(them.remotePick?.name).toBe('H'); // nothing more goes out
    expect(link.session.ended).toBe(false);
    expect(listing.stop).not.toHaveBeenCalled();
    expect(link.listing).toBeNull();
    expect(findSeat('FROG')).toMatchObject({ left: false });
  });

  it('stops checking in on its seat once it has ended', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      const { link } = await linked('match');
      const ts = () => findSeat('FROG')!.ts;
      const t0 = ts();
      vi.advanceTimersByTime(20_000);
      expect(ts()).toBeGreaterThan(t0);
      link.end('away');
      const t1 = ts();
      vi.advanceTimersByTime(60_000);
      expect(ts()).toBe(t1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opening another match ends the one before, as if left from the menu', async () => {
    const slot = new MatchSlot();
    const first = await linked('match', slot);
    expect(slot.link).toBe(first.link);
    const second = await linked('lobby', slot);
    expect(first.link.ended && first.link.session.ended).toBe(true);
    expect(first.them.peerAway).toBe(true); // (it went away)
    expect(slot.link).toBe(second.link);
    expect(second.link.ended).toBe(false);
    slot.close();
    expect(slot.link).toBeNull();
    expect(second.link.ended).toBe(true);
  });
});

describe('MatchLink over a room', { timeout: 30_000 }, () => {
  let server: Awaited<ReturnType<typeof startRtdb>>;
  let db: Rtdb;
  beforeEach(async () => {
    server = await startRtdb();
    db = new Rtdb(server.url);
  });
  afterEach(async () => {
    await server.close();
  });
  const fast = { pingMs: 100, lostMs: 2000 };

  it('stands aside when the player opens the match on another phone, but not once it has ended', async () => {
    storage.set('pooket.clientId', 'phone-a');
    const room = await HostedRoom.open(db);
    const waiting = room.waitForGuest(fast);
    const guest = await joinRoom(db, room.code, fast, 'g', 'phone-g');
    const seat = { code: room.code, role: 'host' as const, id: room.id };
    const taken: MatchLink[] = [];
    const slot = new MatchSlot();
    const first = slot.open(await waiting, seat, { lobby: 'test', pick, taken: (l) => taken.push(l) });
    expect(first.room?.path).toBe(room.ref.path);
    await new Promise((r) => setTimeout(r, 200)); // (its seat watch is listening)
    // Back on this phone on a new connection (e.g. from a notification): the old one ends first.
    const second = slot.open(await rejoinRoom(db, room.code, 'host', room.id, fast, 'phone-a'), seat, { lobby: 'test', pick, taken: (l) => taken.push(l) });
    expect(first.ended).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    // Now the player's other phone takes the seat: only the live match hears.
    const other = await rejoinRoom(db, room.code, 'host', room.id, fast, 'phone-b');
    await until(() => taken.length > 0);
    await new Promise((r) => setTimeout(r, 200));
    expect(taken).toEqual([second]);
    slot.close('stand-down');
    for (const t of [guest, other]) t.close();
  });
});

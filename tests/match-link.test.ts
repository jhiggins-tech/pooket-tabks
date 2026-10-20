import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { concede, createGame } from '../src/game/game';
import type { PlayerConfig } from '../src/game/state';
import type { Listing } from '../src/net/lobby';
import { HostedRoom, joinRoom, rejoinRoom } from '../src/net/rooms';
import { Rtdb } from '../src/net/rtdb';
import { findSeat } from '../src/net/seat';
import { memoryRoom, RoomChannel } from '../src/net/channel';
import { NetSession } from '../src/net/session';
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
const onStart = (seed: number, players: PlayerConfig[], first: number) => createGame({ seed, players, first });
const pick = () => ({ name: 'H', characterId: 'kcaj' });

/** This phone's match (as host, room FROG) in a room in memory, and the other phone's session (the guest, which started it). */
async function linked(where: 'match' | 'over' | 'new', slot?: MatchSlot) {
  const room = memoryRoom();
  const them = new NetSession(room.channel('guest'), 'guest');
  them.onStart = onStart;
  them.start(7, PLAYERS);
  if (where === 'over') concede(them.game!, 1, 'resigned');
  await flush();
  const seat = { code: 'FROG', role: 'host' as const, id: 'h' };
  const channel = room.channel('host');
  const link = slot ? slot.open(channel, seat, { lobby: 'test', pick }) : new MatchLink(channel, seat, { lobby: 'test', pick });
  link.session.onStart = onStart;
  if (where !== 'new') link.session.open(room.rec!);
  if (where === 'over') concede(link.session.game!, 1, 'resigned');
  await flush();
  return { link, them, room };
}

describe('MatchLink: one match on this phone, and how it ends', () => {
  it('leaving it from the menu: by where it is', async () => {
    expect(leaving((await linked('match')).link.session)).toBe('left');
    expect(leaving((await linked('over')).link.session)).toBe('done');
    expect(leaving((await linked('new')).link.session)).toBe('away');
  });

  const cases: [where: Parameters<typeof linked>[0], how: MatchEnd, seat: 'kept' | 'left' | 'left-seen' | 'forgotten', heard: 'away' | 'nothing'][] = [
    ['match', 'away', 'kept', 'away'],
    ['match', 'left', 'left-seen', 'away'],
    ['over', 'done', 'forgotten', 'away'],
    ['match', 'stand-down', 'left', 'nothing'],
  ];
  for (const [where, how, seat, heard] of cases) {
    it(`${how} (${where}): the seat ${seat}, the other phone hears ${heard}`, async () => {
      const { link, them } = await linked(where);
      expect(findSeat('FROG')).toMatchObject({ role: 'host', id: 'h', left: false });
      expect(them.peerAway).toBe(false);
      const listing = { stop: vi.fn() };
      link.listing = listing as unknown as Listing;
      link.end(how);
      link.end('away'); // (once)
      await flush();
      expect(link.ended && link.session.ended).toBe(true);
      expect(listing.stop).toHaveBeenCalledOnce();
      const s = findSeat('FROG');
      if (seat === 'forgotten') expect(s).toBeNull();
      else expect(s).toMatchObject({ left: seat !== 'kept', ...(seat === 'left-seen' ? { seen: link.session.seen } : {}) });
      expect(seat === 'left' ? s?.seen : undefined).toBeUndefined();
      expect(them.peerAway).toBe(heard === 'away');
    });
  }

  it('lost (the room went): the seat forgotten, the listing stopped', async () => {
    const { link } = await linked('match');
    const listing = { stop: vi.fn() };
    link.listing = listing as unknown as Listing;
    link.end('lost');
    expect(findSeat('FROG')).toBeNull();
    expect(listing.stop).toHaveBeenCalledOnce();
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
    const second = await linked('match', slot);
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
  it('stands aside when the player opens the match on another phone, but not once it has ended', async () => {
    storage.set('pooket.clientId', 'phone-a');
    const room = await HostedRoom.open(db, { host: pick(), listed: false });
    await joinRoom(db, room.code, 'g', 'phone-g');
    const seat = { code: room.code, role: 'host' as const, id: room.id };
    const taken: MatchLink[] = [];
    const slot = new MatchSlot();
    const first = slot.open(new RoomChannel(room.ref, 'host'), seat, { lobby: 'test', pick, taken: (l) => taken.push(l) });
    expect(first.room?.path).toBe(room.ref.path);
    await new Promise((r) => setTimeout(r, 200)); // (its seat watch is listening)
    // Back on this phone (e.g. from a notification): the old one ends first.
    const second = slot.open(new RoomChannel(await rejoinRoom(db, room.code, 'host', room.id, 'phone-a'), 'host'), seat, { lobby: 'test', pick, taken: (l) => taken.push(l) });
    expect(first.ended).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    // Now the player's other phone takes the seat: only the open match hears.
    await rejoinRoom(db, room.code, 'host', room.id, 'phone-b');
    await until(() => taken.length > 0);
    await new Promise((r) => setTimeout(r, 200));
    expect(taken).toEqual([second]);
    slot.close('stand-down');
  });
});

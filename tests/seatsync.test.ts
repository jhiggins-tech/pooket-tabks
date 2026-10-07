import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Auth } from '../src/net/auth';
import { HostedRoom, joinRoom, rejoinRoom, TAKEOVER_WAIT_MS, watchSeat } from '../src/net/rooms';
import { Rtdb } from '../src/net/rtdb';
import { sealerFor } from '../src/net/seal';
import { findSeat, forgetSeat, FORGOTTEN_KEY, loadForgotten, loadSeats, SEAT_EXPIRY_MS, saveSeat, seatChanges, takeSeats, updateSeat } from '../src/net/seat';
import { SeatSync } from '../src/net/seatsync';
import { startRtdb, type FakeRtdb } from './support/rtdb';
import { until } from './support/wait';

const mem = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

describe('seats: what follows the player, and merging what the account says', () => {
  it('only a change to role, id or listed counts as a change for the account; forgetting leaves a note', () => {
    const s = mem();
    const heard: string[] = [];
    const off = seatChanges.on('changed', (c) => heard.push(c));
    saveSeat({ code: 'FROG', role: 'host', id: 'a' }, s, 1000);
    updateSeat('FROG', { left: true, seen: 3 }, s, 2000); // this phone's own business
    updateSeat('FROG', { ts: 2500 }, s, 2500);
    expect(heard).toEqual(['FROG']);
    expect(findSeat('FROG', s, 2500)?.at).toBe(1000);
    updateSeat('FROG', { listed: true }, s, 3000);
    expect(findSeat('FROG', s, 3000)?.at).toBe(3000);
    forgetSeat('FROG', s, 4000);
    expect(loadForgotten(s, 4000)).toEqual({ FROG: 4000 });
    expect(heard).toEqual(['FROG', 'FROG', 'FROG']);
    saveSeat({ code: 'FROG', role: 'host', id: 'a' }, s, 5000); // back in it: not forgotten any more
    expect(loadForgotten(s, 5000)).toEqual({});
    expect(loadForgotten(s, 4000 + SEAT_EXPIRY_MS + 1)).toEqual({});
    off();
  });

  it('takes in seats from the account: new ones, and newer versions, keeping this phone’s left and seen', () => {
    const s = mem();
    saveSeat({ code: 'FROG', role: 'guest', id: 'a' }, s, 1000);
    updateSeat('FROG', { left: true, seen: 4 }, s, 1000);
    saveSeat({ code: 'TOAD', role: 'host', id: 'b' }, s, 5000);
    let heard = 0;
    const off = seatChanges.on('changed', () => heard++);
    takeSeats(
      {
        seats: [
          { code: 'FROG', role: 'guest', id: 'a', listed: true, ts: 3000, at: 3000 }, // newer: listed now
          { code: 'TOAD', role: 'host', id: 'old', ts: 2000, at: 2000 }, // older than ours: ignored
          { code: 'NEWT', role: 'host', id: 'c', ts: 4000, at: 4000 }, // new here
        ],
        forgotten: {},
      },
      s,
      6000,
    );
    expect(heard).toBe(0); // quietly
    expect(loadSeats(s, 6000).map((x) => x.code)).toEqual(['TOAD', 'NEWT', 'FROG']);
    expect(findSeat('FROG', s, 6000)).toMatchObject({ listed: true, left: true, seen: 4, at: 3000 });
    expect(findSeat('TOAD', s, 6000)?.id).toBe('b');
    expect(findSeat('NEWT', s, 6000)).toMatchObject({ role: 'host', id: 'c' });
    expect(findSeat('NEWT', s, 6000)?.left).toBeUndefined();
    off();
  });

  it('forgets what was forgotten elsewhere since, and doesn’t bring back what was forgotten here', () => {
    const s = mem();
    saveSeat({ code: 'FROG', role: 'guest', id: 'a' }, s, 1000);
    saveSeat({ code: 'TOAD', role: 'host', id: 'b' }, s, 5000);
    forgetSeat('NEWT', s, 3000);
    takeSeats({ seats: [{ code: 'NEWT', role: 'host', id: 'c', ts: 2000, at: 2000 }], forgotten: { FROG: 2000, TOAD: 4000 } }, s, 6000);
    expect(loadSeats(s, 6000).map((x) => x.code)).toEqual(['TOAD']); // TOAD changed here after it was forgotten there
    expect(loadForgotten(s, 6000)).toMatchObject({ FROG: 2000, NEWT: 3000 });
    expect(JSON.parse(s.m.get(FORGOTTEN_KEY)!)).not.toHaveProperty('TOAD');
  });
});

describe('SeatSync (matches follow a signed-in player)', () => {
  let server: FakeRtdb;
  beforeEach(async () => {
    server = await startRtdb();
  });
  afterEach(async () => {
    await server.close();
  });

  const phone = (now?: () => number) => {
    const s = mem();
    const auth = new Auth({ apiKey: 'k', signInUrl: `${server.url}/identitytoolkit/signInWithIdp`, refreshUrl: `${server.url}/securetoken/token`, storage: s });
    let applied = 0;
    const sync = new SeatSync(auth, new Rtdb(server.url, () => auth.token()), () => applied++, { store: s, now });
    return { s, auth, sync, applied: () => applied };
  };
  const games = () => (server.tree().users as Record<string, { games?: Record<string, Record<string, unknown>> }> | undefined)?.['uid-ann']?.games ?? {};

  it('sends up the seats a phone already had, without what’s only about that phone', async () => {
    const a = phone();
    saveSeat({ code: 'FROG', role: 'host', id: 'h1', listed: true }, a.s);
    updateSeat('FROG', { left: true, seen: 2 }, a.s);
    await a.sync.sync(); // signed out: nothing
    expect(server.requests).toEqual([]);
    await a.auth.signInWithGoogle('fake:ann');
    await a.sync.sync();
    expect(games()).toEqual({ FROG: { role: 'host', id: 'h1', listed: true, ts: expect.any(Number), at: expect.any(Number) } });
  });

  it('another phone picks them up, and forgets them when they’re forgotten', async () => {
    const a = phone();
    const b = phone();
    await a.auth.signInWithGoogle('fake:ann');
    await b.auth.signInWithGoogle('fake:ann');
    saveSeat({ code: 'FROG', role: 'guest', id: 'g1' }, a.s);
    a.sync.changed('FROG');
    await until(() => !!games().FROG);
    await b.sync.sync();
    expect(findSeat('FROG', b.s)).toMatchObject({ role: 'guest', id: 'g1' });
    expect(b.applied()).toBe(1);
    await b.sync.sync(); // nothing new
    expect(b.applied()).toBe(1);

    forgetSeat('FROG', a.s);
    a.sync.changed('FROG');
    await until(() => games().FROG?.gone === true);
    await b.sync.sync();
    expect(findSeat('FROG', b.s)).toBeNull();
    // And B doesn't send it back up.
    await b.sync.sync();
    expect(games().FROG?.gone).toBe(true);
  });

  it('tidies away entries that are long over', async () => {
    let t = Date.now();
    const a = phone(() => t);
    await a.auth.signInWithGoogle('fake:ann');
    saveSeat({ code: 'FROG', role: 'guest', id: 'g1' }, a.s, t);
    await a.sync.sync();
    expect(games().FROG).toBeTruthy();
    t += SEAT_EXPIRY_MS + 1;
    await a.sync.sync();
    expect(games().FROG).toBeUndefined();
  });

  it('a seat changed while signed out goes up at the next sync', async () => {
    const a = phone();
    await a.auth.signInWithGoogle('fake:ann');
    const t = Date.now();
    saveSeat({ code: 'FROG', role: 'guest', id: 'g1' }, a.s, t - 2000);
    await a.sync.sync();
    a.auth.signOut();
    updateSeat('FROG', { listed: true }, a.s, t - 1000);
    a.sync.changed('FROG'); // signed out: not sent
    await new Promise((r) => setTimeout(r, 50));
    expect(games().FROG?.listed).toBeUndefined();
    await a.auth.signInWithGoogle('fake:ann');
    await a.sync.sync();
    expect(games().FROG).toMatchObject({ listed: true, at: t - 1000 });
  });
});

describe('one phone per seat: the one that rejoins last plays', () => {
  let server: FakeRtdb;
  let db: Rtdb;
  beforeEach(async () => {
    server = await startRtdb();
    db = new Rtdb(server.url);
  });
  afterEach(async () => {
    await server.close();
  });

  it('the phone that had the seat hears that another device took it; its own rejoins and check-ins don’t count', async () => {
    const room = await HostedRoom.open(db, undefined, 'phone-a');
    const waiting = room.waitForGuest();
    const guest = await joinRoom(db, room.code, undefined, 'g', 'phone-g');
    const host = await waiting;
    const path = `rooms/${(await sealerFor('room', room.code)).topic}`;
    let taken = 0;
    const watch = watchSeat({ db, path, sealer: await sealerFor('room', room.code) }, 'host', room.id, () => taken++, 'phone-a');
    // Checking in (just the time) and rejoining from the same phone: still ours.
    await db.patch(`${path}/host`, { ts: Date.now() });
    host.close();
    const again = await rejoinRoom(db, room.code, 'host', room.id, undefined, 'phone-a');
    await new Promise((r) => setTimeout(r, 200));
    expect(taken).toBe(0);
    expect((server.tree().rooms as Record<string, { host: { dev: string } }>)[path.split('/')[1]!]!.host.dev).toBe('phone-a');
    // The same player's other phone takes the seat: phone A hears, before B starts reading messages.
    const t0 = Date.now();
    const b = await rejoinRoom(db, room.code, 'host', room.id, undefined, 'phone-b');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(TAKEOVER_WAIT_MS - 50);
    await until(() => taken === 1);
    watch.close();
    for (const t of [again, b, guest]) t.close();
  });

  it('older versions’ seats (no device) never make anyone stand aside', async () => {
    const room = await HostedRoom.open(db, undefined, 'phone-a');
    const path = `rooms/${(await sealerFor('room', room.code)).topic}`;
    let taken = 0;
    const watch = watchSeat({ db, path, sealer: await sealerFor('room', room.code) }, 'host', room.id, () => taken++, 'phone-a');
    await db.put(`${path}/host`, { id: room.id, ts: Date.now() });
    await new Promise((r) => setTimeout(r, 200));
    expect(taken).toBe(0);
    watch.close();
    room.stop();
  });
});

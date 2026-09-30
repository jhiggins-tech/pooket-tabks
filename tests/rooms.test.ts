import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/game/constants';
import { createGame, currentPlayer, setAim, step } from '../src/game/game';
import type { GameState, PlayerConfig } from '../src/game/state';
import { toB64 } from '../src/net/b64';
import { Listing, lobbySealer, watchLobby, type Advert } from '../src/net/lobby';
import { RelayTransport } from '../src/net/relay';
import { loadRecord, loadRoomRecord } from '../src/net/record';
import { HostedRoom, joinRoom, newRoomCode, normaliseRoomCode, rejoinRoom, roomHost } from '../src/net/rooms';
import { seal, sealerFor } from '../src/net/seal';
import { Rtdb } from '../src/net/rtdb';
import { NetSession } from '../src/net/session';
import { startRtdb, type FakeRtdb } from './support/rtdb';

let server: FakeRtdb;
let db: Rtdb;
beforeEach(async () => {
  server = await startRtdb();
  db = new Rtdb(server.url);
});
afterEach(async () => {
  await server.close();
});
const until = async (cond: () => boolean, ms = 5000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('room codes', () => {
  it('are 4 letters; typing is forgiving', () => {
    expect(newRoomCode()).toMatch(/^[A-Z]{4}$/);
    expect(normaliseRoomCode(' fr0g ')).toBe('FROG');
    expect(normaliseRoomCode('F01L')).toBe('FOIL');
    expect(normaliseRoomCode('FRO')).toBeNull();
  });
});

describe('rooms through Firebase', () => {
  it('a joiner with the code reaches the host; messages flow both ways, in order', async () => {
    const room = await HostedRoom.open(db);
    const hostSide = room.waitForGuest();
    const guest = await joinRoom(db, room.code);
    const host = await hostSide;
    const atHost: unknown[] = [];
    const atGuest: unknown[] = [];
    host.onMessage = (m) => atHost.push(m);
    guest.onMessage = (m) => atGuest.push(m);
    for (let i = 0; i < 25; i++) guest.send({ n: i }); // a burst: batched, but still in order
    host.send({ hello: 'guest' });
    await until(() => atHost.length === 25 && atGuest.length === 1);
    expect(atHost).toEqual(Array.from({ length: 25 }, (_, i) => ({ n: i })));
    expect(atGuest).toEqual([{ hello: 'guest' }]);
    // The database only ever held ciphertext, under a hashed path.
    const dump = JSON.stringify(server.tree());
    expect(dump).not.toContain(room.code);
    expect(dump).not.toContain('hello');
    // Read messages get deleted.
    await until(() => !JSON.stringify(server.tree()).includes('g2h'), 4000);
    host.close();
    guest.close();
  });

  it('a third phone is told the game is full; a wrong code is explained', async () => {
    const room = await HostedRoom.open(db);
    void room.waitForGuest();
    await joinRoom(db, room.code);
    await expect(joinRoom(db, room.code)).rejects.toThrow(/two players/);
    await expect(joinRoom(db, 'ZZZZ')).rejects.toThrow(/No game with code ZZZZ/);
  });

  it("an open game can be joined with its host away (and a room that isn't open can't)", async () => {
    const open = await HostedRoom.open(db, { host: { name: 'Jack', characterId: 'tones' }, listed: true });
    open.stop(); // the host goes back to the menu
    const closed = await HostedRoom.open(db);
    closed.stop();
    const stale = Date.now() - 10 * 60_000;
    for (const r of [open, closed]) {
      const sealer = await sealerFor('room', r.code);
      await db.put(`rooms/${sealer.topic}/host`, { id: r.id, ts: stale }); // long gone
    }
    expect(await roomHost(db, open.code)).toEqual({ id: open.id, here: false });
    expect(await loadRoomRecord(db, open.code)).toMatchObject({ offer: { host: { name: 'Jack', characterId: 'tones' }, listed: true } });
    expect(await loadRecord(db, open.code)).toBeNull(); // not a match yet
    const t = await joinRoom(db, open.code, undefined, 'first');
    await expect(joinRoom(db, open.code, undefined, 'second')).rejects.toThrow(/two players/);
    await expect(joinRoom(db, closed.code)).rejects.toThrow(/No game/);
    t.close();
  });

  it('the host can go back to its open game (nobody joined yet) and wait on', async () => {
    const room = await HostedRoom.open(db, { host: { name: 'Jack', characterId: 'tones' }, listed: false });
    room.stop();
    const again = await HostedRoom.reclaim(db, room.code, room.id);
    expect((await roomHost(db, room.code))?.here).toBe(true);
    const hostSide = again.waitForGuest();
    const guest = await joinRoom(db, room.code);
    const host = await hostSide;
    const got: unknown[] = [];
    host.onMessage = (m) => got.push(m);
    guest.send({ hi: 1 });
    await until(() => got.length === 1);
    host.close();
    guest.close();
  });

  it("says so when the server can't be reached, rather than blaming the codes", async () => {
    await expect(HostedRoom.open(new Rtdb('http://127.0.0.1:9'))).rejects.toThrow(/Couldn't reach the game server/);
  });

  it('when the host cancels, the room is gone', async () => {
    const room = await HostedRoom.open(db);
    room.cancel();
    await until(() => JSON.stringify(server.tree()) === '{}');
    await expect(joinRoom(db, room.code)).rejects.toThrow(/No game/);
  });

  it('notices when the other phone goes quiet, and when it comes back on a new connection', async () => {
    const fast = { pingMs: 100, lostMs: 600 };
    const room = await HostedRoom.open(db);
    const hostSide = room.waitForGuest(fast);
    const guest = await joinRoom(db, room.code, fast, 'guest-1');
    const host = await hostSide;
    const quiet: boolean[] = [];
    let closed = false;
    host.onQuiet = (q) => quiet.push(q);
    host.onClose = () => (closed = true);
    const atHost: unknown[] = [];
    host.onMessage = (m) => atHost.push(m);
    guest.send({ n: 1 });
    await until(() => atHost.length === 1);
    await new Promise((r) => setTimeout(r, 400));
    expect(quiet).toEqual([]); // pings keep it alive
    guest.close(); // the guest phone vanishes (no goodbye)
    host.send({ missed: true }); // sent while they're away: stale by the time they're back
    await until(() => quiet.length === 1, 3000);
    expect(quiet).toEqual([true]);
    expect(closed).toBe(false); // the match waits for them

    // Back on a new connection (a reload): it has its seat back, and both ways work again.
    const again = await rejoinRoom(db, room.code, 'guest', 'guest-1', fast);
    const atGuest: unknown[] = [];
    again.onMessage = (m) => atGuest.push(m);
    again.send({ n: 2 });
    await until(() => quiet.length === 2);
    expect(quiet).toEqual([true, false]);
    await until(() => atHost.length === 2);
    expect(atHost).toEqual([{ n: 1 }, { n: 2 }]);
    host.restart(); // what the session does for a rejoined phone
    host.send({ hello: 'again' });
    await until(() => atGuest.length === 1);
    expect(atGuest).toEqual([{ hello: 'again' }]);
    // Someone else can't take the seat meanwhile.
    await expect(rejoinRoom(db, room.code, 'guest', 'impostor')).rejects.toThrow(/taken your seat/);
    host.close();
    again.close();
  });

  it('a host can free the guest seat (a ghost that joined and vanished) and a real player can then join', async () => {
    const room = await HostedRoom.open(db);
    const first = room.waitForGuest();
    const ghost = await joinRoom(db, room.code, undefined, 'ghost-id');
    const hostToGhost = await first;
    hostToGhost.detach();
    ghost.close();
    await room.reopen();
    const second = room.waitForGuest();
    const real = await joinRoom(db, room.code, undefined, 'real-id');
    const host = await second;
    const got: unknown[] = [];
    host.onMessage = (m) => got.push(m);
    // Something the ghost sent that only lands now (it was on its way when the seat was freed).
    const sealer = await sealerFor('room', room.code);
    const late = new RelayTransport(db, `rooms/${sealer.topic}`, 'guest', sealer, { me: 'ghost-id' }).start();
    late.send({ k: 'hello', from: 'the ghost' });
    await until(() => server.requests.filter((r) => r.method === 'POST').length >= 1);
    real.send({ n: 1 });
    await until(() => got.length >= 1);
    await new Promise((r) => setTimeout(r, 300));
    expect(got).toEqual([{ n: 1 }]); // only the real player
    late.close();
    host.close();
    real.close();
  });

  it('a last message sent just before closing still gets through (even with another send in flight)', async () => {
    const room = await HostedRoom.open(db);
    const hostSide = room.waitForGuest();
    const guest = await joinRoom(db, room.code);
    const host = await hostSide;
    const got: unknown[] = [];
    host.onMessage = (m) => got.push(m);
    server.latency = 300; // so the first message is still on its way when the phone closes
    guest.send({ n: 1 });
    await until(() => server.requests.some((r) => r.method === 'POST' && r.path.endsWith('g2h')), 2000);
    guest.send({ k: 'bye' });
    guest.close();
    await until(() => got.length === 2, 4000);
    expect(got).toEqual([{ n: 1 }, { k: 'bye' }]);
    host.close();
  });

  it('a quiet phone that never comes back: the other side learns the room has closed', async () => {
    const fast = { pingMs: 100, lostMs: 400 };
    const room = await HostedRoom.open(db);
    const hostSide = room.waitForGuest(fast);
    const guest = await joinRoom(db, room.code, fast);
    const host = await hostSide;
    let closed = false;
    guest.onClose = () => (closed = true);
    host.close(); // closes the room (a moment later)
    await until(() => closed, 8000);
    await expect(rejoinRoom(db, room.code, 'guest', 'whoever')).rejects.toThrow(/has ended/);
  });

  it('plays a networked match over the relay, both phones in sync', { timeout: 30_000 }, async () => {
    const room = await HostedRoom.open(db);
    const hostSide = room.waitForGuest();
    const a = new NetSession(await joinRoom(db, room.code), 'guest');
    const b = new NetSession(await hostSide, 'host');
    const [host, guest] = [b, a];
    for (const s of [host, guest]) s.onStart = (seed: number, players: PlayerConfig[]) => createGame({ seed, players });
    host.setPick({ name: 'H', characterId: 'kcaj' });
    guest.setPick({ name: 'G', characterId: 'tones' });
    await until(() => host.ready && guest.ready);
    host.start(99, [
      { name: 'H', characterId: 'kcaj', colour: '#fc0' },
      { name: 'G', characterId: 'tones', colour: '#f55' },
    ]);
    await until(() => !!guest.game);
    const [H, G] = [host.game!, guest.game!];
    for (let turn = 0; turn < 2; turn++) {
      const [me, S] = H.current === 0 ? [host, H] : [guest, G];
      setAim(S, S.current === 0 ? 60 : 120, 60);
      expect(me.fire()).toBe(true);
      const next = S.current === 0 ? guest : host;
      const t0 = Date.now();
      while (!(next.canAct() && H.turn === G.turn && H.phase === 'aiming' && G.phase === 'aiming')) {
        for (const [s, st] of [[host, H], [guest, G]] as [NetSession, GameState][]) {
          step(st, FIXED_DT);
          s.tick(FIXED_DT);
        }
        await new Promise((r) => setTimeout(r, 1));
        if (Date.now() - t0 > 15_000) throw new Error('turn never resolved');
      }
      expect(G.players.map((p) => [p.hp, p.x, p.ammo])).toEqual(H.players.map((p) => [p.hp, p.x, p.ammo]));
      expect(G.terrain.solid).toEqual(H.terrain.solid);
    }
    expect(currentPlayer(H).name).toBe('H');
    host.leave();
  });
});

describe('the Games list', () => {
  it('a listed game shows up for everyone on the list, updates as it goes, and goes when it stops', async () => {
    const lobby = await lobbySealer('test-list');
    const listing = new Listing(db, lobby, { hostId: 'h1', name: 'kcaj', characterId: 'kcaj', room: 'FROG' });
    listing.list(true);
    let list: Advert[] = [];
    const w = watchLobby(db, lobby, (l) => (list = l));
    await until(() => list.length === 1);
    expect(list[0]).toMatchObject({ name: 'kcaj', room: 'FROG' });
    expect(list[0]!.playing).toBeFalsy();
    // Someone joins: the game moves to "live", with who's playing.
    listing.update({ playing: true, opponent: { name: 'Ann', characterId: 'tones' } });
    await until(() => !!list[0]?.playing);
    expect(list[0]!.opponent).toEqual({ name: 'Ann', characterId: 'tones' });
    // Another list doesn't see it.
    let other: Advert[] = [{} as Advert];
    const w2 = watchLobby(db, await lobbySealer('another-list'), (l) => (other = l));
    await until(() => other.length === 0);
    // Made private: off the list; public again: back, as it was.
    listing.list(false);
    await until(() => list.length === 0);
    listing.list(true);
    await until(() => list.length === 1);
    expect(list[0]!.opponent?.name).toBe('Ann');
    listing.stop();
    await until(() => list.length === 0);
    w.stop();
    w2.stop();
  });

  it("a game waiting for a player stays listed while its host is away; a live one that's gone quiet doesn't", async () => {
    const lobby = await lobbySealer('test-list');
    const tenMinutesAgo = Date.now() - 10 * 60_000;
    const put = async (hostId: string, ad: Partial<Advert>) =>
      db.put(`lobby/${lobby.topic}/${hostId}`, { m: toB64(await seal(lobby, { hostId, name: hostId, characterId: 'kie', room: 'ROOM', ts: tenMinutesAgo, ...ad })), ts: tenMinutesAgo });
    await put('waiting', { open: true });
    await put('quiet-live', { playing: true });
    let list: Advert[] | null = null;
    const w = watchLobby(db, lobby, (l) => (list = l));
    await until(() => list !== null && list.length === 1);
    expect(list![0]!.hostId).toBe('waiting');
    w.stop();
  });

  it('a listing from a host that vanished long ago is hidden and tidied away', async () => {
    const lobby = await lobbySealer('test-list');
    const old = { hostId: 'gone', name: 'x', characterId: 'kie', room: 'OLDY', ts: Date.now() - 60 * 60_000 };
    await db.put(`lobby/${lobby.topic}/gone`, { m: toB64(await seal(lobby, old)), ts: Date.now() - 60 * 60_000 });
    let list: Advert[] = [{} as Advert];
    const w = watchLobby(db, lobby, (l) => (list = l));
    await until(() => list.length === 0);
    await until(() => !JSON.stringify(server.tree()).includes('gone'));
    w.stop();
  });
});

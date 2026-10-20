import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGame } from '../src/game/game';
import type { PlayerConfig } from '../src/game/state';
import { toB64 } from '../src/net/b64';
import { Listing, lobbySealer, watchLobby, type Advert } from '../src/net/lobby';
import { RoomChannel, seatHere, type SeatEntry } from '../src/net/channel';
import { loadRecord, loadRoomRecord } from '../src/net/record';
import { HostedRoom, joinRoom, newRoomCode, normaliseRoomCode, rejoinRoom } from '../src/net/rooms';
import { seal, sealerFor } from '../src/net/seal';
import { Rtdb } from '../src/net/rtdb';
import { NetSession } from '../src/net/session';
import { startRtdb, type FakeRtdb } from './support/rtdb';
import { until } from './support/wait';

let server: FakeRtdb;
let db: Rtdb;
beforeEach(async () => {
  server = await startRtdb();
  db = new Rtdb(server.url);
});
afterEach(async () => {
  await server.close();
});

describe('room codes', () => {
  it('are 4 letters; typing is forgiving', () => {
    expect(newRoomCode()).toMatch(/^[A-Z]{4}$/);
    expect(normaliseRoomCode(' fr0g ')).toBe('FROG');
    expect(normaliseRoomCode('F01L')).toBe('FOIL');
    expect(normaliseRoomCode('FRO')).toBeNull();
  });
});

const JACK = { host: { name: 'Jack', characterId: 'tones' }, listed: true };

describe('rooms through Firebase', () => {
  it('a joiner with the code gets the guest seat and the host’s offer; the host hears once the match starts', async () => {
    const room = await HostedRoom.open(db, JACK);
    const started = room.waitForMatch();
    const { room: ref, offer, hostId } = await joinRoom(db, room.code, 'g');
    expect(offer).toEqual(JACK);
    expect(hostId).toBe(room.id);
    const guest = new NetSession(new RoomChannel(ref, 'guest'), 'guest');
    guest.onStart = (seed: number, players: PlayerConfig[], first: number) => createGame({ seed, players, first });
    guest.start(5, [
      { name: 'Jack', characterId: 'tones', colour: '#f00' },
      { name: 'G', characterId: 'kcaj', colour: '#00f' },
    ]);
    const stored = await started;
    expect(stored.rec.setup).toMatchObject({ seed: 5, first: 1 });
    // The database only ever held ciphertext, under a hashed path.
    const dump = JSON.stringify(server.tree());
    expect(dump).not.toContain(room.code);
    expect(dump).not.toContain('Jack');
    guest.away();
  });

  it('a third phone is told the game is full (and so is anyone once the match has started); a wrong code is explained', async () => {
    const room = await HostedRoom.open(db, JACK);
    await joinRoom(db, room.code);
    await expect(joinRoom(db, room.code)).rejects.toThrow(/two players/);
    await expect(joinRoom(db, 'ZZZZ')).rejects.toThrow(/No game with code ZZZZ/);
  });

  it("an open game can be joined with its host away (and a room that isn't open can't)", async () => {
    const open = await HostedRoom.open(db, JACK);
    open.stop(); // the host goes back to the menu
    const closed = await HostedRoom.open(db);
    closed.stop();
    const stale = Date.now() - 10 * 60_000;
    for (const r of [open, closed]) {
      const sealer = await sealerFor('room', r.code);
      await db.put(`rooms/${sealer.topic}/host`, { id: r.id, ts: stale }); // long gone
    }
    expect(await loadRoomRecord(db, open.code)).toMatchObject({ offer: JACK });
    expect(await loadRecord(db, open.code)).toBeNull(); // not a match yet
    await joinRoom(db, open.code, 'first');
    await expect(joinRoom(db, open.code, 'second')).rejects.toThrow(/two players/);
    await expect(joinRoom(db, closed.code)).rejects.toThrow(/No game/);
  });

  it('the host can go back to its open game (nobody joined yet) and wait on; the offer can change meanwhile', async () => {
    const room = await HostedRoom.open(db, JACK);
    room.stop();
    const again = await HostedRoom.reclaim(db, room.code, room.id);
    await again.offer({ ...JACK, listed: false, gameName: 'Rematch' });
    expect(await loadRoomRecord(db, room.code)).toMatchObject({ offer: { listed: false, gameName: 'Rematch' } });
    const started = again.waitForMatch();
    const { room: ref } = await joinRoom(db, room.code, 'g');
    const guest = new NetSession(new RoomChannel(ref, 'guest'), 'guest');
    guest.onStart = (seed: number, players: PlayerConfig[], first: number) => createGame({ seed, players, first });
    guest.start(5, [
      { name: 'Jack', characterId: 'tones', colour: '#f00' },
      { name: 'G', characterId: 'kcaj', colour: '#00f' },
    ]);
    expect((await started).rec.n).toBe(1);
    guest.away();
  });

  it("says so when the server can't be reached, rather than blaming the codes", async () => {
    await expect(HostedRoom.open(new Rtdb('http://127.0.0.1:9'))).rejects.toThrow(/Couldn't reach the game server/);
  });

  it('when the host cancels, the room is gone', async () => {
    const room = await HostedRoom.open(db, JACK);
    room.cancel();
    await until(() => JSON.stringify(server.tree()) === '{}');
    await expect(joinRoom(db, room.code)).rejects.toThrow(/No game/);
  });

  it('someone else can’t take a seat that’s been claimed', async () => {
    const room = await HostedRoom.open(db, JACK);
    await joinRoom(db, room.code, 'guest-1');
    await rejoinRoom(db, room.code, 'guest', 'guest-1');
    await expect(rejoinRoom(db, room.code, 'guest', 'impostor')).rejects.toThrow(/taken your seat/);
  });

  it('who’s here: a phone with the match open checks in on its seat; leaving says so', async () => {
    const room = await HostedRoom.open(db, JACK);
    const { room: ref } = await joinRoom(db, room.code, 'g');
    room.stop();
    const host = new RoomChannel(ref, 'host');
    const seen: boolean[] = [];
    host.onPresence = (here) => seen.push(here);
    host.start();
    const guest = new RoomChannel(ref, 'guest');
    guest.start();
    await until(() => seen.at(-1) === true);
    guest.close(true);
    await until(() => seen.at(-1) === false);
    expect(seatHere(server.at(`${ref.path}/guest`) as SeatEntry)).toBe(false);
    host.close(true);
  });

  it('whether a seat is here: a recent check-in (by the clock, or seen to arrive), and not left', () => {
    const now = 1_000_000;
    expect(seatHere(null, now)).toBe(false);
    expect(seatHere({ id: 'x', ts: now - 10_000 }, now)).toBe(true);
    expect(seatHere({ id: 'x', ts: now - 10_000, out: true }, now)).toBe(false);
    expect(seatHere({ id: 'x', ts: now - 120_000 }, now)).toBe(false);
    expect(seatHere({ id: 'x', ts: now - 120_000 }, now, now - 5_000)).toBe(true); // (this phone's clock is off)
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

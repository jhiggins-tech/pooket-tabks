import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Rtdb } from '../src/net/rtdb';
import { sealerFor } from '../src/net/seal';
import { putSealed } from '../src/net/sealed';
import { checkIn, followWatchers, WATCHER_STALE_MS, type RoomRef, type Watcher } from '../src/net/watchers';
import { startRtdb, type FakeRtdb } from './support/rtdb';

let server: FakeRtdb;
let room: RoomRef;
beforeEach(async () => {
  server = await startRtdb();
  const sealer = await sealerFor('room', 'FROG');
  room = { db: new Rtdb(server.url), path: `rooms/${sealer.topic}`, sealer };
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

describe("who's watching", () => {
  it('lists everyone checked in, and announces only those who turn up after we started following', async () => {
    const kim = checkIn(room, 'k1', 'Kim');
    await until(() => JSON.stringify(server.tree()).includes('k1'));
    let list: Watcher[] = [];
    const arrived: string[] = [];
    const f = followWatchers(room, { list: (l) => (list = l), arrive: (w) => arrived.push(w.name) });
    await until(() => list.length === 1);
    expect(list).toEqual([{ id: 'k1', name: 'Kim' }]);
    expect(arrived).toEqual([]); // already there

    const bo = checkIn(room, 'b2', 'Bo');
    await until(() => list.length === 2);
    expect(list.map((w) => w.name)).toEqual(['Kim', 'Bo']);
    expect(arrived).toEqual(['Bo']);

    kim.stop();
    await until(() => list.length === 1);
    expect(list.map((w) => w.name)).toEqual(['Bo']);
    bo.stop();
    await until(() => list.length === 0);
    expect(arrived).toEqual(['Bo']);
    f.stop();
  });

  it("a check-in that's gone stale doesn't count (a phone that closed without checking out)", async () => {
    let clock = Date.now();
    let list: Watcher[] = [];
    const f = followWatchers(room, { list: (l) => (list = l), arrive: () => {} }, () => clock);
    await putSealed(room.db, `${room.path}/watchers/z9`, room.sealer, { name: 'Zed' });
    await until(() => list.length === 1);
    clock += WATCHER_STALE_MS + 1000;
    await until(() => list.length === 0, 7000); // (the list is re-checked every 5 s)
    f.stop();
  }, 10_000);

  it("ignores entries that aren't sealed for this room", async () => {
    const other = await sealerFor('room', 'TOAD');
    let lists = 0;
    let list: Watcher[] = [];
    const f = followWatchers(room, { list: (l) => ((list = l), lists++), arrive: () => {} });
    await putSealed(room.db, `${room.path}/watchers/x1`, other, { name: 'Eve' });
    await putSealed(room.db, `${room.path}/watchers/a1`, room.sealer, { name: 'Ann' });
    await until(() => list.length === 1);
    expect(list.map((w) => w.name)).toEqual(['Ann']);
    expect(lists).toBeGreaterThan(0);
    f.stop();
  });
});

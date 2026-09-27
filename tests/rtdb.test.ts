import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Rtdb, SERVER_TIME, type RtdbEvent } from '../src/net/rtdb';
import { startRtdb, type FakeRtdb } from './support/rtdb';

let server: FakeRtdb;
let db: Rtdb;
beforeEach(async () => {
  server = await startRtdb();
  db = new Rtdb(`${server.url}/`);
});
afterEach(async () => {
  await server.close();
});
const until = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('Firebase REST client', () => {
  it('reads and writes JSON at paths, with server timestamps', async () => {
    expect(await db.get('rooms/x')).toBeNull();
    await db.put('rooms/x/host', { id: 'h', ts: SERVER_TIME });
    const host = await db.get<{ id: string; ts: number }>('rooms/x/host');
    expect(host!.id).toBe('h');
    expect(Math.abs(host!.ts - Date.now())).toBeLessThan(5000);
    const k1 = await db.post('rooms/x/h2g', 'one');
    const k2 = await db.post('rooms/x/h2g', 'two');
    expect(k1 < k2).toBe(true); // time-ordered keys
    await db.patch('rooms/x', { h2g: null, host: null });
    expect(await db.get('rooms/x')).toBeNull();
  });

  it('refuses a taken seat with a permission error', async () => {
    await db.put('rooms/x/guest', { id: 'g1', ts: 1 });
    await expect(db.put('rooms/x/guest', { id: 'g2', ts: 1 })).rejects.toMatchObject({ denied: true });
  });

  it('streams the current value, then every change', async () => {
    await db.post('rooms/x/h2g', 'first');
    const events: RtdbEvent[] = [];
    const s = db.stream('rooms/x/h2g', (e) => events.push(e));
    await until(() => events.length === 1);
    expect(events[0]!.path).toBe('/');
    expect(Object.values(events[0]!.data as object)).toEqual(['first']);
    const k = await db.post('rooms/x/h2g', 'second');
    await until(() => events.length === 2);
    expect(events[1]).toEqual({ path: `/${k}`, data: 'second', kind: 'put' });
    s.close();
  });
});

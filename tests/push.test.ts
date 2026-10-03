import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Auth } from '../src/net/auth';
import { accountAddress, announceDevice, clientId, followOutbox, notifySeat, registerPushDevice, useAccount, wantsPush, type OutboxEntry } from '../src/net/push';
import { Rtdb } from '../src/net/rtdb';
import { sealerFor } from '../src/net/seal';
import type { RoomRef } from '../src/net/watchers';
import { render } from '../src/push/templates';
import { startRtdb, type FakeRtdb } from './support/rtdb';
import { until } from './support/wait';

/** Node has no localStorage: a minimal one, so each "phone" can be someone else. */
const storage = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) },
});
/** Be a phone: its id and whether it has notifications on. */
const be = (id: string, push: boolean) => {
  storage.set('pooket.clientId', id);
  wantsPush(push);
};

let server: FakeRtdb;
let room: RoomRef;
beforeEach(async () => {
  storage.clear();
  server = await startRtdb();
  const sealer = await sealerFor('room', 'FROG');
  room = { db: new Rtdb(server.url), path: `rooms/${sealer.topic}`, sealer };
  await room.db.put(`${room.path}/host`, { id: 'host-seat', ts: Date.now() });
  await room.db.put(`${room.path}/guest`, { id: 'guest-seat', ts: Date.now() });
});
afterEach(async () => {
  useAccount(() => null);
  await server.close();
});
const outbox = () => Object.values((server.tree().outbox as Record<string, Record<string, unknown>> | undefined) ?? {});

describe('notifications, the database side', () => {
  it("the templates say what's what, and refuse anything else", () => {
    expect(render('joined', 'a'.repeat(24))).toMatchObject({ title: '🎮 Someone joined your game', url: `./#play=${'a'.repeat(24)}` });
    expect(render('your-turn', 'FROG')).toBeNull(); // a room code is never a ref
    expect(render('pwned', 'a'.repeat(24))).toBeNull();
  });

  it("tells the other seat's device, by the room's topic (never its code), only if it has notifications on", async () => {
    be('bob-phone', true);
    announceDevice(room, 'guest', 'guest-seat');
    await until(() => JSON.stringify(server.tree()).includes('devices'));
    be('ann-phone', false);
    await notifySeat(room, 'guest', 'your-turn');
    await until(() => outbox().length === 1);
    expect(outbox()[0]).toMatchObject({ type: 'your-turn', ref: room.sealer.topic, to: 'bob-phone', originClientId: 'ann-phone' });
    expect(JSON.stringify(outbox())).not.toContain('FROG');
    expect(typeof outbox()[0]!.createdAt).toBe('number');

    // Ann has notifications off: Bob's phone doesn't write anything for her.
    announceDevice(room, 'host', 'host-seat');
    await new Promise((r) => setTimeout(r, 100));
    be('bob-phone', true);
    await notifySeat(room, 'host', 'your-turn');
    expect(outbox()).toHaveLength(1);
  });

  it("a device left over from an earlier game in the room (another seat id) isn't told", async () => {
    be('old-phone', true);
    announceDevice(room, 'guest', 'someone-before');
    await new Promise((r) => setTimeout(r, 100));
    be('ann-phone', true);
    await notifySeat(room, 'guest', 'your-turn');
    expect(outbox()).toHaveLength(0);
  });

  it('an open page hears about entries for it as they come (not old ones, not anyone else’s)', async () => {
    be('bob-phone', true);
    await room.db.post('outbox', { type: 'your-turn', ref: room.sealer.topic, to: clientId(), originClientId: 'x', createdAt: 1 }); // before it opened
    const got: OutboxEntry[] = [];
    const f = followOutbox(room.db, (e) => got.push(e));
    await new Promise((r) => setTimeout(r, 200));
    await room.db.post('outbox', { type: 'joined', ref: room.sealer.topic, to: 'someone-else', originClientId: 'x', createdAt: 2 });
    await room.db.post('outbox', { type: 'joined', ref: room.sealer.topic, to: 'bob-phone', originClientId: 'x', createdAt: 3 });
    await until(() => got.length === 1);
    await new Promise((r) => setTimeout(r, 200));
    expect(got).toEqual([{ id: expect.any(String), type: 'joined', ref: room.sealer.topic }]);
    f.stop();
  });

  it("a signed-in player's device says whose it is, and their notifications go to the account (even with this phone's off)", async () => {
    be('bob-phone', false);
    useAccount(() => 'bob-uid');
    announceDevice(room, 'guest', 'guest-seat');
    await until(() => JSON.stringify(server.tree()).includes('devices'));
    useAccount(() => null);
    be('ann-phone', false);
    await notifySeat(room, 'guest', 'your-turn');
    await until(() => outbox().length === 1);
    expect(outbox()[0]).toMatchObject({ to: accountAddress('bob-uid'), originClientId: 'ann-phone' });
    expect(outbox()[0]!.to).toBe('u:bob-uid');
  });

  it("an open page signed in follows the account's entries too", async () => {
    be('bob-phone', true);
    const got: string[] = [];
    const mine = followOutbox(room.db, (e) => got.push(`phone:${e.type}`));
    const account = followOutbox(room.db, (e) => got.push(`account:${e.type}`), accountAddress('bob-uid'));
    await new Promise((r) => setTimeout(r, 200));
    await room.db.post('outbox', { type: 'joined', ref: room.sealer.topic, to: 'u:someone-else', originClientId: 'x', createdAt: 1 });
    await room.db.post('outbox', { type: 'your-turn', ref: room.sealer.topic, to: 'u:bob-uid', originClientId: 'x', createdAt: 2 });
    await room.db.post('outbox', { type: 'joined', ref: room.sealer.topic, to: 'bob-phone', originClientId: 'x', createdAt: 3 });
    await until(() => got.length === 2);
    await new Promise((r) => setTimeout(r, 200));
    expect(got.sort()).toEqual(['account:your-turn', 'phone:joined']);
    mine.stop();
    account.stop();
  });

  it("lists this phone under the account while notifications are on (only with the account's token), and takes it off", async () => {
    be('0123abcd-phone', true);
    const auth = new Auth({ apiKey: 'k', signInUrl: `${server.url}/identitytoolkit/signInWithIdp`, refreshUrl: `${server.url}/securetoken/token`, storage: null });
    const uid = await auth.signInWithGoogle('fake:bob');
    const listed = () => (server.tree().users as Record<string, { push?: Record<string, unknown> }> | undefined)?.[uid]?.push;
    await registerPushDevice(new Rtdb(server.url, () => auth.token()), uid, true);
    expect(Object.keys(listed() ?? {})).toEqual(['0123abcd-phone']);
    await registerPushDevice(new Rtdb(server.url), uid, false); // no token: refused (and only logged)
    expect(Object.keys(listed() ?? {})).toEqual(['0123abcd-phone']);
    await registerPushDevice(new Rtdb(server.url, () => auth.token()), uid, false);
    expect(listed()).toBeUndefined();
  });
});

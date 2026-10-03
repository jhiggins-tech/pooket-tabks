import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Account, LINK_KEY, type LocalProfile, type ProfileData } from '../src/net/account';
import { Auth } from '../src/net/auth';
import { RtdbError, Rtdb } from '../src/net/rtdb';
import { startRtdb, type FakeRtdb } from './support/rtdb';
import { until } from './support/wait';

let server: FakeRtdb;
beforeEach(async () => {
  server = await startRtdb();
});
afterEach(async () => {
  await server.close();
});

/** A phone: its own storage, its own Auth and settings, talking to the stand-in. */
function phone(opts: { storage?: Map<string, string>; now?: () => number } = {}) {
  const map = opts.storage ?? new Map<string, string>();
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
  const auth = new Auth({ apiKey: 'key', signInUrl: `${server.url}/identitytoolkit/signInWithIdp`, refreshUrl: `${server.url}/securetoken/token`, storage, now: opts.now });
  const db = new Rtdb(server.url, () => auth.token());
  let settings: ProfileData = {};
  let applied = 0;
  const local: LocalProfile = { read: () => ({ ...settings }), apply: (p) => void (settings = { ...settings, ...p }) };
  const account = new Account(auth, db, local, () => applied++, { store: storage, pushDelayMs: 20 });
  return { map, storage, auth, db, account, applied: () => applied, set: (p: ProfileData) => void (settings = { ...settings, ...p }), settings: () => settings };
}

describe('Auth (Google ID token for a Firebase account)', () => {
  it('signs in, keeps only what it needs, and carries on after a reload', async () => {
    const a = phone();
    expect(a.auth.signedIn).toBe(false);
    expect(await a.auth.token()).toBeNull();
    const seen: boolean[] = [];
    a.auth.onChange(() => seen.push(a.auth.signedIn));
    expect(await a.auth.signInWithGoogle('fake:ann')).toBe('uid-ann');
    expect(a.auth.uid).toBe('uid-ann');
    expect(seen).toEqual([true]);
    expect(JSON.parse(a.map.get('pooket.auth')!)).toEqual({ uid: 'uid-ann', idToken: expect.any(String), refreshToken: expect.any(String), expiresAt: expect.any(Number) });
    const again = phone({ storage: a.map });
    expect(again.auth.uid).toBe('uid-ann');
    expect(await again.auth.token()).toBe(await a.auth.token());
  });

  it('refuses a credential Firebase refuses, staying signed out', async () => {
    const a = phone();
    await expect(a.auth.signInWithGoogle('nonsense')).rejects.toThrow(/INVALID_IDP_RESPONSE/);
    expect(a.auth.signedIn).toBe(false);
  });

  it('refreshes the token shortly before it lapses, quietly, and again after', async () => {
    let t = 1_000_000;
    const a = phone({ now: () => t });
    await a.auth.signInWithGoogle('fake:ann');
    const first = await a.auth.token();
    expect(await a.auth.token()).toBe(first); // still good: no new one
    expect(server.tokens).toBe(1);
    let changes = 0;
    a.auth.onChange(() => changes++);
    t += 3600_000 - 30_000; // within the last minute
    const second = await a.auth.token();
    expect(second).not.toBe(first);
    expect(server.tokens).toBe(2);
    expect(changes).toBe(0);
    expect(await a.auth.token()).toBe(second);
  });

  it('signs out when Firebase says the refresh token is dead; stays signed in when it just can’t be reached', async () => {
    let t = 0;
    const a = phone({ now: () => t });
    await a.auth.signInWithGoogle('fake:ann');
    t += 3600_000;
    const real = server.url;
    const lost = new Auth({ apiKey: 'k', refreshUrl: 'http://127.0.0.1:9/securetoken/token', storage: a.storage, now: () => t });
    expect(await lost.token()).toBeNull();
    expect(lost.signedIn).toBe(true); // a bad signal isn't a sign out
    expect(real).toBeTruthy();
    server.revoked.add('uid-ann');
    let out = 0;
    a.auth.onChange(() => out++);
    expect(await a.auth.token()).toBeNull();
    expect(a.auth.signedIn).toBe(false);
    expect(out).toBe(1);
    expect(a.map.has('pooket.auth')).toBe(false);
  });

  it('signs out cleanly, and only talks to the database with a token for users/ paths', async () => {
    const a = phone();
    await expect(a.db.get('users/uid-ann/profile')).rejects.toBeInstanceOf(RtdbError); // not signed in: nothing sent
    expect(server.requests.some((r) => r.path.startsWith('users'))).toBe(false);
    await a.auth.signInWithGoogle('fake:ann');
    await a.db.put('users/uid-ann/profile', { name: 'Ann' });
    expect(await a.db.get('users/uid-ann/profile/name')).toBe('Ann');
    await expect(a.db.get('users/uid-bob/profile')).rejects.toMatchObject({ status: 401 }); // someone else's
    // Open paths don't carry the token at all (an expired one would be refused even there).
    await a.db.put('lobby/x/y', { m: 'm', ts: 1 });
    expect(await a.db.get('lobby/x/y')).toEqual({ m: 'm', ts: 1 });
    a.auth.signOut();
    await expect(a.auth.token()).resolves.toBeNull();
  });
});

describe('Account (the profile follows the player)', () => {
  const ann = async (p: ReturnType<typeof phone>) => {
    await p.auth.signInWithGoogle('fake:ann');
    await p.account.sync();
  };

  it('the first phone sends its profile up when the account has none', async () => {
    const a = phone();
    a.set({ name: 'Ann', character: 'tones', sound: 'off' });
    await ann(a);
    expect(server.tree().users).toMatchObject({ 'uid-ann': { profile: { name: 'Ann', character: 'tones', sound: 'off', ts: expect.any(Number) } } });
    expect(a.applied()).toBe(0);
  });

  it('a phone that has never synced takes the account’s profile (and says so)', async () => {
    const a = phone();
    a.set({ name: 'Ann', character: 'tones' });
    await ann(a);
    const b = phone();
    b.set({ name: 'Phone B', sound: 'on' });
    await ann(b);
    expect(b.settings()).toMatchObject({ name: 'Ann', character: 'tones', sound: 'on' }); // sound wasn't in the account's: left alone
    expect(b.applied()).toBe(1);
    expect(JSON.parse(b.map.get(LINK_KEY)!)).toMatchObject({ uid: 'uid-ann', dirty: false });
  });

  it('a change goes up soon after, and the other phone picks it up the next time it syncs', async () => {
    const a = phone();
    a.set({ name: 'Ann' });
    await ann(a);
    const b = phone();
    await ann(b);
    a.set({ name: 'Annie' });
    a.account.changed();
    await until(() => (server.tree().users as { 'uid-ann': { profile: { name: string } } })['uid-ann'].profile.name === 'Annie');
    await until(() => !JSON.parse(a.map.get(LINK_KEY)!).dirty);
    await b.account.sync();
    expect(b.settings().name).toBe('Annie');
    expect(b.applied()).toBe(2);
    await b.account.sync(); // nothing new: nothing applied
    expect(b.applied()).toBe(2);
  });

  it('changes made on this phone that haven’t gone up yet win over the account’s newer profile', async () => {
    const a = phone();
    a.set({ name: 'Ann' });
    await ann(a);
    const b = phone();
    await ann(b);
    a.set({ name: 'From A' });
    a.account.changed();
    await until(() => !JSON.parse(a.map.get(LINK_KEY)!).dirty);
    b.auth.signOut(); // B edits while signed out…
    b.set({ name: 'From B' });
    b.account.changed();
    await b.auth.signInWithGoogle('fake:ann'); // …then signs back in
    await b.account.sync();
    expect((server.tree().users as { 'uid-ann': { profile: { name: string } } })['uid-ann'].profile.name).toBe('From B');
  });

  it('another account on the same phone starts fresh from its own profile', async () => {
    const a = phone();
    a.set({ name: 'Ann' });
    await ann(a);
    const bob = phone();
    bob.set({ name: 'Bob' });
    await bob.auth.signInWithGoogle('fake:bob');
    await bob.account.sync();
    a.auth.signOut();
    await a.auth.signInWithGoogle('fake:bob');
    await a.account.sync();
    expect(a.settings().name).toBe('Bob');
  });

  it('never throws when the database is out of reach: it just tries again later', async () => {
    const a = phone();
    a.set({ name: 'Ann' });
    await a.auth.signInWithGoogle('fake:ann');
    const down = new Account(a.auth, new Rtdb('http://127.0.0.1:9', () => a.auth.token()), { read: () => ({ name: 'Ann' }), apply: () => {} }, () => {}, { store: a.storage, pushDelayMs: 5 });
    await down.sync();
    down.changed();
    expect(JSON.parse(a.map.get(LINK_KEY)!).dirty).toBe(true);
  });

  it('while signed out a change is only noted, not sent', async () => {
    const a = phone();
    a.set({ name: 'Ann' });
    a.account.changed();
    await new Promise((r) => setTimeout(r, 80));
    expect(server.requests.length).toBe(0);
    expect(JSON.parse(a.map.get(LINK_KEY)!).dirty).toBe(true);
  });
});

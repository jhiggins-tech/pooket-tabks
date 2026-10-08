import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Auth } from '../src/net/auth';
import { Rtdb } from '../src/net/rtdb';
import type { PlayerRow } from '../src/stats/aggregate';
import { Progress, type Me } from '../src/ui/progress';
import { startRtdb, type FakeRtdb } from './support/rtdb';

let server: FakeRtdb;
const storage = new Map<string, string>();
beforeEach(async () => {
  server = await startRtdb();
  storage.clear();
  Object.assign(globalThis, { localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) } });
});
afterEach(async () => {
  await server.close();
});

/** Ann, signed in against the stand-in (her stats key `a:ann`). */
async function ann(): Promise<Me> {
  const store = new Map<string, string>();
  const auth = new Auth({
    apiKey: 'key',
    signInUrl: `${server.url}/identitytoolkit/signInWithIdp`,
    refreshUrl: `${server.url}/securetoken/token`,
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) },
  });
  await auth.signInWithGoogle('fake:ann');
  return { uid: auth.uid!, key: 'a:ann', db: new Rtdb(server.url, () => auth.token()) };
}

const row = (key: string, characters: Record<string, number>): PlayerRow => ({ key, name: key, verified: true, matches: 1, wins: 1, losses: 0, draws: 0, shots: 0, hits: 0, dealt: 0, taken: 0, kills: 0, characters });
const totals = (xp: number, played: Record<string, number> = {}, updatedAt = 1) => ({
  updatedAt,
  xp: { 'a:ann': xp },
  verified: { matches: 1, turns: 1, endings: {}, players: [row('a:ann', played)], characters: {}, weapons: {} },
});

describe('a signed-in player’s career', () => {
  it('a guest has none: the starter set, no XP, no tokens', () => {
    const p = new Progress(() => null);
    expect(p.access()).toEqual({ signedIn: false, owned: new Set() });
    expect([p.xp(), p.tokens(), p.played(1, 9)]).toEqual([null, 0, null]);
  });

  it('XP from the totals; a match finished here adds at once, until the totals catch up (XP only goes up)', async () => {
    const me = await ann();
    const p = new Progress(() => me);
    p.take(totals(5));
    expect(p.xp()).toBe(5);
    expect(p.played(1, 9)).toEqual({ before: 5, after: 7, score: 1, turns: 9 });
    expect(p.xp()).toBe(7);
    p.take(totals(5, {}, 2)); // the match isn't in the totals yet
    expect(p.xp()).toBe(7);
    p.take(totals(9, {}, 3)); // now it is, and more besides
    expect(p.xp()).toBe(9);
    expect(p.played(0, 2)).toEqual({ before: 9, after: 9, score: 0, turns: 2 }); // over too soon: nothing
    expect(new Progress(() => me).xp()).toBe(9); // (remembered on this phone)
  });

  it('a token every 6×: spent on a character, saved to the account, and theirs from then on', async () => {
    const me = await ann();
    const p = new Progress(() => me);
    p.take(totals(13, { torikloud: 3 })); // two tokens' worth; torikloud played before unlocks came in
    expect(p.access().owned).toEqual(new Set(['torikloud']));
    expect(p.tokens()).toBe(2);
    expect(p.unlockable()).toEqual(['ciarra', 'larinovsky']);
    expect(await p.unlock('kiwicore')).toBe(false); // a beta: not for unlocking
    expect(await p.unlock('ciarra')).toBe(true);
    expect(server.at(`users/${me.uid}/unlocks/ciarra`)).toEqual({ ts: expect.any(Number) });
    expect(p.tokens()).toBe(1);
    expect(p.access().owned).toEqual(new Set(['torikloud', 'ciarra']));
    expect(await p.unlock('ciarra')).toBe(false); // already theirs
    expect(await p.unlock('larinovsky')).toBe(true);
    expect(p.tokens()).toBe(0);
    expect(await p.unlock('torikloud')).toBe(false); // no tokens left (and theirs already)
  });

  it('another phone signed in to the same account gets their unlocks from it', async () => {
    const me = await ann();
    await me.db.put(`users/${me.uid}/unlocks/larinovsky`, { ts: 1 });
    storage.clear();
    const p = new Progress(() => me);
    p.take(totals(6));
    expect(p.access().owned.has('larinovsky')).toBe(false);
    await p.load();
    expect(p.access().owned.has('larinovsky')).toBe(true);
    expect(p.tokens()).toBe(0); // their one token went on larinovsky
  });

  it('testing: everything open, signed in or not', async () => {
    expect(new Progress(() => null, true).access().everything).toBe(true);
    const me = await ann();
    expect(new Progress(() => me, true).access()).toMatchObject({ signedIn: true, everything: true });
  });
});

import { describe, expect, it } from 'vitest';
import { GUEST, LOCK_TEXT, onlineLock, openOnline, STARTERS, unlockable, type Access } from '../src/characters/access';
import { ROSTER } from '../src/characters/roster';

const signedIn = (...owned: string[]): Access => ({ signedIn: true, owned: new Set(owned) });
const open = (a: Access) => ROSTER.filter((c) => !onlineLock(c.id, a)).map((c) => c.id);

describe('who can play which character online', () => {
  it('a guest: just the starter set; the rest say sign in, and betas are hotseat only', () => {
    expect(STARTERS).toEqual(['tones', 'kie', 'kcaj']);
    expect(open(GUEST)).toEqual(['tones', 'kie', 'kcaj']);
    expect(onlineLock('torikloud', GUEST)).toBe('sign-in');
    expect(onlineLock('kiwicore', GUEST)).toBe('beta');
    expect(LOCK_TEXT.beta.short).toBe('Beta: hotseat only');
    expect(LOCK_TEXT['sign-in'].short).toBe('Sign in to unlock');
  });

  it('signed in: the starter set and what they own (unlocked, or played in rated matches before); betas still hotseat only', () => {
    expect(open(signedIn())).toEqual(['tones', 'kie', 'kcaj']);
    expect(onlineLock('ciarra', signedIn())).toBe('locked');
    expect(open(signedIn('ciarra', 'garyoldmancorp'))).toEqual(['tones', 'kie', 'kcaj', 'ciarra']);
    expect(onlineLock('garyoldmancorp', signedIn('garyoldmancorp'))).toBe('beta');
    expect(LOCK_TEXT.locked.long('ciarra')).toBe('Unlock ciarra with an unlock token: you earn one every 600 XP from online matches (+200 a win, +100 a loss).');
  });

  it('what a token could unlock: the locked ones, not betas, not what they have', () => {
    expect(unlockable(signedIn())).toEqual(['torikloud', 'ciarra', 'larinovsky']);
    expect(unlockable(signedIn('ciarra'))).toEqual(['torikloud', 'larinovsky']);
    expect(unlockable(GUEST)).toEqual([]);
  });

  it('testing: everything open, betas included (and so nothing to unlock)', () => {
    const all: Access = { ...GUEST, everything: true };
    expect(open(all)).toEqual(ROSTER.map((c) => c.id));
    expect(unlockable({ ...signedIn(), everything: true })).toEqual([]);
  });

  it('the online pick never falls back to one that’s locked', () => {
    expect(openOnline('ciarra', signedIn('ciarra'))).toBe('ciarra');
    expect(openOnline('ciarra', GUEST)).toBe('tones');
    expect(openOnline('kiwicore', signedIn('kiwicore'))).toBe('tones');
    expect(openOnline('doctorfox', GUEST)).toBe('tones'); // coming soon
    expect(openOnline('nobody', GUEST)).toBe('tones');
    expect(openOnline(null, GUEST)).toBe('tones');
    expect(openOnline('kiwicore', { ...GUEST, everything: true })).toBe('kiwicore');
  });
});

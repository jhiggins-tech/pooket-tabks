import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { localProfile } from '../src/app/localprofile';
import { profileChanges, saveCharacter, saveUsername } from '../src/ui/profile';
import { listPublicly } from '../src/ui/online/prefs';

let map: Map<string, string>;
beforeEach(() => {
  map = new Map();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
});
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('the profile on this phone', () => {
  it('reads what’s saved, and leaves out what isn’t (or isn’t valid)', () => {
    expect(localProfile.read()).toEqual({ name: undefined, character: undefined, sound: undefined, listPublicly: undefined, showPast: undefined });
    saveUsername('  Ann   B ');
    saveCharacter('tones');
    listPublicly(false);
    map.set('pooket-tabks.sound', 'off');
    map.set('pooket.showPast', 'maybe');
    expect(localProfile.read()).toEqual({ name: 'Ann B', character: 'tones', sound: 'off', listPublicly: 'no', showPast: undefined });
  });

  it('applies only what it understands, and an account coming down isn’t a change to send back up', () => {
    let saved = 0;
    const off = profileChanges.on('saved', () => saved++);
    localProfile.apply({ name: ' A very long name indeed ', character: 'not-a-character', sound: 'loud' as 'on', listPublicly: 'yes', showPast: 'no' });
    expect(saved).toBe(0);
    expect(localProfile.read()).toEqual({ name: 'A very long', character: undefined, sound: undefined, listPublicly: 'yes', showPast: 'no' });
    saveUsername('Bo');
    expect(saved).toBe(1);
    off();
  });
});

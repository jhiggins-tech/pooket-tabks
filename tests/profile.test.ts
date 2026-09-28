import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanName, loadUsername, saveUsername, USERNAME_KEY } from '../src/ui/profile';

describe('usernames', () => {
  it('are tidied: trimmed, single-spaced, no control characters, at most 12 long', () => {
    expect(cleanName('  Jack   Higgins ')).toBe('Jack Higgins');
    expect(cleanName('a\u0000b\nc')).toBe('ab c');
    expect(cleanName('Supercalifragilistic')).toBe('Supercalifra');
    expect(cleanName('abcdefghijk  xyz')).toBe('abcdefghijk'); // no trailing space after the cut
    expect(cleanName('   ')).toBe('');
  });

  describe('in storage', () => {
    let store: Map<string, string>;
    beforeEach(() => {
      store = new Map();
      Object.assign(globalThis, {
        localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
      });
    });
    afterEach(() => {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    });

    it('none yet: ask for one', () => {
      expect(loadUsername()).toBeNull();
    });

    it('saves a tidied name, and a blank one is refused', () => {
      expect(saveUsername('  Ann ')).toBe('Ann');
      expect(store.get(USERNAME_KEY)).toBe('Ann');
      expect(loadUsername()).toBe('Ann');
      expect(saveUsername('   ')).toBeNull();
      expect(loadUsername()).toBe('Ann');
    });

    it('a mangled stored name is cleaned up, and an empty one counts as none', () => {
      store.set(USERNAME_KEY, '  Bo\n ');
      expect(loadUsername()).toBe('Bo');
      store.set(USERNAME_KEY, '  ');
      expect(loadUsername()).toBeNull();
    });
  });

  it("without storage (private mode) there's just no saved name", () => {
    expect(loadUsername()).toBeNull();
    expect(saveUsername('Cy')).toBe('Cy'); // lasts the visit
  });
});

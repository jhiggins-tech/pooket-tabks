import { describe, expect, it } from 'vitest';
import { CHANGELOG, LATEST, unseenReleases, type Release } from '../src/ui/whatsnew';

describe("what's new", () => {
  it('lists releases newest first, one version apart (bar 48, withdrawn), each with something to say', () => {
    expect(LATEST).toBe(CHANGELOG[0]!.version);
    // Phones that saw the withdrawn 48 remember it: anything new has to come after it.
    expect(LATEST === 47 || LATEST >= 49).toBe(true);
    CHANGELOG.forEach((r, i) => {
      if (i > 0) expect(r.version).toBe(CHANGELOG[i - 1]!.version - (CHANGELOG[i - 1]!.version === 49 ? 2 : 1));
      expect(r.title).not.toBe('');
      expect(r.items.length).toBeGreaterThan(0);
    });
  });

  it('shows a first-time visitor just the latest release', () => {
    expect(unseenReleases(null)).toEqual([CHANGELOG[0]]);
  });

  it('shows everything newer than what this phone last saw, and nothing once it is up to date', () => {
    const log: Release[] = [3, 2, 1].map((version) => ({ version, title: `v${version}`, items: ['x'] }));
    expect(unseenReleases(1, log).map((r) => r.version)).toEqual([3, 2]);
    expect(unseenReleases(2, log).map((r) => r.version)).toEqual([3]);
    expect(unseenReleases(3, log)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { LOCK_TEXT, onlineLock, openOnline } from '../src/characters/access';
import { ROSTER } from '../src/characters/roster';

describe('who can play which character online', () => {
  it('betas are hotseat only; everyone else can be played online', () => {
    expect(ROSTER.filter((c) => onlineLock(c.id) === 'beta').map((c) => c.id)).toEqual(['garyoldmancorp', 'kiwicore']);
    expect(ROSTER.filter((c) => !onlineLock(c.id)).map((c) => c.id)).toEqual(['tones', 'kie', 'kcaj', 'torikloud', 'ciarra', 'larinovsky']);
    expect(LOCK_TEXT.beta.short).toBe('Beta: hotseat only');
  });

  it('the online pick never falls back to one that can’t be played online', () => {
    expect(openOnline('ciarra')).toBe('ciarra');
    expect(openOnline('kiwicore')).toBe('tones');
    expect(openOnline('garyoldmancorp')).toBe('tones');
    expect(openOnline('doctorfox')).toBe('tones'); // coming soon
    expect(openOnline('nobody')).toBe('tones');
    expect(openOnline(null)).toBe('tones');
  });
});

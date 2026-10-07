import { describe, expect, it } from 'vitest';
import { netLog, netLogText } from '../src/net/log';

describe('network log', () => {
  it('keeps timestamped lines under a header', () => {
    netLog('hello', { a: 1 });
    const text = netLogText();
    expect(text).toMatch(/^Pooket Tabks network log/);
    expect(text).toMatch(/\d+\.\d\d {2}hello {"a":1}/);
  });
});

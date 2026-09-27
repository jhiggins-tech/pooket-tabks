import { describe, expect, it } from 'vitest';
import { maskAddress, netLog, netLogText } from '../src/net/log';

describe('network log', () => {
  it('masks addresses so a log is safe to paste', () => {
    expect(maskAddress('203.0.113.77')).toBe('203.0.x.x');
    expect(maskAddress('192.168.1.23')).toBe('192.168.x.x (private)');
    expect(maskAddress('0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0.local')).toBe('mdns:0f1e…');
    expect(maskAddress('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8:…(v6)');
  });

  it('keeps timestamped lines under a header', () => {
    netLog('hello', { a: 1 });
    const text = netLogText();
    expect(text).toMatch(/^Pooket Tabks network log/);
    expect(text).toMatch(/\d+\.\d\d {2}hello {"a":1}/);
  });
});

import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { encodeQr, type Ecl } from '../src/net/qr';

/** Render a QR matrix to pixels (4px modules, 4-module quiet zone) and decode it with a real decoder. */
function scan(m: boolean[][]): string | null {
  const scale = 4;
  const n = (m.length + 8) * scale;
  const px = new Uint8ClampedArray(n * n * 4).fill(255);
  m.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + 4) * scale + dy) * n + (x + 4) * scale + dx) * 4;
          px[i] = px[i + 1] = px[i + 2] = 0;
        }
      }
    }),
  );
  return jsQR(px, n, n)?.data ?? null;
}

describe('QR encoder', () => {
  it('encodes a real join link that a decoder reads back exactly', () => {
    const link = 'https://jhiggins-tech.github.io/pooket-tabks/#join=1~o~Es8C~5SkPOKNxIgQ92d-bsaJdVJAd~bKx2VmjfI0hcpqo3C4ImlatFsva09tITGjf0PpsRSMY~x~h,b9ccdcee-c5dd-4d97-9ab7-de04c9df2556.local,44758';
    const m = encodeQr(link);
    expect(m.length).toBeLessThanOrEqual(61); // version 10 or smaller: easy to scan off a phone
    expect(scan(m)).toBe(link);
  });

  it('round-trips every length across versions 1–20, at both error-correction levels', () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789~-_.,*:/#=';
    const versions = new Set<number>();
    for (const ecl of ['L', 'M'] as Ecl[]) {
      for (let len = 1; len <= 500; len += ecl === 'L' ? 7 : 11) {
        const text = Array.from({ length: len }, (_, i) => chars[(i * 7 + len) % chars.length]).join('');
        let m: boolean[][];
        try {
          m = encodeQr(text, ecl);
        } catch {
          continue; // beyond version 20
        }
        versions.add((m.length - 17) / 4);
        expect(scan(m), `${ecl} ${len}`).toBe(text);
      }
    }
    expect(versions.size).toBeGreaterThanOrEqual(15);
  });

  it('refuses data that is too long', () => {
    expect(() => encodeQr('x'.repeat(2000))).toThrow();
  });
});

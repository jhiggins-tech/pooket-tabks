

/** Small maths and colour helpers. */

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mix a '#rrggbb' colour towards white by k (0–1), returned as '#rrggbb'. */
export function tint(hex: string, k: number): string {
  const mix = (c: number) => Math.round(c + (255 - c) * k);
  return '#' + hexToRgb(hex).map((c) => mix(c).toString(16).padStart(2, '0')).join('');
}

/** Cheap deterministic 0–1 hash. */
export function hash(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Aim wraps all the way round: any angle maps to [0, 360). 0 = right, 90 = up, 270 = straight down. */
export function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

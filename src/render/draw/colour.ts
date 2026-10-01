

/** Colour and noise helpers for drawing. */

/** '#rrggbb' + alpha → rgba() */
export function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Darken a '#rrggbb' colour by factor k (0–1). */
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${((n >> 16) & 255) * k},${((n >> 8) & 255) * k},${(n & 255) * k})`;
}

/** Mix a '#rrggbb' colour towards white by k (0–1). */
export function tint(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * k);
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

/** Cheap 0–1 hash for cosmetic jitter. */
export function noise(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** A soft disc of radius `r` at (x, y): a radial gradient (from `inner` px out) through `stops`. */
export function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, stops: readonly (readonly [number, string])[], inner = 0): void {
  const g = ctx.createRadialGradient(x, y, inner, x, y, r);
  for (const [at, colour] of stops) g.addColorStop(at, colour);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

import type { Rng } from './rng';

interface Octave {
  cells: number;
  amplitude: number;
}

const OCTAVES: Octave[] = [
  { cells: 3, amplitude: 0.34 },
  { cells: 7, amplitude: 0.14 },
  { cells: 19, amplitude: 0.04 },
];

/** Rolling hills from layered 1D value noise. Returns surface y per column. */
export function generateHeights(rng: Rng, width: number, height: number): Float32Array {
  const heights = new Float32Array(width).fill(height * 0.6);
  for (const { cells, amplitude } of OCTAVES) {
    const knots = Array.from({ length: cells + 2 }, () => rng() - 0.5);
    for (let x = 0; x < width; x++) {
      const f = (x / width) * cells;
      const i = Math.floor(f);
      const t = (1 - Math.cos((f - i) * Math.PI)) / 2;
      const v = (knots[i] ?? 0) * (1 - t) + (knots[i + 1] ?? 0) * t;
      heights[x]! += v * amplitude * height;
    }
  }
  for (let x = 0; x < width; x++) {
    heights[x] = Math.min(height * 0.9, Math.max(height * 0.28, heights[x]!));
  }
  return heights;
}

/** Level a small pad so a tank spawns on flat ground. */
export function flattenAround(heights: Float32Array, cx: number, halfWidth: number): void {
  const x0 = Math.max(0, Math.floor(cx - halfWidth));
  const x1 = Math.min(heights.length - 1, Math.ceil(cx + halfWidth));
  const level = heights[Math.round(cx)] ?? 0;
  for (let x = x0; x <= x1; x++) heights[x] = level;
}

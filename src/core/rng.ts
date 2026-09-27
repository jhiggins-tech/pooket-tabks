/**
 * Seeded PRNG (mulberry32). Deterministic so a seed reproduces a whole map. Its whole state is one
 * number (`state`), so it can be saved and restored (network snapshots).
 */
export type Rng = (() => number) & { state: number };

export function createRng(seed: number): Rng {
  const rng = (() => {
    rng.state = (rng.state + 0x6d2b79f5) >>> 0;
    let t = rng.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  rng.state = seed >>> 0;
  return rng;
}

export function randRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

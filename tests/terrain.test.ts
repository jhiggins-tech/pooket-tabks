import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { Terrain } from '../src/core/terrain';
import { generateHeights } from '../src/core/terrainGen';

function flat(width: number, height: number, surface: number): Terrain {
  return Terrain.fromHeights(new Float32Array(width).fill(surface), width, height, createRng(1));
}

describe('generateHeights', () => {
  it('is deterministic for a given seed', () => {
    const a = generateHeights(createRng(42), 300, 200);
    const b = generateHeights(createRng(42), 300, 200);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('differs between seeds and stays within bounds', () => {
    const a = generateHeights(createRng(1), 300, 200);
    const b = generateHeights(createRng(2), 300, 200);
    expect(Array.from(a)).not.toEqual(Array.from(b));
    for (const h of a) {
      expect(h).toBeGreaterThanOrEqual(200 * 0.28);
      expect(h).toBeLessThanOrEqual(200 * 0.9);
    }
  });
});

describe('Terrain', () => {
  it('fills solid from the surface down', () => {
    const t = flat(50, 40, 20);
    expect(t.isSolid(10, 19)).toBe(false);
    expect(t.isSolid(10, 20)).toBe(true);
    expect(t.surfaceY(10)).toBe(20);
  });

  it('treats off-map sides as air and below the map as bedrock', () => {
    const t = flat(50, 40, 20);
    expect(t.isSolid(-1, 30)).toBe(false);
    expect(t.isSolid(50, 30)).toBe(false);
    expect(t.isSolid(10, -5)).toBe(false);
    expect(t.isSolid(10, 40)).toBe(true);
  });

  it('carves a circular crater and reports a dirty rect', () => {
    const t = flat(100, 60, 20);
    t.takeDirty();
    const removed = t.carveCircle(50, 20, 10);
    expect(removed).toBeGreaterThan(100);
    expect(t.isSolid(50, 25)).toBe(false);
    expect(t.isSolid(50, 31)).toBe(true);
    expect(t.isSolid(30, 25)).toBe(true);
    expect(t.surfaceY(50)).toBe(30);
    const dirty = t.takeDirty();
    expect(dirty).not.toBeNull();
    expect(dirty!.x).toBeLessThanOrEqual(40);
    expect(dirty!.x + dirty!.w).toBeGreaterThanOrEqual(60);
    expect(t.takeDirty()).toBeNull();
  });

  it('keeps pixel alpha in sync with the solid mask', () => {
    const t = flat(20, 20, 5);
    t.carveCircle(10, 10, 3);
    for (let i = 0; i < t.solid.length; i++) {
      expect(t.pixels[i * 4 + 3]).toBe(t.solid[i] ? 255 : 0);
    }
  });
});

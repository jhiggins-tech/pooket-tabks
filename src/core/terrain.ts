import type { Rng } from './rng';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Destructible terrain as a per-pixel solid mask plus an RGBA buffer for drawing.
 * `solid` is the source of truth; `pixels` mirrors it (alpha 0 = empty) so the
 * renderer can blit only the dirty region after each change.
 */
export class Terrain {
  readonly solid: Uint8Array;
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
  /** Soil darkened by water (cosmetic). */
  private readonly wet: Uint8Array;
  private dirty: Rect | null = null;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.solid = new Uint8Array(width * height);
    this.pixels = new Uint8ClampedArray(width * height * 4);
    this.wet = new Uint8Array(width * height);
  }

  /** Build terrain from surface heights (y of the topmost solid pixel per column). */
  static fromHeights(heights: ArrayLike<number>, width: number, height: number, rng: Rng): Terrain {
    const t = new Terrain(width, height);
    for (let x = 0; x < width; x++) {
      const top = Math.max(0, Math.ceil(heights[x] ?? height));
      for (let y = top; y < height; y++) {
        const i = y * width + x;
        t.solid[i] = 1;
        const [r, g, b] = soilColour(y - top, rng);
        const p = i * 4;
        t.pixels[p] = r;
        t.pixels[p + 1] = g;
        t.pixels[p + 2] = b;
        t.pixels[p + 3] = 255;
      }
    }
    t.dirty = { x: 0, y: 0, w: width, h: height };
    return t;
  }

  /** Off the sides or above the map is open air; below the map is bedrock. */
  isSolid(x: number, y: number): boolean {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    if (xi < 0 || xi >= this.width || yi < 0) return false;
    if (yi >= this.height) return true;
    return this.solid[yi * this.width + xi] === 1;
  }

  /** Y of the topmost solid pixel in a column (height if the column is empty). */
  surfaceY(x: number): number {
    return this.groundBelow(x, 0);
  }

  /** First solid y at or below `fromY` in column x (height = bedrock). */
  groundBelow(x: number, fromY: number): number {
    const xi = Math.min(this.width - 1, Math.max(0, Math.floor(x)));
    for (let y = Math.max(0, Math.floor(fromY)); y < this.height; y++) {
      if (this.solid[y * this.width + xi] === 1) return y;
    }
    return this.height;
  }

  /**
   * Approximate outward surface normal near (x, y): the average direction from nearby
   * solid pixels towards open air. Straight up if the area is uniformly solid.
   */
  normalAt(x: number, y: number, r = 4): { x: number; y: number } {
    let nx = 0;
    let ny = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        if (this.isSolid(x + dx, y + dy)) {
          nx -= dx;
          ny -= dy;
        }
      }
    }
    const len = Math.hypot(nx, ny);
    return len < 1e-6 ? { x: 0, y: -1 } : { x: nx / len, y: ny / len };
  }

  /** Darken the soil within radius r where liquid lands, tinted towards its colour. Cosmetic; each pixel wets once. */
  wetCircle(cx: number, cy: number, r: number, tint: readonly [number, number, number] = [60, 140, 220]): void {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + r));
    let changed = false;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r * r) continue;
        const i = y * this.width + x;
        if (this.solid[i] === 0 || this.wet[i] === 1) continue;
        this.wet[i] = 1;
        const p = i * 4;
        this.pixels[p] = this.pixels[p]! * 0.6 + tint[0] * 0.14;
        this.pixels[p + 1] = this.pixels[p + 1]! * 0.6 + tint[1] * 0.14;
        this.pixels[p + 2] = this.pixels[p + 2]! * 0.6 + tint[2] * 0.14;
        changed = true;
      }
    }
    if (changed) this.markDirty({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }

  /** Fill empty pixels within radius r with new dirt of roughly the given colour. Returns pixels added. */
  addDirt(cx: number, cy: number, r: number, rgb: readonly [number, number, number]): number {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + r));
    let added = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r * r) continue;
        const i = y * this.width + x;
        if (this.solid[i] === 1) continue;
        this.solid[i] = 1;
        this.wet[i] = 1; // new dirt is already its own colour
        // Deterministic speckle so piles look granular.
        const n = (((x * 73856093) ^ (y * 19349663)) >>> 0) % 29;
        const k = n < 3 ? 1.45 : 0.7 + n / 60; // granular, with the odd wet glint
        const p = i * 4;
        this.pixels[p] = rgb[0] * k;
        this.pixels[p + 1] = rgb[1] * k;
        this.pixels[p + 2] = rgb[2] * k;
        this.pixels[p + 3] = 255;
        added++;
      }
    }
    if (added > 0) this.markDirty({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
    return added;
  }

  isWet(x: number, y: number): boolean {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    if (xi < 0 || xi >= this.width || yi < 0 || yi >= this.height) return false;
    return this.wet[yi * this.width + xi] === 1;
  }

  /** Remove all solid pixels within radius r of (cx, cy). Returns pixels removed. */
  carveCircle(cx: number, cy: number, r: number): number {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + r));
    if (x0 > x1 || y0 > y1) return 0;
    const r2 = r * r;
    let removed = 0;
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        if (dx * dx + dy * dy > r2) continue;
        const i = y * this.width + x;
        if (this.solid[i] === 0) continue;
        this.solid[i] = 0;
        this.pixels[i * 4 + 3] = 0;
        removed++;
      }
    }
    if (removed > 0) this.markDirty({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
    return removed;
  }

  /** Returns and clears the region changed since the last call. */
  takeDirty(): Rect | null {
    const d = this.dirty;
    this.dirty = null;
    return d;
  }

  private markDirty(r: Rect): void {
    if (!this.dirty) {
      this.dirty = r;
      return;
    }
    const d = this.dirty;
    const x0 = Math.min(d.x, r.x);
    const y0 = Math.min(d.y, r.y);
    const x1 = Math.max(d.x + d.w, r.x + r.w);
    const y1 = Math.max(d.y + d.h, r.y + r.h);
    this.dirty = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
}

function soilColour(depth: number, rng: Rng): [number, number, number] {
  const n = (rng() - 0.5) * 14;
  if (depth < 5) return [88 + n, 170 + n, 64 + n];
  const shade = 1 - Math.min(depth / 260, 0.5);
  return [(146 + n) * shade, (98 + n) * shade, (56 + n) * shade];
}

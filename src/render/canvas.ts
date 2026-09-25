import type { Terrain } from '../core/terrain';
import { BARREL_LENGTH, TANK_BODY_HEIGHT, TANK_HALF_WIDTH } from '../game/constants';
import { currentPlayer, hologramsOf, isAimless, muzzle, tankCentre } from '../game/game';
import type { Droplet, GameState, Player, Projectile } from '../game/state';
import { getWeapon } from '../weapons/registry';
import { loadSprites } from './sprites';

const MAX_DPR = 2; // Cap backing-store size so older phones keep 60fps.

/**
 * Draws the fixed-size world scaled to fit (letterboxed) a full-screen canvas,
 * at device pixel ratio for crisp output on phone screens.
 */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly terrainCanvas = document.createElement('canvas');
  private readonly terrainCtx: CanvasRenderingContext2D;
  private terrain: Terrain | null = null;
  private terrainImage: ImageData | null = null;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private dpr = 1;
  private time = 0;
  private readonly sprites = loadSprites();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly worldW: number,
    private readonly worldH: number,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.terrainCanvas.width = worldW;
    this.terrainCanvas.height = worldH;
    this.terrainCtx = this.terrainCanvas.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.scale = Math.min(this.canvas.width / this.worldW, this.canvas.height / this.worldH);
    this.offsetX = (this.canvas.width - this.worldW * this.scale) / 2;
    this.offsetY = (this.canvas.height - this.worldH * this.scale) / 2;
  }

  /** Converts a screen (CSS pixel) position to world coordinates. */
  screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    return {
      x: (clientX * this.dpr - this.offsetX) / this.scale,
      y: (clientY * this.dpr - this.offsetY) / this.scale,
    };
  }

  /** Converts world coordinates to a screen (CSS pixel) position. */
  worldToScreen(x: number, y: number): { x: number; y: number } {
    return {
      x: (x * this.scale + this.offsetX) / this.dpr,
      y: (y * this.scale + this.offsetY) / this.dpr,
    };
  }

  /** CSS pixels per world pixel, for sizing touch gestures. */
  get cssScale(): number {
    return this.scale / this.dpr;
  }

  setTerrain(terrain: Terrain): void {
    this.terrain = terrain;
    this.terrainImage = new ImageData(terrain.pixels, terrain.width, terrain.height);
    this.terrainCtx.clearRect(0, 0, this.worldW, this.worldH);
    terrain.takeDirty();
    this.terrainCtx.putImageData(this.terrainImage, 0, 0);
  }

  draw(state: GameState, dt: number): void {
    this.time += dt;
    if (this.terrain !== state.terrain) this.setTerrain(state.terrain);
    this.syncTerrain();

    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const sky = ctx.createLinearGradient(0, 0, 0, this.canvas.height);
    sky.addColorStop(0, '#1b2440');
    sky.addColorStop(0.6, '#3d5a8a');
    sky.addColorStop(1, '#8fb3d9');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.setTransform(this.scale, 0, 0, this.scale, this.offsetX, this.offsetY);
    ctx.drawImage(this.terrainCanvas, 0, 0);
    // Stretch the edge columns into any side letterbox so hills run to the screen edge.
    const side = this.offsetX / this.scale;
    if (side > 0) {
      const h = this.worldH;
      ctx.drawImage(this.terrainCanvas, 0, 0, 1, h, -side, 0, side, h);
      ctx.drawImage(this.terrainCanvas, this.worldW - 1, 0, 1, h, this.worldW, 0, side + 1, h);
    }

    for (const p of state.players) {
      // Holograms are drawn exactly like the real tank, so there is no visual tell.
      for (const h of hologramsOf(state, p.id)) {
        this.drawTank(p, state, h);
        if (state.swapTargetId === h.id && state.phase === 'aiming' && currentPlayer(state) === p) this.drawSwapMarker(h);
      }
      this.drawTank(p, state);
    }
    if (state.phase === 'aiming' && !isAimless(state)) this.drawAimGuide(currentPlayer(state));
    this.drawProjectiles(state);
    this.drawLiquid(state);
    this.drawBeams(state);
    this.drawExplosions(state);
    this.drawFloaters(state);

    // Bedrock strip below the world when the screen is taller than 2.2:1.
    if (this.offsetY > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#2a1c10';
      ctx.fillRect(0, this.offsetY + this.worldH * this.scale, this.canvas.width, this.offsetY + 1);
    }
  }

  private syncTerrain(): void {
    const d = this.terrain?.takeDirty();
    if (d && this.terrainImage) {
      this.terrainCtx.putImageData(this.terrainImage, 0, 0, d.x, d.y, d.w, d.h);
    }
  }

  /** Draws player p's tank, or (with `at`) a hologram copy of it at another spot. */
  private drawTank(owner: Player, state: GameState, at?: { x: number; y: number }): void {
    const { ctx } = this;
    const p: Player = at ? { ...owner, x: at.x, y: at.y } : owner;
    const c = tankCentre(p);
    const isCurrent = !at && state.players[state.current] === owner && state.phase !== 'gameover';

    if (p.burn && p.alive) {
      // Pulsing glow while a Hyperfixate burn is still ticking.
      const pulse = 0.55 + 0.45 * Math.sin(this.time * 8);
      const g = ctx.createRadialGradient(c.x, c.y, 2, c.x, c.y, 22);
      g.addColorStop(0, withAlpha(p.burn.colour, 0.55 * pulse));
      g.addColorStop(1, withAlpha(p.burn.colour, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 22, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.globalAlpha = p.alive ? 1 : 0.35;

    // Barrel
    const m = muzzle(p);
    ctx.strokeStyle = '#1c1c1c';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(m.x, m.y);
    ctx.stroke();

    // Dome + hull
    ctx.fillStyle = p.colour;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 7, Math.PI, 0);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(p.x - TANK_HALF_WIDTH, p.y - TANK_BODY_HEIGHT, TANK_HALF_WIDTH * 2, TANK_BODY_HEIGHT, 3);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    if (isCurrent && state.phase === 'aiming') {
      const bob = Math.sin(this.time * 6) * 3;
      const y = c.y - BARREL_LENGTH - 16 + bob;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(p.x - 7, y - 8);
      ctx.lineTo(p.x + 7, y - 8);
      ctx.lineTo(p.x, y);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** Subtle dashed ring on the hologram the current player will swap to. */
  private drawSwapMarker(at: { x: number; y: number }): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 4]);
    ctx.lineDashOffset = -this.time * 12;
    ctx.beginPath();
    ctx.arc(at.x, at.y - TANK_BODY_HEIGHT, 17, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawAimGuide(p: Player): void {
    const { ctx } = this;
    const m = muzzle(p);
    const a = (p.angle * Math.PI) / 180;
    const len = 20 + p.power * 1.2;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x + Math.cos(a) * len, m.y - Math.sin(a) * len);
    ctx.stroke();
    ctx.restore();
  }

  private drawProjectiles(state: GameState): void {
    const { ctx } = this;
    for (const pr of state.projectiles) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      pr.trail.forEach((t, i) => {
        if (i % 3) return;
        ctx.beginPath();
        ctx.arc(t.x, t.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      });
      if (!this.drawSprite(pr)) {
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** Draws the weapon's sprite rotated along the velocity. Returns false if there isn't one (yet). */
  private drawSprite(pr: Projectile): boolean {
    const id = getWeapon(pr.weaponId).sprite;
    const sprite = id && this.sprites[id];
    if (!sprite || !sprite.image.complete || sprite.image.naturalWidth === 0) return false;
    const { ctx } = this;
    ctx.save();
    ctx.translate(pr.x, pr.y);
    ctx.rotate(Math.atan2(pr.vy, pr.vx));
    // Anchor near the tip so the sprite's nose sits on the collision point.
    ctx.drawImage(sprite.image, -sprite.width * 0.85, -sprite.height / 2, sprite.width, sprite.height);
    ctx.restore();
    return true;
  }

  /**
   * Water jets: consecutive droplets from the same stream are joined into one continuous,
   * pressure-thickened ribbon (glow, body, core, highlight), breaking into beads where they separate.
   */
  private drawLiquid(state: GameState): void {
    const { ctx } = this;
    const drops = state.droplets;
    if (drops.length === 0 && state.splashes.length === 0) return;
    const colour = drops[0]?.colour ?? state.splashes[0]?.colour ?? '#3fb6ff';
    const width = (d: Droplet) => 1.5 + 5.5 * d.pressure;
    const JOIN_DIST = 14;

    // Link each droplet to the previous one in emission order if they're still close.
    const linked: boolean[] = new Array(drops.length).fill(false);
    const joins: [Droplet, Droplet][] = [];
    for (let i = 1; i < drops.length; i++) {
      const a = drops[i - 1]!;
      const b = drops[i]!;
      if (a.streamId === b.streamId && Math.hypot(a.x - b.x, a.y - b.y) < JOIN_DIST) {
        joins.push([a, b]);
        linked[i - 1] = linked[i] = true;
      }
    }

    const passes = [
      { style: withAlpha(colour, 0.18), scale: 2.4, dy: 0 },
      { style: shade(colour, 0.55), scale: 1, dy: 0 },
      { style: colour, scale: 0.62, dy: -0.15 },
      { style: 'rgba(255,255,255,0.75)', scale: 0.22, dy: -0.45 },
    ];
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const pass of passes) {
      // Bucket segments by thickness so each pass is a handful of strokes, not hundreds.
      const buckets = new Map<number, [Droplet, Droplet][]>();
      for (const j of joins) {
        const w = Math.round(Math.min(width(j[0]), width(j[1])) * 2) / 2;
        let list = buckets.get(w);
        if (!list) buckets.set(w, (list = []));
        list.push(j);
      }
      ctx.strokeStyle = pass.style;
      for (const [w, list] of buckets) {
        ctx.lineWidth = w * pass.scale;
        const off = w * pass.dy;
        ctx.beginPath();
        for (const [a, b] of list) {
          ctx.moveTo(a.x, a.y + off);
          ctx.lineTo(b.x, b.y + off);
        }
        ctx.stroke();
      }
      // Loose beads
      ctx.fillStyle = pass.style;
      ctx.beginPath();
      drops.forEach((d, i) => {
        if (linked[i]) return;
        const r = Math.max(0.6, (width(d) * pass.scale) / 2);
        ctx.moveTo(d.x + r, d.y + width(d) * pass.dy);
        ctx.arc(d.x, d.y + width(d) * pass.dy, r, 0, Math.PI * 2);
      });
      ctx.fill();
    }

    // Spray
    for (const sp of state.splashes) {
      ctx.globalAlpha = 1 - sp.age / sp.life;
      ctx.fillStyle = tint(sp.colour, 0.45);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawBeams(state: GameState): void {
    const { ctx } = this;
    ctx.save();
    ctx.lineCap = 'round';
    for (const b of state.beams) {
      const k = b.age / b.duration;
      const fade = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      const flicker = 0.85 + 0.15 * Math.sin(this.time * 90);
      ctx.globalAlpha = fade * flicker;
      ctx.strokeStyle = withAlpha(b.colour, 0.35);
      ctx.lineWidth = 9;
      this.line(b.x1, b.y1, b.x2, b.y2);
      ctx.strokeStyle = b.colour;
      ctx.lineWidth = 3.5;
      this.line(b.x1, b.y1, b.x2, b.y2);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.2;
      this.line(b.x1, b.y1, b.x2, b.y2);
      // Impact flare
      const g = ctx.createRadialGradient(b.x2, b.y2, 0, b.x2, b.y2, b.hitTank ? 16 : 10);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.4, withAlpha(b.colour, 0.8));
      g.addColorStop(1, withAlpha(b.colour, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x2, b.y2, b.hitTank ? 16 : 10, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private line(x1: number, y1: number, x2: number, y2: number): void {
    this.ctx.beginPath();
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(x2, y2);
    this.ctx.stroke();
  }

  private drawFloaters(state: GameState): void {
    const { ctx } = this;
    ctx.save();
    ctx.font = '800 15px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const f of state.floaters) {
      const k = f.age / f.duration;
      ctx.globalAlpha = k < 0.35 ? 1 : Math.max(0, 1 - (k - 0.35) / 0.65);
      const scale = 0.8 + 0.4 * Math.min(1, k * 6); // quick pop-in
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.scale(scale, scale);
      ctx.strokeStyle = 'rgba(10,12,24,0.85)';
      ctx.lineWidth = 3.5;
      ctx.strokeText(f.text, 0, 0);
      ctx.fillStyle = f.colour;
      ctx.fillText(f.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  private drawExplosions(state: GameState): void {
    const { ctx } = this;
    for (const e of state.explosions) {
      const k = e.age / e.duration;
      if (e.ring) {
        // Hologram shimmer: a couple of expanding, fading rings with scan lines.
        ctx.save();
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = e.ring;
        ctx.lineWidth = 2;
        for (const f of [1, 0.6]) {
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.radius * (0.3 + k * f), 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 0.5 * (1 - k);
        ctx.fillStyle = e.ring;
        for (let yy = -12; yy <= 8; yy += 4) ctx.fillRect(e.x - 14, e.y + yy + ((this.time * 40) % 4), 28, 1);
        ctx.restore();
        continue;
      }
      const r = e.radius * (0.5 + 0.7 * k);
      const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
      g.addColorStop(0, `rgba(255,245,200,${1 - k})`);
      g.addColorStop(0.4, `rgba(255,160,40,${0.9 * (1 - k)})`);
      g.addColorStop(1, 'rgba(200,40,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** '#rrggbb' + alpha → rgba() */
function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Darken a '#rrggbb' colour by factor k (0–1). */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${((n >> 16) & 255) * k},${((n >> 8) & 255) * k},${(n & 255) * k})`;
}

/** Mix a '#rrggbb' colour towards white by k (0–1). */
function tint(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * k);
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

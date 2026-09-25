import type { Terrain } from '../core/terrain';
import { BARREL_LENGTH, TANK_BODY_HEIGHT, TANK_HALF_WIDTH } from '../game/constants';
import { currentPlayer, muzzle, tankCentre } from '../game/game';
import type { GameState, Player, Projectile } from '../game/state';
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

    for (const p of state.players) this.drawTank(p, state);
    if (state.phase === 'aiming') this.drawAimGuide(currentPlayer(state));
    this.drawProjectiles(state);
    this.drawExplosions(state);

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

  private drawTank(p: Player, state: GameState): void {
    const { ctx } = this;
    const c = tankCentre(p);
    const isCurrent = state.players[state.current] === p && state.phase !== 'gameover';

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

  private drawExplosions(state: GameState): void {
    const { ctx } = this;
    for (const e of state.explosions) {
      const k = e.age / e.duration;
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

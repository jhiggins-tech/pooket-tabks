import type { Terrain } from '../core/terrain';
import type { GameState } from '../game/state';
import type { Draw } from './draw/context';
import { drawCoffee } from './draw/coffee';
import { drawGhosts, drawHologramBlasts } from './draw/copies';
import { drawExplosions, drawFloaters } from './draw/fx';
import { drawPuddles, drawSludge } from './draw/gunk';
import { drawNapCats } from './draw/nap';
import { drawBeams, drawProjectiles } from './draw/projectiles';
import { drawRunners } from './draw/runner';
import { drawStitches } from './draw/sew';
import { drawApparitions } from './draw/sky';
import { drawBooms } from './draw/sonic';
import { drawHeist } from './draw/steal';
import { drawLiquid } from './draw/stream';
import { drawAim, drawTanks } from './draw/tank';
import { loadSprites } from './sprites';

const MAX_DPR = 2; // Cap backing-store size so older phones keep 60fps.

/** Something drawn every frame from the game state, in world coordinates. */
type Layer = (d: Draw, state: GameState) => void;

/** Drawn in the sky, behind the hills. */
const BACKDROP: Layer[] = [drawApparitions];

/** Drawn over the terrain, back to front: the order is the layering (like STEPPERS for the simulation). */
const LAYERS: Layer[] = [
  drawPuddles,
  drawSludge, // behind the tanks so the jet flame stays visible
  drawTanks,
  drawCoffee,
  drawNapCats,
  drawGhosts,
  drawAim,
  drawProjectiles,
  drawStitches,
  drawRunners,
  drawLiquid,
  drawBeams,
  drawBooms,
  drawExplosions,
  drawHologramBlasts,
  drawHeist,
  drawFloaters,
];

/**
 * Draws the fixed-size world scaled to fit (letterboxed) a full-screen canvas,
 * at device pixel ratio for crisp output on phone screens.
 */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  /** What the draw functions (./draw/) draw with. */
  private readonly d: Draw;
  private readonly terrainCanvas = document.createElement('canvas');
  private readonly terrainCtx: CanvasRenderingContext2D;
  private terrain: Terrain | null = null;
  private terrainImage: ImageData | null = null;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private dpr = 1;
  /** The sky (made when the canvas is sized). */
  private sky!: CanvasGradient;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly worldW: number,
    private readonly worldH: number,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.d = { ctx: this.ctx, time: 0, sprites: loadSprites(), rides: new Map() };
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
    this.sky = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);
    this.sky.addColorStop(0, '#1b2440');
    this.sky.addColorStop(0.6, '#3d5a8a');
    this.sky.addColorStop(1, '#8fb3d9');
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
    this.d.time += dt;
    if (this.terrain !== state.terrain) this.setTerrain(state.terrain);
    this.syncTerrain();

    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.sky;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.setTransform(this.scale, 0, 0, this.scale, this.offsetX, this.offsetY);
    for (const draw of BACKDROP) draw(this.d, state);
    ctx.drawImage(this.terrainCanvas, 0, 0);
    // Stretch the edge columns into any side letterbox so hills run to the screen edge.
    const side = this.offsetX / this.scale;
    if (side > 0) {
      const h = this.worldH;
      ctx.drawImage(this.terrainCanvas, 0, 0, 1, h, -side, 0, side, h);
      ctx.drawImage(this.terrainCanvas, this.worldW - 1, 0, 1, h, this.worldW, 0, side + 1, h);
    }
    for (const draw of LAYERS) draw(this.d, state);

    // Bedrock strip below the world when the screen is taller than 2.2:1.
    if (this.offsetY > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#2a1c10';
      ctx.fillRect(0, this.offsetY + this.worldH * this.scale, this.canvas.width, this.offsetY + 1);
    }
  }

  private syncTerrain(): void {
    if (!this.terrain || !this.terrainImage) return;
    for (const d of this.terrain.takeDirty()) this.terrainCtx.putImageData(this.terrainImage, 0, 0, d.x, d.y, d.w, d.h);
  }

}

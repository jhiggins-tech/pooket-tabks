import type { Terrain } from '../core/terrain';
import type { GameState } from '../game/state';
import type { Draw } from './draw/context';
import { drawBoomerangs } from './draw/boomerang';
import { drawCoffee } from './draw/coffee';
import { drawDrums } from './draw/drums';
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
/** How far the view zooms in on kiwicore while he plays Band Aid (so the notes are big enough to read). */
const DRUM_ZOOM = 2.2;
/** How much of the way to the middle of the screen the zoomed-in tank is brought. */
const ZOOM_CENTRE = 0.35;

/** Something drawn every frame from the game state, in world coordinates. */
type Layer = (d: Draw, state: GameState) => void;

/** Drawn in the sky, behind the hills. */
const BACKDROP: Layer[] = [drawApparitions];

/** Drawn over the terrain, back to front: the order is the layering (like STEPPERS for the simulation). */
const LAYERS: Layer[] = [
  drawPuddles,
  drawSludge, // behind the tanks so the jet flame stays visible
  drawTanks,
  drawDrums,
  drawCoffee,
  drawNapCats,
  drawGhosts,
  drawAim,
  drawProjectiles,
  drawStitches,
  drawBoomerangs,
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
  /** The camera: zoom (1: the whole world), on a world point (cosmetic, eased frame to frame). */
  private zoom = 1;
  private focus = { x: 0, y: 0 };
  /** World → backing-store pixels this frame: x' = x × k + ox (zoom included). */
  private view = { k: 1, ox: 0, oy: 0 };

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
    this.aim();
    this.sky = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);
    this.sky.addColorStop(0, '#1b2440');
    this.sky.addColorStop(0.6, '#3d5a8a');
    this.sky.addColorStop(1, '#8fb3d9');
  }

  /** Converts a screen (CSS pixel) position to world coordinates. */
  screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const { k, ox, oy } = this.view;
    return { x: (clientX * this.dpr - ox) / k, y: (clientY * this.dpr - oy) / k };
  }

  /** Converts world coordinates to a screen (CSS pixel) position. */
  worldToScreen(x: number, y: number): { x: number; y: number } {
    const { k, ox, oy } = this.view;
    return { x: (x * k + ox) / this.dpr, y: (y * k + oy) / this.dpr };
  }

  /** CSS pixels per world pixel, for sizing touch gestures. */
  get cssScale(): number {
    return this.view.k / this.dpr;
  }

  /**
   * Ease the camera towards where it should be: on kiwicore's tank while he drums (Band Aid), else the
   * whole world. Zoomed in, the tank is drawn where it was, brought part of the way to the middle.
   */
  private follow(state: GameState, dt: number): void {
    const k = state.drums;
    const p = k && state.players[k.playerId];
    const want = p && k.outro === null ? DRUM_ZOOM : 1;
    if (p) this.focus = { x: p.x, y: p.y - 20 };
    this.zoom += (want - this.zoom) * Math.min(1, dt * 6);
    if (Math.abs(this.zoom - want) < 0.002) this.zoom = want;
    this.aim();
  }

  /** The world → screen transform for the current zoom and focus. */
  private aim(): void {
    const z = this.zoom;
    const k = this.scale * z;
    // Where the focus is on the unzoomed screen, and where it's drawn zoomed (part way to the middle).
    const fx = this.focus.x * this.scale + this.offsetX;
    const fy = this.focus.y * this.scale + this.offsetY;
    const pull = (ZOOM_CENTRE * (z - 1)) / (DRUM_ZOOM - 1);
    const sx = fx + (this.canvas.width / 2 - fx) * pull;
    const sy = fy + (this.canvas.height / 2 - fy) * pull;
    this.view = { k, ox: sx - this.focus.x * k, oy: sy - this.focus.y * k };
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
    this.follow(state, dt);

    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.sky;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const { k, ox, oy } = this.view;
    ctx.setTransform(k, 0, 0, k, ox, oy);
    for (const draw of BACKDROP) draw(this.d, state);
    ctx.drawImage(this.terrainCanvas, 0, 0);
    // Stretch the edge columns into any side letterbox so hills run to the screen edge.
    const left = ox / k;
    const right = (this.canvas.width - ox) / k - this.worldW;
    const h = this.worldH;
    if (left > 0) ctx.drawImage(this.terrainCanvas, 0, 0, 1, h, -left, 0, left, h);
    if (right > 0) ctx.drawImage(this.terrainCanvas, this.worldW - 1, 0, 1, h, this.worldW, 0, right + 1, h);
    for (const draw of LAYERS) draw(this.d, state);

    // Bedrock strip below the world when the screen is taller than 2.2:1.
    const below = this.canvas.height - (oy + this.worldH * k);
    if (below > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#2a1c10';
      ctx.fillRect(0, this.canvas.height - below, this.canvas.width, below + 1);
    }
  }

  private syncTerrain(): void {
    if (!this.terrain || !this.terrainImage) return;
    for (const d of this.terrain.takeDirty()) this.terrainCtx.putImageData(this.terrainImage, 0, 0, d.x, d.y, d.w, d.h);
  }

}

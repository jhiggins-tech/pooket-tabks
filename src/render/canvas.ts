import type { Terrain } from '../core/terrain';
import { canPickDecoy, currentPlayer, HOLOGRAM_PHASE_IN, hologramsOf, isAimless, isSpewing } from '../game/game';
import type { GameState } from '../game/state';
import type { Draw } from './draw/context';
import { drawExplosions, drawFloaters } from './draw/fx';
import { drawPuddles, drawSludge } from './draw/gunk';
import { drawBeams, drawProjectiles } from './draw/projectiles';
import { drawRunner } from './draw/runner';
import { drawStitch } from './draw/sew';
import { drawApparition } from './draw/sky';
import { drawBooms } from './draw/sonic';
import { drawHeist } from './draw/steal';
import { drawLiquid } from './draw/stream';
import { drawAimGuide, drawGlitchedTank, drawJet, drawSpewGush, drawSwapMarker } from './draw/tank';
import { loadSprites } from './sprites';

const MAX_DPR = 2; // Cap backing-store size so older phones keep 60fps.

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

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly worldW: number,
    private readonly worldH: number,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.d = { ctx: this.ctx, time: 0, sprites: loadSprites() };
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
    this.d.time += dt;
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
    for (const a of state.apparitions) drawApparition(this.d, a); // in the sky, behind the hills
    ctx.drawImage(this.terrainCanvas, 0, 0);
    // Stretch the edge columns into any side letterbox so hills run to the screen edge.
    const side = this.offsetX / this.scale;
    if (side > 0) {
      const h = this.worldH;
      ctx.drawImage(this.terrainCanvas, 0, 0, 1, h, -side, 0, side, h);
      ctx.drawImage(this.terrainCanvas, this.worldW - 1, 0, 1, h, this.worldW, 0, side + 1, h);
    }

    drawPuddles(this.d, state);
    drawSludge(this.d, state); // behind the tanks so the jet flame stays visible
    for (const p of state.players) {
      // Holograms are drawn exactly like the real tank, so there is no visual tell. The shared
      // shimmer glitches every copy (real one included) at the same moment.
      const shimmer = state.shimmers.find((s) => s.ownerId === p.id);
      const shimmerAmt = shimmer ? Math.sin(Math.PI * (shimmer.age / shimmer.duration)) : 0;
      for (const h of hologramsOf(state, p.id)) {
        const phaseIn = Math.min(1, h.age / HOLOGRAM_PHASE_IN);
        drawGlitchedTank(this.d, p, state, h, Math.max(shimmerAmt, 1 - phaseIn), phaseIn, 1);
        if (state.swapTargetId === h.id && canPickDecoy(state) && currentPlayer(state) === p) drawSwapMarker(this.d, h);
      }
      if (p.twin && p.alive) {
        // Twins: an identical second tank, phasing in when it first appears.
        const phaseIn = Math.min(1, p.twin.age / HOLOGRAM_PHASE_IN);
        drawGlitchedTank(this.d, p, state, p.twin, 1 - phaseIn, phaseIn, 1);
      }
      drawJet(this.d, p, state, () => drawGlitchedTank(this.d, p, state, undefined, shimmerAmt, 1, 1));
      if (isSpewing(state, p.id)) drawSpewGush(this.d, p);
    }
    for (const g of state.ghosts) {
      const owner = state.players[g.ownerId];
      if (!owner) continue;
      // Phasing out: tears apart, flattens to a line and fades.
      const k = g.age / g.duration;
      drawGlitchedTank(this.d, owner, state, g, 0.4 + k, 1, 1 - k, 1 - k * 0.9);
    }
    if (state.phase === 'aiming' && !isAimless(state)) drawAimGuide(this.d, currentPlayer(state));
    drawProjectiles(this.d, state);
    for (const st of state.stitches) drawStitch(this.d, st);
    for (const r of state.runners) drawRunner(this.d, r, state);
    drawLiquid(this.d, state);
    drawBeams(this.d, state);
    drawBooms(this.d, state);
    drawExplosions(this.d, state);
    drawHeist(this.d, state);
    drawFloaters(this.d, state);

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

}

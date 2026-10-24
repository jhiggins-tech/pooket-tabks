import type { Terrain } from '../core/terrain';
import { BARREL, frameCentre, frameOf, meter } from '../game/game';
import { SCENES } from '../weapons/camera';
import type { GameState } from '../game/state';
import type { Draw } from './draw/context';
import { drawAirStrike } from './draw/airstrike';
import { drawBarrel } from './draw/bond';
import { drawStratagemDrops, drawStratagemGround } from './draw/stratagems';
import { drawBoomerangs } from './draw/boomerang';
import { drawBunkerBacks, drawBunkerWork } from './draw/bunker';
import { drawCoffee } from './draw/coffee';
import { drawFumes } from './draw/digger';
import { drawComm } from './draw/comm';
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
import { drawBasketballs, drawHoopBack, drawHoopFront } from './draw/hoop';
import { drawSmokes, drawStealthUp } from './draw/sly';
import { drawLiquid } from './draw/stream';
import { drawMarks } from './draw/tracers';
import { drawAim, drawTanks } from './draw/tank';
import { loadSprites } from './sprites';

const MAX_DPR = 2; // Cap backing-store size so older phones keep 60fps.
/** How far the view zooms in on kiwicore while he plays Band Aid (so the notes are big enough to read). */
const DRUM_ZOOM = 2.2;
/** How much of the way to the middle of the screen the zoomed-in tank is brought. */
const ZOOM_CENTRE = 0.35;
/**
 * Hoop Dreamz: how far the view zooms in on the hoop as the ball gets close (from `HOOP_REACH` px away,
 * all the way in at the rim, and held through a slam), and how much of the way to the middle it's brought.
 */
const HOOP_ZOOM = 2;
const HOOP_REACH = 240;
const HOOP_CENTRE = 0.6;
/** 007's gun barrel: how far the view zooms in on its target, and how much of the way to the middle it's brought. */
const BARREL_ZOOM = 2.2;
const BARREL_CENTRE = 0.7;

/** Something drawn every frame from the game state, in world coordinates. */
type Layer = (d: Draw, state: GameState) => void;

/** Drawn in the sky, behind the hills. */
const BACKDROP: Layer[] = [drawApparitions, drawBunkerBacks];

/** Drawn over the terrain, back to front: the order is the layering (like STEPPERS for the simulation). */
const LAYERS: Layer[] = [
  drawPuddles,
  drawStratagemGround,
  drawSludge, // behind the tanks so the jet flame stays visible
  drawTanks,
  drawBunkerWork,
  drawFumes,
  drawSmokes,
  drawDrums,
  drawCoffee,
  drawNapCats,
  drawGhosts,
  drawHoopBack,
  drawAim,
  drawMarks,
  drawProjectiles,
  drawBasketballs,
  drawHoopFront,
  drawStitches,
  drawBoomerangs,
  drawRunners,
  drawLiquid,
  drawBeams,
  drawStratagemDrops,
  drawBooms,
  drawExplosions,
  drawHologramBlasts,
  drawAirStrike,
  drawHeist,
  drawBarrel, // the dark over everything, bar the numbers it ends on
  drawFloaters,
  drawStealthUp,
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
  /** What's being zoomed in on: how far in it goes, and how much of the way to the middle it's brought by then. */
  private peak = DRUM_ZOOM;
  private centre = ZOOM_CENTRE;
  /** World → backing-store pixels this frame: x' = x × k + ox (zoom included). */
  private view = { k: 1, ox: 0, oy: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly worldW: number,
    private readonly worldH: number,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.d = { ctx: this.ctx, time: 0, sprites: loadSprites(), rides: new Map(), exhausts: new Map(), crates: new Map(), sentries: new Map(), hoop: null, viewer: null };
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

  /** Who's looking (draw/context.ts `viewer`): set every frame, before `draw`. */
  set viewer(v: number | null) {
    this.d.viewer = v;
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
   * Ease the camera towards where it should be: on kiwicore's tank while he drums (Band Aid), on the hoop
   * as a Hoop Dreamz ball gets close to it (and down with a slam), on 007's target while the gun barrel's
   * on them, else the whole world. Zoomed in, what
   * it's on is drawn where it was, brought part of the way to the middle.
   */
  private follow(state: GameState, dt: number): void {
    if (this.lookThrough(state)) return;
    const k = state.drums;
    const p = k && state.players[k.playerId];
    const b = state.barrel;
    let want = 1;
    if (b && b.t >= BARREL.dots) {
      want = b.t < BARREL.shot + 0.3 ? BARREL_ZOOM : 1;
      this.focus = { x: b.x, y: b.y - 10 };
      [this.peak, this.centre] = [BARREL_ZOOM, BARREL_CENTRE];
    } else if (p) {
      want = k.outro === null ? DRUM_ZOOM : 1;
      this.focus = { x: p.x, y: p.y - 50 }; // the tank, and the notes' stream above it
      [this.peak, this.centre] = [DRUM_ZOOM, ZOOM_CENTRE];
    } else {
      const ball = state.basketballs.find((b) => b.hoop);
      const h = ball?.hoop;
      if (ball && h) {
        // Closer and closer, then held on the slam, following the ball down.
        const near = ball.dunk !== null ? 1 : Math.max(0, 1 - Math.hypot(ball.x - h.x, ball.y - h.y) / HOOP_REACH);
        want = 1 + (HOOP_ZOOM - 1) * near * near * (3 - 2 * near);
        const at = ball.dunk !== null ? { x: h.x, y: (h.y + ball.y) / 2 + 10 } : { x: h.x + (ball.x - h.x) * 0.3, y: h.y + (ball.y - h.y) * 0.3 + 10 };
        const ease = Math.min(1, dt * 8);
        this.focus = { x: this.focus.x + (at.x - this.focus.x) * ease, y: this.focus.y + (at.y - this.focus.y) * ease };
        [this.peak, this.centre] = [HOOP_ZOOM, HOOP_CENTRE];
      }
    }
    this.zoom += (want - this.zoom) * Math.min(1, dt * 6);
    if (Math.abs(this.zoom - want) < 0.002) this.zoom = want;
    this.aim();
  }

  /**
   * Long Exposure: the screen is the camera's viewfinder (render/hud/camera.ts's frame, `#camera-vf`), and
   * the frame shows exactly what the camera sees (game/camera.ts `frameOf`, `frameCentre`: the hand shake
   * included), the photo's blur, brightness and the light's colour on it. Returns whether it's up.
   */
  private lookThrough(state: GameState): boolean {
    const c = state.camera;
    const box = c && c.outro === null && state.phase === 'shooting' ? document.getElementById('camera-vf')?.getBoundingClientRect() : null;
    if (!c || !box || box.width === 0) {
      if (this.canvas.style.filter) this.canvas.style.filter = '';
      return false;
    }
    const frame = frameOf(c);
    const at = frameCentre(c);
    const k = (box.width * this.dpr) / frame.w;
    this.zoom = 1;
    this.view = { k, ox: (box.left + box.width / 2) * this.dpr - at.x * k, oy: (box.top + box.height / 2) * this.dpr - at.y * k };
    const m = meter(state, c);
    const lit = c.flash && m.err > 0 ? Math.max(0, m.err - 2) : m.err;
    const blur = (1 - m.look) * 9 + Math.max(0, m.slow) * 1.6;
    const bright = Math.min(3.2, Math.max(0.12, 2 ** -lit)) * SCENES[c.scene]!.brightness;
    const contrast = lit < 0 ? Math.max(0.6, 1 + lit * 0.15) : 1;
    this.canvas.style.filter = `blur(${blur.toFixed(2)}px) brightness(${bright.toFixed(3)}) contrast(${contrast.toFixed(3)})`;
    return true;
  }

  /** The world → screen transform for the current zoom and focus. */
  private aim(): void {
    const z = this.zoom;
    const k = this.scale * z;
    // Where the focus is on the unzoomed screen, and where it's drawn zoomed (part way to the middle).
    const fx = this.focus.x * this.scale + this.offsetX;
    const fy = this.focus.y * this.scale + this.offsetY;
    const pull = this.centre * Math.min(1, (z - 1) / (this.peak - 1));
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
    // On the screen itself, over everything: an Air Strike's comm.
    drawComm(ctx, state, this.canvas.height, this.dpr, this.d.time);
  }

  private syncTerrain(): void {
    if (!this.terrain || !this.terrainImage) return;
    for (const d of this.terrain.takeDirty()) this.terrainCtx.putImageData(this.terrainImage, 0, 0, d.x, d.y, d.w, d.h);
  }

}

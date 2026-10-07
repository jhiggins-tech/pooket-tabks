import type { ApparitionKind } from '../weapons/types';
import { GRAVITY } from './constants';
import type { Droplet, GameState, Player, SfxCue } from './state';
import { tankCentre } from './bodies';
import { hash } from './util';

/** Cosmetic effects and sound cues: floating numbers, dust, splashes, rings. Game logic never reads these back. */

const FLOATER_DURATION = 1.6;

const MAX_FLOATERS = 40;

const MAX_SPLASHES = 220;

export function ring(state: GameState, x: number, y: number, colour: string): void {
  state.fx.explosions.push({ x, y, radius: 26, age: 0, duration: 0.7, ring: colour });
}

export function spawnDust(state: GameState, x: number, y: number, strength: number): void {
  const n = strength >= 1 ? 10 : 1;
  for (let i = 0; i < n; i++) {
    const h = hash(state.fxSeq++);
    state.fx.splashes.push({
      x: x + (h - 0.5) * 24,
      y: y - 1,
      vx: (hash(h * 17) - 0.5) * 80 * (0.4 + strength),
      vy: -(20 + hash(h * 29) * 70) * (0.4 + strength),
      age: 0,
      life: 0.4 + hash(h * 5) * 0.3,
      colour: '#b08850',
    });
  }
}

/** Cosmetic spray. Uses the fx counter, not the gameplay RNG, so visuals can't change outcomes. */
export function spawnSplash(state: GameState, x: number, y: number, d: Droplet, count: number): void {
  for (let i = 0; i < count; i++) {
    const h = hash(state.fxSeq++);
    const back = -Math.sign(d.vx || 1) * (20 + h * 50);
    state.fx.splashes.push({
      x,
      y: y - 1,
      vx: back * (0.3 + hash(h * 97) * 0.9) + (hash(h * 13) - 0.5) * 40,
      vy: -(40 + hash(h * 31) * 90) * (0.4 + d.pressure * 0.6),
      age: 0,
      life: 0.35 + hash(h * 7) * 0.3,
      colour: d.colour,
    });
  }
  if (state.fx.splashes.length > MAX_SPLASHES) state.fx.splashes.splice(0, state.fx.splashes.length - MAX_SPLASHES);
}

export function stepSplashes(state: GameState, dt: number): void {
  for (const sp of state.fx.splashes) {
    sp.age += dt;
    sp.vy += GRAVITY * dt;
    sp.x += sp.vx * dt;
    sp.y += sp.vy * dt;
  }
  state.fx.splashes = state.fx.splashes.filter((sp) => sp.age < sp.life && !state.terrain.isSolid(sp.x, sp.y));
}

/** How many sound cues can wait for the audio layer (oldest dropped first; tests never drain them). */
const SFX_QUEUE_MAX = 64;

/** Queue a sound cue for the audio layer. Purely cosmetic. */
export function sound(state: GameState, cue: SfxCue, weaponId?: string, size?: number): void {
  if (state.sfx.length >= SFX_QUEUE_MAX) state.sfx.shift();
  state.sfx.push({ cue, weaponId, size });
}

export function spawnFloater(state: GameState, x: number, y: number, text: string, colour: string): void {
  const c = { x, y };
  const seq = state.fxSeq++;
  // Alternate sides and vary the slope a little so bursts of hits fan out.
  const side = seq % 2 === 0 ? 1 : -1;
  const drift = 18 + ((seq * 7) % 5) * 6;
  state.fx.floaters.push({ x: c.x + side * 4, y: c.y - 14, vx: side * drift, vy: -55, text, colour, age: 0, duration: FLOATER_DURATION });
  if (state.fx.floaters.length > MAX_FLOATERS) state.fx.floaters.shift();
}

export function stepFloaters(state: GameState, dt: number): void {
  for (const f of state.fx.floaters) {
    f.age += dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.vy *= 1 - 0.6 * dt; // ease out as it rises
  }
  state.fx.floaters = state.fx.floaters.filter((f) => f.age < f.duration);
}

/** A cosmetic sky effect above the firer (torikloud's kookaburra in parting clouds). */
export function summonApparition(state: GameState, p: Player, kind: ApparitionKind): void {
  sound(state, 'kookaburra');
  const c = tankCentre(p);
  state.fx.apparitions.push({ kind, x: c.x, y: Math.max(40, c.y - 120), age: 0, duration: 3.2 });
}

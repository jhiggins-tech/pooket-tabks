import { randRange } from '../core/rng';
import { weaponOf } from '../weapons/registry';
import type { WeaponOf } from '../weapons/types';
import { TANK_BODY_HEIGHT } from './constants';
import { ring, sound } from './fx';
import type { Stepper } from './mechanics';
import type { GameState, Hologram, Player, Twin } from './state';
import { currentPlayer, explode, tankBodies } from './tanks';

/**
 * Copies of a tank: kie's Trollogram holograms (decoys, the secret swap, and blowing up when hit) and
 * torikloud's twin, plus their phase effects.
 */

const HOLOGRAM_COLOUR = '#7cf7d4';

/** How long a hologram's blow-up animation lasts (cosmetic). */
export const HOLOGRAM_BLAST_TIME = 0.9;

/** After casting Trollogram, how long the caster has to tap a decoy to swap into (FIRE ends it early). */
export const DECOY_PICK_TIME = 6;

const HOLOGRAM_MIN_SPACING = 70;

/** The player's twin as a stand-in shooter: same aim and power, the twin's position. */
export function twinGun(p: Player): Player {
  return { ...p, x: p.twin!.x, y: p.twin!.y };
}

/** Twins: a second tank appears somewhere clear, and the player's HP is split between the two. */
export function spawnTwin(state: GameState, p: Player): void {
  if (p.twin || p.hp < 2) return;
  const { terrain, rng } = state;
  const taken = [...tankBodies(state).map((q) => q.x), ...state.holograms.map((h) => h.x)];
  let x = randRange(rng, terrain.width * 0.12, terrain.width * 0.88);
  for (let tries = 0; tries < 60 && taken.some((t) => Math.abs(t - x) < HOLOGRAM_MIN_SPACING); tries++) {
    x = randRange(rng, terrain.width * 0.12, terrain.width * 0.88);
  }
  x = Math.round(x);
  const twin: Twin = { x, y: terrain.surfaceY(x), hp: Math.floor(p.hp / 2), burn: null, soak: 0, soakColour: '#ffffff', toxin: 0, toxinRate: 0, age: 0 };
  p.hp -= twin.hp;
  p.twin = twin;
  ring(state, p.x, p.y - TANK_BODY_HEIGHT, p.colour);
  ring(state, twin.x, twin.y - TANK_BODY_HEIGHT, p.colour);
}

/** Replace the firer's holograms with fresh ones at random, well-spaced spots on the ground. */
export function fireDecoys(state: GameState, p: Player, weapon: WeaponOf<'decoy'>): void {
  const { terrain, rng } = state;
  // Each use adds more: earlier holograms stay out (and a swap already picked still happens).
  const colour = weapon.colour ?? HOLOGRAM_COLOUR;
  ring(state, p.x, p.y - TANK_BODY_HEIGHT, colour);
  shimmer(state, p.id);
  for (let n = 0; n < weapon.decoys; n++) {
    const taken = [...tankBodies(state).map((q) => q.x), ...state.holograms.map((h) => h.x)];
    let x = randRange(rng, terrain.width * 0.12, terrain.width * 0.88);
    for (let tries = 0; tries < 60 && taken.some((t) => Math.abs(t - x) < HOLOGRAM_MIN_SPACING); tries++) {
      x = randRange(rng, terrain.width * 0.12, terrain.width * 0.88);
    }
    x = Math.round(x);
    const holo: Hologram = {
      id: state.fxSeq++,
      ownerId: p.id,
      weaponId: weapon.id,
      x,
      y: terrain.surfaceY(x),
      hit: false,
      soak: 0,
      soakColour: '#ffffff',
      age: 0,
    };
    state.holograms.push(holo);
    ring(state, holo.x, holo.y - TANK_BODY_HEIGHT, colour);
  }
  // A moment to pick one of them to swap into this turn.
  state.decoyPick = DECOY_PICK_TIME;
}

const SHIMMER_DURATION = 0.7;

const GHOST_DURATION = 0.8;

/** How long a new hologram takes to phase in (cosmetic). */
export const HOLOGRAM_PHASE_IN = 0.8;

function shimmer(state: GameState, ownerId: number): void {
  state.shimmers.push({ ownerId, age: 0, duration: SHIMMER_DURATION });
}

export function stepPhaseFx(state: GameState, dt: number): void {
  for (const h of state.holograms) h.age += dt;
  for (const p of state.players) if (p.twin) p.twin.age += dt;
  for (const s of state.shimmers) s.age += dt;
  for (const g of state.ghosts) g.age += dt;
  for (const b of state.holoBlasts) b.age += dt;
  state.shimmers = state.shimmers.filter((s) => s.age < s.duration);
  state.ghosts = state.ghosts.filter((g) => g.age < g.duration);
  state.holoBlasts = state.holoBlasts.filter((b) => b.age < b.duration);
}

/** Holograms belonging to a (living) player. */
export function hologramsOf(state: GameState, playerId: number): Hologram[] {
  const owner = state.players[playerId];
  return owner?.alive ? state.holograms.filter((h) => h.ownerId === playerId) : [];
}

/** The current player's hologram nearest (x, y) within radius, if any. */
export function hologramAt(state: GameState, x: number, y: number, radius: number): Hologram | undefined {
  let best: Hologram | undefined;
  let bestD = radius;
  for (const h of hologramsOf(state, currentPlayer(state).id)) {
    const d = Math.hypot(h.x - x, h.y - TANK_BODY_HEIGHT - y);
    if (d <= bestD) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

/** Can the current player pick a decoy to swap with right now? Before firing, or just after casting Trollogram. */
export function canPickDecoy(state: GameState): boolean {
  return state.phase === 'aiming' || (state.phase === 'flying' && state.decoyPick > 0);
}

/** Seconds left to pick a decoy on the turn Trollogram was cast, or null when that isn't happening. */
export function decoyPickLeft(state: GameState): number | null {
  return state.phase === 'flying' && state.decoyPick > 0 ? state.decoyPick : null;
}

/** Close the casting-turn pick window early (the caster is done choosing). */
export function finishDecoyPick(state: GameState): void {
  if (state.phase === 'flying') state.decoyPick = 0;
}

/** Pick (or un-pick) the hologram to swap with when this turn ends. Only on your own turn (see canPickDecoy). */
export function toggleSwapTarget(state: GameState, holoId: number): boolean {
  if (!canPickDecoy(state)) return false;
  const h = state.holograms.find((x) => x.id === holoId);
  if (!h || h.ownerId !== currentPlayer(state).id) return false;
  state.swapTargetId = state.swapTargetId === holoId ? null : holoId;
  return true;
}

/** Holograms that have been hit (and whose owner is still in the game): due to blow up. */
function hitHolograms(state: GameState): Hologram[] {
  return state.holograms.filter((h) => h.hit && state.players[h.ownerId]?.alive);
}

/**
 * A hit hologram blows up: gone, with a blast (its weapon's `decoyBlast`) that hurts every tank in reach,
 * friend or foe, and can set off other holograms (on the next tick: a chain goes off one after another).
 */
function detonate(state: GameState, h: Hologram): void {
  state.holograms = state.holograms.filter((x) => x !== h);
  if (state.swapTargetId === h.id) state.swapTargetId = null;
  const weapon = weaponOf(h.weaponId, 'decoy');
  const blast = weapon.decoyBlast;
  state.holoBlasts.push({ ownerId: h.ownerId, x: h.x, y: h.y, radius: blast.radius, age: 0, duration: HOLOGRAM_BLAST_TIME });
  sound(state, 'holo-boom');
  // The weapon that cast it goes off, as a blast.
  explode(state, h.x, h.y - TANK_BODY_HEIGHT, weapon, h.ownerId, blast);
}

/** Hit holograms blow up as the shot plays out (and hold the turn open until every one has). */
export const hologramBlastStepper: Stepper = {
  step(state) {
    for (const h of hitHolograms(state)) detonate(state, h);
  },
  busy: (state) => hitHolograms(state).length > 0,
};

/**
 * End-of-turn hologram business: anything hit after the shot (soaking up the last of a stream) blows up
 * now; a player who's out loses their holograms; then the current player's secret swap.
 */
export function resolveHolograms(state: GameState): void {
  for (let hit = hitHolograms(state); hit.length > 0; hit = hitHolograms(state)) for (const h of hit) detonate(state, h);
  const orphans = state.holograms.filter((h) => !state.players[h.ownerId]?.alive);
  for (const h of orphans) {
    ring(state, h.x, h.y - TANK_BODY_HEIGHT, HOLOGRAM_COLOUR);
    state.ghosts.push({ ownerId: h.ownerId, x: h.x, y: h.y, age: 0, duration: GHOST_DURATION });
  }
  state.holograms = state.holograms.filter((h) => !orphans.includes(h));
  if (orphans.length > 0) sound(state, 'busted');

  const me = currentPlayer(state);
  const target = state.holograms.find((h) => h.id === state.swapTargetId && h.ownerId === me.id);
  if (target && me.alive) {
    [me.x, target.x] = [target.x, me.x];
    [me.y, target.y] = [target.y, me.y];
  }
  state.swapTargetId = null;
  // Every one of my copies shimmers at the end of my turn, swap or no swap, so it gives nothing away.
  if (me.alive && state.holograms.some((h) => h.ownerId === me.id)) shimmer(state, me.id);
}

/** The moment after casting Trollogram to pick a decoy to swap into (FIRE, now DONE, ends it early). */
export const decoyPickStepper: Stepper = {
  step(state, dt) {
    state.decoyPick = Math.max(0, state.decoyPick - dt);
  },
  busy: (state) => state.decoyPick > 0,
};

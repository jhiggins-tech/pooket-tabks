import { randRange } from '../core/rng';
import type { WeaponDef } from '../weapons/types';
import { TANK_BODY_HEIGHT } from './constants';
import type { GameState, Hologram, Player, Twin } from './state';
import { ring, sound } from './fx';
import { currentPlayer, damagePlayer, tankBodies } from './tanks';

/** Copies of a tank: kie's Trollogram holograms (decoys, the secret swap, exposure) and torikloud's twin, plus their phase effects. */

const HOLOGRAM_COLOUR = '#7cf7d4';

/** Share of the would-be damage a shooter takes for hitting a hologram. */
export const HOLOGRAM_PENALTY = 0.5;

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
  const twin: Twin = { x, y: terrain.surfaceY(x), hp: Math.floor(p.hp / 2), soak: 0, soakColour: '#ffffff', age: 0 };
  p.hp -= twin.hp;
  p.twin = twin;
  ring(state, p.x, p.y - TANK_BODY_HEIGHT, p.colour);
  ring(state, twin.x, twin.y - TANK_BODY_HEIGHT, p.colour);
}

/** Replace the firer's holograms with fresh ones at random, well-spaced spots on the ground. */
export function fireDecoys(state: GameState, p: Player, weapon: WeaponDef): void {
  const { terrain, rng } = state;
  // Each use adds more: earlier holograms stay out (and a swap already picked still happens).
  const colour = weapon.colour ?? HOLOGRAM_COLOUR;
  ring(state, p.x, p.y - TANK_BODY_HEIGHT, colour);
  shimmer(state, p.id);
  for (let n = 0; n < (weapon.decoys ?? 2); n++) {
    const taken = [...tankBodies(state).map((q) => q.x), ...state.holograms.map((h) => h.x)];
    let x = randRange(rng, terrain.width * 0.12, terrain.width * 0.88);
    for (let tries = 0; tries < 60 && taken.some((t) => Math.abs(t - x) < HOLOGRAM_MIN_SPACING); tries++) {
      x = randRange(rng, terrain.width * 0.12, terrain.width * 0.88);
    }
    x = Math.round(x);
    const holo: Hologram = {
      id: state.fxSeq++,
      ownerId: p.id,
      x,
      y: terrain.surfaceY(x),
      hits: [],
      soak: 0,
      soakShooterId: -1,
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
  state.shimmers = state.shimmers.filter((s) => s.age < s.duration);
  state.ghosts = state.ghosts.filter((g) => g.age < g.duration);
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

/**
 * End-of-turn hologram business: expose any hologram that was hit (the shooter pays
 * HOLOGRAM_PENALTY of what they'd have dealt), then carry out the current player's secret swap.
 */
export function resolveHolograms(state: GameState): void {
  const exposed = state.holograms.filter((h) => h.hits.length > 0 || !state.players[h.ownerId]?.alive);
  for (const h of exposed) {
    if (!state.players[h.ownerId]?.alive) continue;
    const byShooter = new Map<number, number>();
    for (const hit of h.hits) byShooter.set(hit.shooterId, (byShooter.get(hit.shooterId) ?? 0) + hit.damage);
    for (const [shooterId, dealt] of byShooter) {
      const shooter = state.players[shooterId];
      if (shooter) damagePlayer(state, shooter, Math.max(1, Math.round(dealt * HOLOGRAM_PENALTY)), HOLOGRAM_COLOUR);
    }
    ring(state, h.x, h.y - TANK_BODY_HEIGHT, HOLOGRAM_COLOUR);
    state.ghosts.push({ ownerId: h.ownerId, x: h.x, y: h.y, age: 0, duration: GHOST_DURATION });
  }
  state.holograms = state.holograms.filter((h) => !exposed.includes(h));
  if (exposed.length > 0) sound(state, 'busted');

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

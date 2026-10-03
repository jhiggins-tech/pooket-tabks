import { randRange } from '../core/rng';
import { getWeapon, kindOf, weaponOf } from '../weapons/registry';
import type { WeaponOf } from '../weapons/types';
import { GRAVITY, SETTLE_TIME, TANK_BODY_HEIGHT, TANK_HALF_WIDTH } from './constants';
import { ring, sound, spawnFloater } from './fx';
import { reselect } from './loadout';
import type { Stepper } from './mechanics';
import type { GameState, Hologram, Player, Twin } from './state';
import { currentPlayer, explode, tankBodies } from './tanks';
import { hash } from './util';

/**
 * Copies of a tank: kie's Trollogram holograms (decoys, the secret swap, and blowing up when hit) and
 * torikloud's twin (and Yolk Sucker, which evens out the twins' health), plus their phase effects.
 */

const HOLOGRAM_COLOUR = '#7cf7d4';

/** How long a hologram's blow-up animation lasts (cosmetic). */
export const HOLOGRAM_BLAST_TIME = 0.9;

/** After casting Trollogram, how long the caster has to tap a decoy to swap into (FIRE ends it early). */
export const DECOY_PICK_TIME = 6;

const HOLOGRAM_MIN_SPACING = 70;

/** The player's twin as a stand-in shooter: the twin's position, and its own aim and power. */
export function twinGun(p: Player): Player {
  const t = p.twin!;
  return { ...p, x: t.x, y: t.y, angle: t.angle, power: t.power };
}

/** A tank's width. The twin can't go within 2 of an enemy tank (or a hologram), nor on top of any tank. */
const TANK_WIDTH = TANK_HALF_WIDTH * 2;
const TWIN_ENEMY_GAP = TANK_WIDTH * 2;

/** Whether the twin may appear at x: on the map, not on a tank, not right beside an enemy's. */
export function twinSpotOk(state: GameState, p: Player, x: number): boolean {
  if (x < TANK_WIDTH || x > state.terrain.width - TANK_WIDTH) return false;
  for (const q of state.players) {
    if (!q.alive) continue;
    const gap = q === p ? TANK_WIDTH : TWIN_ENEMY_GAP;
    if (Math.abs(q.x - x) < gap || (q.twin && Math.abs(q.twin.x - x) < gap)) return false;
  }
  return !state.holograms.some((h) => Math.abs(h.x - x) < (h.ownerId === p.id ? TANK_WIDTH : TWIN_ENEMY_GAP));
}

/**
 * Where to suggest the twin (no randomness: both phones agree, and just looking doesn't change the
 * match): a few tank-widths from the player's tank, away from the nearest enemy if there's room.
 */
export function suggestTwinSpot(state: GameState, p: Player): number {
  const enemy = state.players.filter((q) => q !== p && q.alive).reduce<Player | null>((a, q) => (!a || Math.abs(q.x - p.x) < Math.abs(a.x - p.x) ? q : a), null);
  const away = enemy && enemy.x > p.x ? -1 : 1;
  for (let d = TANK_WIDTH * 4; d < state.terrain.width; d += 4) {
    for (const dir of [away, -away]) {
      const x = Math.round(p.x + dir * d);
      if (twinSpotOk(state, p, x)) return x;
    }
  }
  return Math.round(p.x);
}

/** Twins is selected and there's no twin yet: where the twin would appear (the ghost), else null. */
export function pendingTwinSpot(state: GameState): number | null {
  if (state.phase !== 'aiming') return null;
  const p = currentPlayer(state);
  const id = p.loadout[p.selectedTier];
  if (p.twin || !id || kindOf(getWeapon(id)) !== 'twin' || (p.ammo[p.selectedTier] ?? 0) <= 0) return null;
  return p.twinSpot !== null && twinSpotOk(state, p, p.twinSpot) ? p.twinSpot : suggestTwinSpot(state, p);
}

/** Tapped the ground with Twins selected: the twin will appear there (if it's allowed). */
export function placeTwin(state: GameState, x: number): boolean {
  if (pendingTwinSpot(state) === null) return false;
  const p = currentPlayer(state);
  const at = Math.round(x);
  if (!twinSpotOk(state, p, at)) return false;
  p.twinSpot = at;
  return true;
}

/** A random spot on the ground, well clear of every tank and hologram (if one can be found). */
function clearSpot(state: GameState): number {
  const { terrain, rng } = state;
  const taken = [...tankBodies(state).map((q) => q.x), ...state.holograms.map((h) => h.x)];
  let x = randRange(rng, terrain.width * 0.12, terrain.width * 0.88);
  for (let tries = 0; tries < 60 && taken.some((t) => Math.abs(t - x) < HOLOGRAM_MIN_SPACING); tries++) {
    x = randRange(rng, terrain.width * 0.12, terrain.width * 0.88);
  }
  return Math.round(x);
}

/**
 * Twins: a second tank appears where the player put it (or the suggested spot), and the player's HP is
 * split between the two. It starts with the main tank's aim.
 */
export function spawnTwin(state: GameState, p: Player): void {
  if (p.twin || p.hp < 2) return;
  const { terrain } = state;
  const x = p.twinSpot !== null && twinSpotOk(state, p, p.twinSpot) ? p.twinSpot : suggestTwinSpot(state, p);
  p.twinSpot = null;
  const twin: Twin = { x, y: terrain.surfaceY(x), hp: Math.floor(p.hp / 2), burn: null, soak: 0, soakColour: '#ffffff', toxin: 0, toxinRate: 0, age: 0, angle: p.angle, power: p.power };
  p.hp -= twin.hp;
  p.twin = twin;
  ring(state, p.x, p.y - TANK_BODY_HEIGHT, p.colour);
  ring(state, twin.x, twin.y - TANK_BODY_HEIGHT, p.colour);
}

/**
 * Yolk Sucker: once Twins has been fired, its slot (spent, while the twin stands) is a bonus move instead.
 * Any turn, as often as it's worth it, it pools the two tanks' health and shares it out as Twins does (the
 * twin half rounded down, the main tank the rest). Nothing to share when the two are already even (or one
 * apart, with an odd pool). It doesn't use the turn. Burns and the like stay on the tank they're on.
 * Online it goes like any bonus move: through `fire` (the other phone replays it from the same state).
 */
export const YOLK_SUCKER = { name: 'Yolk Sucker', colour: '#ffcf33' } as const;

/** The slot that's Yolk Sucker for `p` (a spent Twins, while the twin stands), or -1. */
export function yolkTier(p: Player): number {
  if (!p.twin || !p.alive) return -1;
  return p.loadout.findIndex((id, tier) => kindOf(getWeapon(id)) === 'twin' && (p.ammo[tier] ?? 0) <= 0);
}

/** Whether Yolk Sucker would change anything: the twins' health is more than one apart. */
export function canSuckYolk(p: Player): boolean {
  return yolkTier(p) >= 0 && Math.abs(p.hp - p.twin!.hp) > 1;
}

/** Even out the twins' health (see YOLK_SUCKER). Returns false if there's nothing to even out. */
export function suckYolk(state: GameState, p: Player): boolean {
  if (!canSuckYolk(p)) return false;
  const twin = p.twin!;
  const pool = p.hp + twin.hp;
  const [fromMain, before] = [p.hp > twin.hp, { main: p.hp, twin: twin.hp }];
  twin.hp = Math.floor(pool / 2);
  p.hp = pool - twin.hp;
  // Cosmetic: a stream of yolk from the fuller tank to the emptier one, and what each gave or got.
  const [from, to] = fromMain ? [p, twin] : [twin, p];
  const sx = from.x;
  const sy = from.y - TANK_BODY_HEIGHT;
  for (let i = 0; i < 28; i++) {
    const h = hash(state.fxSeq++ * 1.91);
    const T = 0.5 + hash(h * 37) * 0.35;
    const tx = to.x + (hash(h * 13) - 0.5) * 16;
    const ty = to.y - TANK_BODY_HEIGHT + (hash(h * 7) - 0.5) * 6;
    state.fx.splashes.push({ x: sx + (hash(h * 19) - 0.5) * 8, y: sy, vx: (tx - sx) / T, vy: (ty - sy) / T - 0.5 * GRAVITY * T, age: 0, life: T + 0.1, colour: YOLK_SUCKER.colour, size: 2 + hash(h * 23) * 1.8 });
  }
  const change = (now: number, was: number) => (now >= was ? `+${now - was}` : `-${was - now}`);
  spawnFloater(state, p.x, p.y - TANK_BODY_HEIGHT - 16, change(p.hp, before.main), YOLK_SUCKER.colour);
  spawnFloater(state, twin.x, twin.y - TANK_BODY_HEIGHT - 16, change(twin.hp, before.twin), YOLK_SUCKER.colour);
  spawnFloater(state, to.x, to.y - TANK_BODY_HEIGHT - 34, 'YOLK SUCKED 🥚', YOLK_SUCKER.colour);
  sound(state, 'yolk');
  if (!reselect(p)) {
    // Nothing left to fire (can't usually happen: a player with no rounds sits their turn out).
    state.phase = 'settling';
    state.settleTimer = SETTLE_TIME;
  }
  return true;
}

/** Replace the firer's holograms with fresh ones at random, well-spaced spots on the ground. */
export function fireDecoys(state: GameState, p: Player, weapon: WeaponOf<'decoy'>): void {
  const { terrain } = state;
  // Each use adds more: earlier holograms stay out (and a swap already picked still happens).
  const colour = weapon.colour ?? HOLOGRAM_COLOUR;
  ring(state, p.x, p.y - TANK_BODY_HEIGHT, colour);
  shimmer(state, p.id);
  for (let n = 0; n < weapon.decoys; n++) {
    const x = clearSpot(state);
    const holo: Hologram = {
      id: state.nextId++,
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
  state.fx.shimmers.push({ ownerId, age: 0, duration: SHIMMER_DURATION });
}

export function stepPhaseFx(state: GameState, dt: number): void {
  for (const h of state.holograms) h.age += dt;
  for (const p of state.players) if (p.twin) p.twin.age += dt;
  for (const s of state.fx.shimmers) s.age += dt;
  for (const g of state.fx.ghosts) g.age += dt;
  for (const b of state.fx.holoBlasts) b.age += dt;
  state.fx.shimmers = state.fx.shimmers.filter((s) => s.age < s.duration);
  state.fx.ghosts = state.fx.ghosts.filter((g) => g.age < g.duration);
  state.fx.holoBlasts = state.fx.holoBlasts.filter((b) => b.age < b.duration);
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
  state.fx.holoBlasts.push({ ownerId: h.ownerId, x: h.x, y: h.y, radius: blast.radius, age: 0, duration: HOLOGRAM_BLAST_TIME });
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
    state.fx.ghosts.push({ ownerId: h.ownerId, x: h.x, y: h.y, age: 0, duration: GHOST_DURATION });
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

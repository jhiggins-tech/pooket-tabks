import { kindOf, weaponOf } from '../weapons/registry';
import { FUEL_PER_MATCH, TANK_BODY_HEIGHT } from './constants';
import { currentPlayer, tankCentre } from './bodies';
import { sound, spawnFloater } from './fx';
import { canUseSlot, weaponForTier } from './loadout';
import type { GameState, Player, Sneak } from './state';

/**
 * doctorfox's Sly: a smokescreen goes up round his tank and he vanishes. His fuel tank is filled right up
 * and he has `sly.time` s to drive off (FIRE ends it sooner); then it's fired, and his turn is over. He
 * stays out of sight of the other players (`Player.hidden`) until his next turn starts (statuses.ts
 * `turnStarting`), or until something hits him (`reveal`, from tanks.ts `hurt`): he can still be hit, he
 * just can't be seen. Hidden is how he's drawn (render/draw/sly.ts: not at all for the others, a ghost for
 * himself), and enemy weapons that seek out the nearest enemy (walkers, runners, homing, the hoop,
 * splashback) don't seek him out: tanks.ts `forEachTargetPos`.
 *
 * Like Band Aid (drums.ts) it isn't a shot in flight: FIRE starts it (`startSneak`: phase `sneaking`), and
 * like aiming or driving it's this phone's input. Only his phone runs its clock (`sneakClock`); the other
 * phone and spectators follow it in the aim previews (net/follow.ts, `followSneak`). When time's up
 * (`sneakReady`) his phone fires it for real (the round spent, the pre-fire snapshot sent).
 */

/** How long a smokescreen hangs about (s), and the little puff when he's spotted. */
export const SMOKE_TIME = 3.2;
const SPOTTED_PUFF = 1.2;

/** Whether tier `tier` is a Sly. */
export function isSly(p: Player, tier: number): boolean {
  return p.loadout[tier] !== undefined && kindOf(weaponForTier(p, tier)) === 'sly';
}

/** FIRE on Sly: the smoke goes up, he's gone, and the tank's full (the round is spent when it's fired, at the end). */
export function startSneak(state: GameState): boolean {
  const p = currentPlayer(state);
  if (state.phase !== 'aiming' || p.hop || !isSly(p, p.selectedTier) || !canUseSlot(state, p, p.selectedTier)) return false;
  const w = weaponOf(p.loadout[p.selectedTier]!, 'sly');
  state.sneak = { playerId: p.id, weaponId: w.id, t: 0, x: p.x, y: p.y, movedAt: null, done: false };
  state.phase = 'sneaking';
  p.fuel = FUEL_PER_MATCH;
  p.hidden = true;
  smoke(state, p.x, p.y, SMOKE_TIME);
  sound(state, 'smoke', w.id);
  return true;
}

/** His phone: the clock runs down, and it's over when time's up. */
export function sneakClock(state: GameState, dt: number): void {
  const k = state.sneak;
  if (state.phase !== 'sneaking' || !k || k.done) return;
  k.t += dt;
  if (k.t >= weaponOf(k.weaponId, 'sly').sly.time) k.done = true;
}

/** He's moved under the smoke (movement.ts `drive`): the first time, the stealth powerup kicks in (a cue here; the words are drawn for his eyes only, render/draw/sly.ts). */
export function sneakMoved(state: GameState): void {
  const k = state.phase === 'sneaking' ? state.sneak : null;
  if (!k || k.movedAt !== null) return;
  k.movedAt = k.t;
  sound(state, 'stealth', k.weaponId);
}

/** Time's up, and waiting for his phone to fire it. */
export function sneakReady(state: GameState): boolean {
  return state.phase === 'sneaking' && !!state.sneak?.done;
}

/** Whole seconds left to sneak off (null: not sneaking). */
export function sneakLeft(state: GameState): number | null {
  const k = state.phase === 'sneaking' ? state.sneak : null;
  if (!k) return null;
  return Math.max(0, Math.ceil(weaponOf(k.weaponId, 'sly').sly.time - k.t));
}

/** Another phone's Sly, as its previews show it (net/follow.ts): the smoke goes up here too, and he's gone. */
export function followSneak(state: GameState, next: Sneak): void {
  const p = state.players[next.playerId];
  if (state.phase !== 'sneaking' || !state.sneak) {
    smoke(state, next.x, next.y, SMOKE_TIME);
    sound(state, 'smoke', next.weaponId);
  }
  state.sneak = next;
  state.phase = 'sneaking';
  if (p) p.hidden = true;
}

/** Something hit him (tanks.ts `hurt`): he's given away, and seen again. */
export function reveal(state: GameState, p: Player): void {
  if (!p.hidden) return;
  p.hidden = false;
  smoke(state, p.x, p.y, SPOTTED_PUFF);
  spawnFloater(state, p.x, p.y - TANK_BODY_HEIGHT - 22, 'SPOTTED!', '#fb923c');
  sound(state, 'spotted');
}

/** The smokescreens thin out. */
export function stepSmokes(state: GameState, dt: number): void {
  for (const s of state.fx.smokes) s.age += dt;
  state.fx.smokes = state.fx.smokes.filter((s) => s.age < s.duration);
}

function smoke(state: GameState, x: number, y: number, duration: number): void {
  const c = tankCentre({ x, y });
  state.fx.smokes.push({ x: c.x, y: c.y, age: 0, duration });
}

/** Fired (game.ts `fire`: time's up, or FIRE sooner): the sneaking's over, and so is the turn. */
export function fireSly(state: GameState): void {
  state.sneak = null;
}

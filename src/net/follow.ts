import { currentPlayer } from '../game/game';
import type { GameState } from '../game/state';
import type { NetMsg } from './session';
import { applySnapshot, decodeSolid, type Snapshot } from './snapshot';

/**
 * Following a match someone else is playing: what the phone waiting out the other's turn, a spectator
 * and a replay all do. Each shot is replayed locally from its pre-shot state, then the game snaps to the
 * turn's result once the local shot has played out (or after SYNC_GRACE, if it hasn't): `ResultBuffer`.
 */

/** If a turn's result arrives while the shot is still playing out here, apply it after this long anyway. */
export const SYNC_GRACE = 4;

/** The aim and position of whoever's turn it is, streamed while they aim. */
export type Preview = Extract<NetMsg, { k: 'preview' }>;

/** The current player's aim and position, as a preview. */
export function previewOf(s: GameState): Preview {
  const p = currentPlayer(s);
  const twin = p.twin ? { angle: p.twin.angle, power: p.twin.power } : null;
  return { k: 'preview', turn: s.turn, x: p.x, y: p.y, fuel: p.fuel, angle: p.angle, power: p.power, tier: p.selectedTier, hop: p.hop, twin, aimTwin: p.aimTwin, twinSpot: p.twinSpot, hp: p.hp };
}

/** Show the current player aiming as the preview says (if it's for this turn, while aiming). */
export function applyPreview(s: GameState, v: Preview): void {
  if (v.turn !== s.turn || s.phase !== 'aiming') return;
  const p = currentPlayer(s);
  Object.assign(p, { x: v.x, y: v.y, fuel: v.fuel, angle: v.angle, power: v.power, selectedTier: v.tier, hop: v.hop, aimTwin: v.aimTwin ?? false, twinSpot: v.twinSpot ?? null });
  if (p.twin && v.twin) Object.assign(p.twin, { angle: v.twin.angle, power: v.twin.power });
  if (typeof v.hp === 'number' && v.hp > 0) p.hp = v.hp;
}

/** Snap the game to a snapshot and its terrain. */
export function putState(s: GameState, snap: Snapshot, terrain: string): void {
  applySnapshot(s, snap);
  s.terrain.patchSolid(decodeSolid(terrain, s.terrain.solid.length));
}

/** The turn a shot was fired in is over here (the next turn has come up, or the game has ended). */
export function shotResolved(s: GameState, turn: number): boolean {
  return s.phase === 'gameover' || (s.turn > turn && s.phase === 'aiming');
}

/**
 * A shot being followed and the turn's result that settles it (the other phone's, the spectator feed's,
 * the record's): a result that arrives while the shot is still playing out here waits, for `grace`
 * seconds at most. Each method is one thing that happens to a shot, and says what it leaves alone.
 */
export class ResultBuffer<R, S extends { turn: number } = { turn: number; owner: number }> {
  private current: S | null = null;
  private result: R | null = null;
  private waited = 0;
  private grace = SYNC_GRACE;

  /** The shot playing out (its turn, and whose), until it's settled. */
  get shot(): S | null {
    return this.current;
  }

  /** A result that arrived while the shot was still playing out here. */
  get pending(): R | null {
    return this.result;
  }

  /** The shot has played out in this game: its turn is over (or the game is). */
  resolved(g: GameState | null): boolean {
    return !!g && !!this.current && shotResolved(g, this.current.turn);
  }

  /** A shot was fired (a result still pending stays). */
  fired(shot: S): void {
    this.current = shot;
  }

  /** Its result is in while the shot is still playing out here: the grace period starts. */
  resultIn(r: R): void {
    this.result = r;
    this.waited = 0;
  }

  /** A result already known (a shot replayed from the record), with its own grace; the time already waited stays. */
  known(r: R, grace: number): void {
    this.result = r;
    this.grace = grace;
  }

  /** Count `dt` against the grace period: the pending result once it's up (null: none, or not yet). */
  due(dt: number): R | null {
    if (!this.result) return null;
    this.waited += dt;
    return this.waited >= this.grace ? this.result : null;
  }

  /** A result has been applied: nothing in flight, nothing pending, the grace back to normal. */
  applied(): void {
    this.current = null;
    this.result = null;
    this.waited = 0;
    this.grace = SYNC_GRACE;
  }

  /** The shot settled here (its result as it played out here is the one that counts); a pending result stays. */
  settledHere(): void {
    this.current = null;
  }

  /** Done with the shot and any result for it; the time waited and the grace stay. */
  cleared(): void {
    this.current = null;
    this.result = null;
  }

  /** A newer shot supersedes any result still pending from before. */
  dropResult(): void {
    this.result = null;
  }

  /** A new game: no shot, no result, the normal grace; the time waited stays. */
  reset(): void {
    this.current = null;
    this.result = null;
    this.grace = SYNC_GRACE;
  }
}

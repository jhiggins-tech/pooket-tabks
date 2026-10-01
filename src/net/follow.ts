import { currentPlayer } from '../game/game';
import type { GameState } from '../game/state';
import type { NetMsg } from './session';
import { applySnapshot, decodeSolid, type Snapshot } from './snapshot';

/**
 * Following a match someone else is playing: what the phone waiting out the other's turn, a spectator
 * and a replay all do. Each shot is replayed locally from its pre-shot state, then the game snaps to the
 * turn's result once the local shot has played out (or after SYNC_GRACE, if it hasn't).
 */

/** If a turn's result arrives while the shot is still playing out here, apply it after this long anyway. */
export const SYNC_GRACE = 4;

/** The aim and position of whoever's turn it is, streamed while they aim. */
export type Preview = Extract<NetMsg, { k: 'preview' }>;

/** The current player's aim and position, as a preview. */
export function previewOf(s: GameState): Preview {
  const p = currentPlayer(s);
  return { k: 'preview', turn: s.turn, x: p.x, y: p.y, fuel: p.fuel, angle: p.angle, power: p.power, tier: p.selectedTier, hop: p.hop };
}

/** Show the current player aiming as the preview says (if it's for this turn, while aiming). */
export function applyPreview(s: GameState, v: Preview): void {
  if (v.turn !== s.turn || s.phase !== 'aiming') return;
  Object.assign(currentPlayer(s), { x: v.x, y: v.y, fuel: v.fuel, angle: v.angle, power: v.power, selectedTier: v.tier, hop: v.hop });
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

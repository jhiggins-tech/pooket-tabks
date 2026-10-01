import { finishDecoyPick, fire } from '../game/game';
import type { GameState, PlayerConfig } from '../game/state';
import { applyPreview, putState, shotResolved, SYNC_GRACE } from './follow';
import { netLog } from './log';
import type { ViewMsg } from './session';

/**
 * Watching a match, view only. Fed the players' spectator feed (ViewMsg): builds the game from the first
 * full state it sees (so it can join at any point), replays each shot from the exact pre-shot state, and
 * snaps to each turn's result, like the other phone does. Never sends anything.
 */
export class Spectator {
  /** Build a fresh game for this match setup. */
  onStart: (seed: number, players: PlayerConfig[]) => GameState = () => {
    throw new Error('onStart not set');
  };

  private state: GameState | null = null;
  private seed: number | null = null;
  private shotTurn: number | null = null;
  private pending: Extract<ViewMsg, { k: 'state' }> | null = null;
  private waited = 0;

  get game(): GameState | null {
    return this.state;
  }

  receive(v: ViewMsg): void {
    if (v.k === 'preview') {
      if (this.state && this.shotTurn === null) applyPreview(this.state, v);
      return;
    }
    // A new match (or the first thing we see): build it.
    if (!this.state || v.why === 'start' || v.seed !== this.seed) {
      netLog(`watch: ${this.state ? 'new match' : 'joined'} (${v.players.map((p) => p.name).join(' vs ')})`);
      this.state = this.onStart(v.seed, v.players);
      this.seed = v.seed;
      this.shotTurn = null;
      this.pending = null;
      this.apply(v);
      return;
    }
    if (v.why === 'fire') {
      this.pending = null;
      this.apply(v);
      fire(this.state);
      this.shotTurn = v.snap.turn;
      return;
    }
    // A result (or a fresh start): now if nothing's playing out, else once it has (with a grace period).
    if (this.shotTurn === null || this.resolved()) this.apply(v);
    else {
      this.pending = v;
      this.waited = 0;
      finishDecoyPick(this.state); // the shooter has finished picking a decoy, if they were
    }
  }

  /** Call once per frame after stepping the simulation. */
  tick(dt: number): void {
    if (!this.state) return;
    if (this.pending) {
      this.waited += dt;
      if (this.resolved() || this.waited >= SYNC_GRACE) this.apply(this.pending);
    }
  }

  private resolved(): boolean {
    return this.shotTurn !== null && shotResolved(this.state!, this.shotTurn);
  }

  private apply(v: Extract<ViewMsg, { k: 'state' }>): void {
    putState(this.state!, v.snap, v.terrain);
    if (v.why !== 'fire') this.shotTurn = null;
    this.pending = null;
    this.waited = 0;
  }
}

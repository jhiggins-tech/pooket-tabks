import { finishDecoyPick, fire } from '../game/game';
import type { GameState, PlayerConfig } from '../game/state';
import { applyPreview, putState, ResultBuffer } from './follow';
import { netLog } from './log';
import type { ViewMsg } from './session';

type StateMsg = Extract<ViewMsg, { k: 'state' }>;

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
  /** The shot playing out here (just its turn), and a result that came in while it was. */
  private readonly shots = new ResultBuffer<StateMsg, { turn: number }>();

  get game(): GameState | null {
    return this.state;
  }

  receive(v: ViewMsg): void {
    if (v.k === 'preview') {
      if (this.state && !this.shots.shot) applyPreview(this.state, v);
      return;
    }
    // A new match (or the first thing we see): build it.
    if (!this.state || v.why === 'start' || v.seed !== this.seed) {
      netLog(`watch: ${this.state ? 'new match' : 'joined'} (${v.players.map((p) => p.name).join(' vs ')})`);
      this.state = this.onStart(v.seed, v.players);
      this.seed = v.seed;
      this.apply(v);
      return;
    }
    if (v.why === 'fire') {
      this.apply(v);
      fire(this.state);
      this.shots.fired({ turn: v.snap.turn });
      return;
    }
    // A result (or a fresh start): now if nothing's playing out, else once it has (with a grace period).
    if (!this.shots.shot || this.shots.resolved(this.state)) this.apply(v);
    else {
      this.shots.resultIn(v);
      finishDecoyPick(this.state); // the shooter has finished picking a decoy, if they were
    }
  }

  /** Call once per frame after stepping the simulation. */
  tick(dt: number): void {
    if (!this.state) return;
    const pending = this.shots.pending;
    if (pending && (this.shots.due(dt) || this.shots.resolved(this.state))) this.apply(pending);
  }

  /** Snap to a state (a shot fired from it is fired again by the caller). */
  private apply(v: StateMsg): void {
    putState(this.state!, v.snap, v.terrain);
    this.shots.applied();
  }
}

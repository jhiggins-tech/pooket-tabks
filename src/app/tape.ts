import type { GameState, PlayerConfig } from '../game/state';
import type { ShotRecord } from '../net/record';
import { shotKey, type Replay } from '../net/replay';
import { encodeSolid, takeSnapshot } from '../net/snapshot';
import { RULES, WIRE } from '../net/version';

/**
 * The match being played on this phone, recorded as it goes (hotseat or online, public or private), so it
 * can be watched again from the game over card: every shot as the exact state just before it was fired,
 * and how it ended, which is all a replay is (net/replay.ts). Kept in memory only, for the latest match.
 */
export class MatchTape {
  private tape: Replay | null = null;
  private readonly keys = new Map<string, number>();

  /** A new match: anything recorded before is dropped. */
  start(seed: number, players: PlayerConfig[]): void {
    this.tape = { listing: { id: 'local', v: WIRE, rules: RULES, seed, players, ts: Date.now() }, shots: [], end: null };
    this.keys.clear();
  }

  /** Stop recording (the match on screen isn't one being played here: watched, or the backdrop). */
  clear(): void {
    this.tape = null;
    this.keys.clear();
  }

  /** A shot about to be fired here (hotseat): record the state as it is now. */
  firing(state: GameState): ShotRecord {
    return { turn: state.turn, owner: state.current, snap: takeSnapshot(state), terrain: encodeSolid(state.terrain) };
  }

  /** A shot fired (the same shot again, say played out from the record after a rejoin, replaces it). */
  shot(shot: ShotRecord): void {
    if (!this.tape || this.tape.end) return;
    const key = shotKey(shot);
    const at = this.keys.get(key);
    if (at === undefined) this.keys.set(key, this.tape.shots.push(shot) - 1);
    else this.tape.shots[at] = shot;
  }

  /** The match is over: how it ended (once). */
  end(state: GameState): void {
    if (!this.tape || this.tape.end || state.phase !== 'gameover') return;
    this.tape.end = { snap: takeSnapshot(state), terrain: encodeSolid(state.terrain) };
    this.tape.listing.over = { winner: state.winner?.id ?? null, endReason: state.endReason, turns: state.turn };
  }

  /** The finished match to watch again (null: none, or nothing was fired). */
  get replay(): Replay | null {
    return this.tape?.end && this.tape.shots.length ? this.tape : null;
  }
}

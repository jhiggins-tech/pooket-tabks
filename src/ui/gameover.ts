import type { GameState } from '../game/state';
import type { Rank } from '../stats/ranks';
import { byId, el } from './dom';
import { insignia } from './insignia';

/** What the match on screen is, for the game over card. */
export type GameOverMode = 'hotseat' | 'online' | 'watching' | 'replay';

/**
 * The game over card (#gameover): who won (with their insignia if they're ranked, and why the other lost if
 * it wasn't played out), and its buttons: ▶ Watch replay (the match just played, from this phone's
 * recording; ↺ Watch again at the end of a replay) and New game (hotseat) or Leave. There's no rematch:
 * start a new game for that. The HUD shows it when a match ends (`show`); main.ts wires the buttons.
 */
export class GameOverCard {
  readonly replay = byId<HTMLButtonElement>('watch-replay');
  readonly leave = byId<HTMLButtonElement>('gameover-leave');
  private readonly root = byId('gameover');
  private readonly winner = byId('winner');
  private key = '';

  /** Shown for a match that's over (`rankOf`: a player's rank, by id), hidden for one that isn't. */
  show(state: GameState, rankOf: (playerId: number) => Rank | null | undefined): void {
    this.root.hidden = state.phase !== 'gameover';
    if (state.phase !== 'gameover') return;
    this.winner.textContent = state.winner ? `${state.winner.name} wins!` : 'Draw!';
    const winnerRank = state.winner ? rankOf(state.winner.id) : null;
    if (winnerRank) this.winner.prepend(insignia(winnerRank, 'md'));
    const loser = state.players.find((q) => q !== state.winner);
    if (state.endReason && loser) {
      this.winner.append(el('small', 'end-reason', state.endReason === 'resigned' ? `${loser.name} resigned` : `${loser.name} ran out of time`));
    }
    this.winner.style.color = state.winner?.colour ?? '#fff';
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** The buttons, for what the match on screen is and whether this phone recorded it. */
  update(mode: GameOverMode, canReplay: boolean): void {
    const key = `${mode}|${canReplay}`;
    if (key === this.key) return;
    this.key = key;
    this.replay.hidden = mode !== 'replay' && !(canReplay && mode !== 'watching');
    this.replay.textContent = mode === 'replay' ? '↺ Watch again' : '▶ Watch replay';
    this.leave.textContent = mode === 'hotseat' ? 'New game' : 'Leave';
  }
}

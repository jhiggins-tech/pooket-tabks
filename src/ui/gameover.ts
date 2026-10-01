import { byId } from './dom';

/** What the match on screen is, for the game over card. */
export type GameOverMode = 'hotseat' | 'online' | 'watching' | 'replay';

/**
 * The game over card's buttons: ▶ Watch replay (the match just played, from this phone's recording;
 * ↺ Watch again at the end of a replay) and New game (hotseat) or Leave. There's no rematch: start a new
 * game for that.
 */
export class GameOverButtons {
  readonly replay = byId<HTMLButtonElement>('watch-replay');
  readonly leave = byId<HTMLButtonElement>('gameover-leave');
  private key = '';

  update(mode: GameOverMode, canReplay: boolean): void {
    const key = `${mode}|${canReplay}`;
    if (key === this.key) return;
    this.key = key;
    this.replay.hidden = mode !== 'replay' && !(canReplay && mode !== 'watching');
    this.replay.textContent = mode === 'replay' ? '↺ Watch again' : '▶ Watch replay';
    this.leave.textContent = mode === 'hotseat' ? 'New game' : 'Leave';
  }
}

import { currentPlayer, decoyPickLeft } from '../game/game';
import type { GameState } from '../game/state';
import type { Rank } from '../stats/ranks';
import type { GameOverCard } from '../ui/gameover';
import { chips } from './hud/chips';
import { coffee } from './hud/coffee';
import { heist } from './hud/heist';
import type { HudContext, Part } from './hud/part';
import { readouts } from './hud/readouts';
import { status } from './hud/status';
import { gameOverCard, turnBanner } from './hud/turn';
import { weapons } from './hud/weapons';

export { angleLabel } from './hud/readouts';

/**
 * Keeps the DOM overlay in sync with game state, one part at a time (render/hud/): each part keeps its own
 * key and is touched only when that changes: readouts (angle, power, fuel) every time they move, the name
 * chips and weapon buttons only when what they show changes (chips are kept and patched, so the health bars
 * animate), the rest per turn.
 */
export class Hud {
  /** Each player's rank in the match on screen (verified players only; ui/ranks.ts), by player id. */
  private ranks: (Rank | null)[] = [];
  private readonly chips = chips();
  private readonly banner = turnBanner();
  private readonly gameOver: Part;
  /** Every part, in the order they're drawn. */
  private readonly parts: Part[];
  /** Set in an online match: which seat is this phone's, and whether it's waiting for the other's result. */
  online: { localSeat: number; syncing: boolean } | null = null;

  /** `gameOver`: the game over card, shown when a match ends (ui/gameover.ts). */
  constructor(gameOver: GameOverCard) {
    this.gameOver = gameOverCard(gameOver);
    this.parts = [readouts(), status(), this.chips, weapons(), heist(), coffee(), this.banner, this.gameOver];
  }

  /** The players' ranks in this match (null: not ranked, or not signed in). */
  setRanks(ranks: (Rank | null)[]): void {
    if (ranks.map((r) => r?.id ?? '').join() === this.ranks.map((r) => r?.id ?? '').join()) return;
    this.ranks = ranks;
    for (const part of [this.chips, this.banner, this.gameOver]) part.reset();
  }

  update(state: GameState): void {
    const ctx: HudContext = {
      p: currentPlayer(state),
      picking: decoyPickLeft(state),
      // Online: when it isn't this phone's turn, the controls step aside and it just watches.
      remote: !!this.online && (state.current !== this.online.localSeat || this.online.syncing),
      online: this.online,
      ranks: this.ranks,
    };
    for (const part of this.parts) part.update(state, ctx);
  }

  reset(): void {
    for (const part of this.parts) part.reset();
  }
}

/**
 * The HUD's building block: a part draws one piece of the overlay from the game state, and only when what
 * it shows has changed. Each part says what it depends on as a key; `keyed` (and `Key`, for a part with
 * more than one) redraws only when the key differs from the last one drawn.
 */
import type { GameState, Player } from '../../game/state';
import type { Rank } from '../../stats/ranks';

/** What every part gets besides the state: worked out once a frame by the Hud (render/hud.ts). */
export interface HudContext {
  /** Whose turn it is. */
  readonly p: Player;
  /** Seconds left to pick a decoy after casting Trollogram (game/copies.ts `decoyPickLeft`), or null. */
  readonly picking: number | null;
  /** Online, and it isn't this phone's turn (or it's waiting for the other's result): the controls step aside. */
  readonly remote: boolean;
  /** Set in an online match: which seat is this phone's, and whether it's waiting for the other's result. */
  readonly online: { localSeat: number; syncing: boolean } | null;
  /** Each player's rank in the match on screen (null: not ranked, or not signed in), by player id. */
  readonly ranks: readonly (Rank | null)[];
}

/** A piece of the HUD: `update` every frame, `reset` to draw it afresh next time. */
export interface Part {
  update(state: GameState, ctx: HudContext): void;
  reset(): void;
}

/** The last key something was drawn for: `changed(key)` says whether it differs (and remembers it). */
export class Key {
  private last = '';

  changed(key: string): boolean {
    if (key === this.last) return false;
    this.last = key;
    return true;
  }

  reset(): void {
    this.last = '';
  }
}

/** A part drawn by `render` whenever `key` changes. */
export function keyed(key: (state: GameState, ctx: HudContext) => string, render: (state: GameState, ctx: HudContext) => void): Part {
  const last = new Key();
  return {
    update: (state, ctx) => {
      if (last.changed(key(state, ctx))) render(state, ctx);
    },
    reset: () => last.reset(),
  };
}

/** The HUD's turn banner (once per turn, as the turn's aiming starts) and the game over card. */
import { byId } from '../../ui/dom';
import type { GameOverCard } from '../../ui/gameover';
import { keyed, type Part } from './part';

/** "Your turn!" (online, on this phone's turn) or "<name>'s turn", in their colour: once a new turn is aiming. */
export function turnBanner(): Part {
  const bannerEl = byId('turn-banner');
  return keyed(
    (state) => `${state.turn}|${state.phase === 'gameover'}`,
    (state, { p, online }) => {
      if (state.phase !== 'aiming') return;
      bannerEl.textContent = online && state.current === online.localSeat ? 'Your turn!' : `${p.name}'s turn`;
      bannerEl.style.color = p.colour;
      bannerEl.classList.remove('show');
      void bannerEl.offsetWidth; // restart the CSS animation
      bannerEl.classList.add('show');
    },
  );
}

/** The game over card (ui/gameover.ts), with the players' ranks: it shows itself when the match is over. */
export function gameOverCard(card: GameOverCard): Part {
  return keyed(
    (state, { online }) => `${state.turn}|${state.phase === 'gameover'}|${state.phase === 'aiming'}|${online?.localSeat}`,
    (state, { ranks }) => card.show(state, (id) => ranks[id]),
  );
}

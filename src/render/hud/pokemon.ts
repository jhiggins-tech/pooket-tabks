/**
 * doctorfox's Who's That Pokémon? on the HUD: the silhouette on a burst of rays, the names to pick from (the
 * buttons are this phone's only while it's his turn here: input/controls.ts takes the taps), the seconds
 * left, and once it's fired, the answer: the picture coloured in, the right name lit up, a wrong pick
 * crossed out. MissingNo. glitches the whole card.
 */
import { guessedRight, guessLeft } from '../../game/game';
import { MISSINGNO, pokemonName } from '../../weapons/pokedex';
import { el, query } from '../../ui/dom';
import { pictureStatus, pokemonPicture } from '../pokemon-picture';
import { Overlay } from './overlay';
import { keyed, type Part } from './part';

/** What MissingNo.'s options read: garbage from the wrong bit of memory. */
const GLITCH_NAMES = ['MISSINGNO.', '▓▒ ░PkMn', "'M ▚▞ 4", '?¿?¿ ▙▟'];

export function pokemon(): Part {
  const overlay = new Overlay('pokemon');
  const img = query<HTMLImageElement>('#pokemon .pokemon-picture img');
  const answersEl = query('#pokemon .pokemon-answers');
  return keyed(
    (state, ctx) => {
      const g = state.guess;
      return g ? `${g.playerId}|${g.dex}|${g.picked}|${g.outro !== null}|${guessLeft(state)}|${pictureStatus(g.dex)}|${ctx.remote}` : '';
    },
    (state, ctx) => {
      const g = state.guess;
      overlay.show(!!g);
      if (!g) return;
      const p = state.players[g.playerId]!;
      const shown = g.outro !== null;
      const glitch = g.dex === MISSINGNO;
      const right = guessedRight(g);
      overlay.vars({ asker: p.colour });
      overlay.root.classList.toggle('glitch', glitch);
      overlay.root.classList.toggle('right', shown && right);
      overlay.root.classList.toggle('wrong', shown && !right && !glitch);
      const left = guessLeft(state);
      const loading = pictureStatus(g.dex) !== 'ok';
      overlay.title(glitch ? '❓ Wh0’s Th@t P0kém0n? · ' : '❓ Who’s That Pokémon? · ', p, left === null ? '' : loading ? ' · 📡' : ` · ⏱ ${left}`);
      const src = pokemonPicture(g.dex).src;
      if (img.getAttribute('src') !== src) img.src = src;
      img.classList.toggle('revealed', shown);
      img.alt = shown ? pokemonName(g.dex) : 'A Pokémon’s silhouette';
      answersEl.replaceChildren(
        ...g.options.map((n, i) => {
          const b = el('button', 'pokemon-answer', glitch ? GLITCH_NAMES[i % GLITCH_NAMES.length]! : pokemonName(n));
          b.dataset.answer = String(i);
          b.disabled = ctx.remote || g.done || loading;
          b.classList.toggle('picked', g.picked === i);
          b.classList.toggle('right', shown && !glitch && n === g.dex);
          b.classList.toggle('wrong', shown && g.picked === i && n !== g.dex);
          return b;
        }),
      );
      overlay.result(
        !shown ? null : glitch ? 'MISSINGNO. glitched out! It’s gone for good.' : right ? `It’s ${pokemonName(g.dex)}! +1 Calculated` : `${g.picked === null ? 'Out of time!' : 'Wrong!'} It’s ${pokemonName(g.dex)}`,
      );
    },
  );
}

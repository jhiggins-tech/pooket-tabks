/**
 * ShotDownBoyz's Stratagem on the HUD: the d-pad in the middle (its buttons are this phone's only while
 * it's his turn here: input/controls.ts takes the taps and W A S D), the arrows keyed so far over it, and
 * his stratagems on cards either side, each with its combo. As arrows go in, the arrows that fit light up
 * and the cards that no longer fit grey out; one that's re-arming says so, and for how many more turns.
 */
import { callLeft, candidates } from '../../game/game';
import { ARROW_GLYPH, stratagemOf, type Arrow } from '../../weapons/stratagems';
import { el, query } from '../../ui/dom';
import { Overlay } from './overlay';
import { keyed, type Part } from './part';

export function stratagems(): Part {
  const overlay = new Overlay('stratagems');
  const [left, right] = [...overlay.root.querySelectorAll<HTMLElement>('.strat-col')] as [HTMLElement, HTMLElement];
  const keyedEl = query('#stratagems .strat-keyed');
  const pad = [...overlay.root.querySelectorAll<HTMLButtonElement>('.strat-dpad button')];
  let wrongAt: number | null = null;
  return keyed(
    (state, ctx) => {
      const c = state.call;
      if (!c) return '';
      const p = state.players[c.playerId]!;
      return `${c.playerId}|${c.input}|${c.wrongAt}|${c.picked}|${c.done}|${callLeft(state)}|${ctx.remote}|${p.stratagems.map((s) => `${s.id}:${s.rearm}`).join()}`;
    },
    (state, ctx) => {
      const c = state.call;
      overlay.show(!!c);
      if (!c) return;
      const p = state.players[c.playerId]!;
      overlay.vars({ caller: p.colour });
      const secs = callLeft(state);
      overlay.title('📡 STRATAGEM · ', p, secs === null ? '' : ` · ⏱ ${secs}`);
      const fits = new Set(candidates(p, c.input).map((s) => s.id));
      const cards = p.stratagems.map(({ id, rearm }) => {
        const def = stratagemOf(id);
        const card = el('div', `strat-card ${def.category}`);
        card.append(el('span', 'strat-name', def.shortName));
        if (rearm > 0) {
          card.classList.add('rearming');
          card.append(el('span', 'strat-rearm', `RE-ARMING · ${rearm} turn${rearm === 1 ? '' : 's'} left`));
        } else {
          const arrows = el('span', 'strat-arrows');
          const on = fits.has(id) ? c.input.length : 0;
          [...def.combo].forEach((a, i) => arrows.append(el('span', i < on ? 'lit' : undefined, ARROW_GLYPH[a as Arrow])));
          card.append(arrows);
          card.classList.toggle('out', !fits.has(id));
          card.classList.toggle('picked', c.picked === id);
        }
        return card;
      });
      left.replaceChildren(...cards.filter((_, i) => i % 2 === 0));
      right.replaceChildren(...cards.filter((_, i) => i % 2 === 1));
      keyedEl.textContent = c.input ? [...c.input].map((a) => ARROW_GLYPH[a as Arrow]).join(' ') : '· · ·';
      // A wrong arrow: the panel shakes (restarted for each one).
      if (c.wrongAt !== wrongAt && c.wrongAt !== null) {
        overlay.root.classList.remove('wrong');
        void overlay.root.offsetWidth;
        overlay.root.classList.add('wrong');
      }
      wrongAt = c.wrongAt;
      for (const b of pad) b.disabled = ctx.remote || c.done;
      overlay.result(c.picked ? `${stratagemOf(c.picked).name.toUpperCase()}: BEACON OUT!` : c.done ? 'Out of time!' : ctx.remote ? `${p.name} is keying a stratagem` : 'Key a combo on the d-pad (or W A S D)');
    },
  );
}

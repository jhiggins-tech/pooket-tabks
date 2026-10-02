import { getCharacter } from '../../characters/roster';
import { upcoming } from '../../characters/upcoming';
import { netLog } from '../../net/log';
import { el, button, screenTop } from '../dom';
import { addCharacterOptions, characterDetails, comingSoon } from '../info';

/**
 * Choose your tank (hosting, or joining someone's game): a character, what it does, then go. `show` puts
 * the screen up (again, as the choice changes); `go` gets the character chosen.
 */
export function chooseTank(opts: { note: string; action: string; id: string; show: (els: HTMLElement[]) => void; go: (id: string) => void; back: () => void }): void {
  let id = opts.id;
  const render = () => {
    const soon = upcoming(id);
    const sel = el('select', 'tank-select');
    sel.setAttribute('aria-label', 'Your tank');
    addCharacterOptions(sel, id);
    sel.addEventListener('change', () => {
      id = sel.value;
      render();
    });
    const ok = button(soon ? 'Coming soon' : `${opts.action} with ${getCharacter(id).name}`, () => {
      if (upcoming(id)) return;
      netLog(`ui: ${opts.action} with ${id}`);
      opts.go(id);
    }, 'big');
    ok.id = 'tank-go';
    ok.disabled = !!soon;
    const bar = el('div', 'tank-bar');
    bar.append(el('span', 'online-label', 'Your tank:'), sel, ok);
    const details = el('div', 'tank-details');
    details.append(...(soon ? comingSoon(soon) : characterDetails(getCharacter(id), getCharacter(id).colours[0]!)));
    opts.show([screenTop('Choose your tank', opts.note, opts.back), bar, details]);
  };
  render();
}

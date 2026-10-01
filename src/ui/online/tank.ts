import { getCharacter, ROSTER } from '../../characters/roster';
import { netLog } from '../../net/log';
import { el, button, screenTop } from '../dom';
import { characterDetails } from '../info';

/**
 * Choose your tank (hosting, or joining someone's game): a character, what it does, then go. `show` puts
 * the screen up (again, as the choice changes); `go` gets the character chosen.
 */
export function chooseTank(opts: { note: string; action: string; id: string; show: (els: HTMLElement[]) => void; go: (id: string) => void; back: () => void }): void {
  let id = opts.id;
  const render = () => {
    const c = getCharacter(id);
    const sel = el('select', 'tank-select');
    sel.setAttribute('aria-label', 'Your tank');
    for (const r of ROSTER) sel.add(new Option(r.name, r.id, false, r.id === id));
    sel.addEventListener('change', () => {
      id = sel.value;
      render();
    });
    const ok = button(`${opts.action} with ${c.name}`, () => {
      netLog(`ui: ${opts.action} with ${id}`);
      opts.go(id);
    }, 'big');
    ok.id = 'tank-go';
    const bar = el('div', 'tank-bar');
    bar.append(el('span', 'online-label', 'Your tank:'), sel, ok);
    const details = el('div', 'tank-details');
    details.append(...characterDetails(c, c.colours[0]!));
    opts.show([screenTop('Choose your tank', opts.note, opts.back), bar, details]);
  };
  render();
}

import { LOCK_TEXT, onlineLock } from '../../characters/access';
import { getCharacter } from '../../characters/roster';
import { upcoming } from '../../characters/upcoming';
import { netLog } from '../../net/log';
import { el, button, screenTop } from '../dom';
import { addCharacterOptions, characterDetails, comingSoon } from '../info';

/**
 * Choose your tank (hosting, or joining someone's game): a character, what it does, then go. `show` puts
 * the screen up (again, as the choice changes); `go` gets the character chosen. Characters that can't be
 * played online (characters/access.ts: betas) can be looked at, with why, but not gone with.
 */
export function chooseTank(opts: { note: string; action: string; id: string; show: (els: HTMLElement[]) => void; go: (id: string) => void; back: () => void }): void {
  let id = opts.id;
  const render = () => {
    const soon = upcoming(id);
    const lock = soon ? null : onlineLock(id);
    const sel = el('select', 'tank-select');
    sel.setAttribute('aria-label', 'Your tank');
    addCharacterOptions(sel, id, true);
    sel.addEventListener('change', () => {
      id = sel.value;
      render();
    });
    const ok = button(soon ? 'Coming soon' : lock ? `🔒 ${LOCK_TEXT[lock].short}` : `${opts.action} with ${getCharacter(id).name}`, () => {
      if (upcoming(id) || onlineLock(id)) return;
      netLog(`ui: ${opts.action} with ${id}`);
      opts.go(id);
    }, 'big');
    ok.id = 'tank-go';
    ok.disabled = !!soon || !!lock;
    const bar = el('div', 'tank-bar');
    bar.append(el('span', 'online-label', 'Your tank:'), sel, ok);
    const details = el('div', 'tank-details');
    if (lock) details.append(el('p', 'tank-lock', `🔒 ${LOCK_TEXT[lock].long(getCharacter(id).name)}`));
    details.append(...(soon ? comingSoon(soon) : characterDetails(getCharacter(id), getCharacter(id).colours[0]!)));
    opts.show([screenTop('Choose your tank', opts.note, opts.back), bar, details]);
  };
  render();
}

import { LOCK_TEXT, onlineLock, type Access } from '../../characters/access';
import { getCharacter } from '../../characters/roster';
import { upcoming } from '../../characters/upcoming';
import { netLog } from '../../net/log';
import { el, button, screenTop } from '../dom';
import { addCharacterOptions, characterDetails, comingSoon } from '../info';

/** What's open to this phone's player online, and a way to spend an unlock token (ui/progress.ts, ui/xp.ts). */
export interface TankUnlocks {
  access(): Access;
  tokens(): number;
  /** Spend a token on `id` (the padlock breaking open); resolves with whether it worked. */
  unlock(id: string): Promise<boolean>;
}

/**
 * Choose your tank (hosting, or joining someone's game): a character, what it does, then go. `show` puts
 * the screen up (again, as the choice changes); `go` gets the character chosen. One that can't be played
 * online (characters/access.ts: a beta, or not unlocked) can be looked at, with why, but not gone with;
 * with an unlock token to spend, it can be unlocked right here.
 */
export function chooseTank(opts: { note: string; action: string; id: string; unlocks: TankUnlocks; show: (els: HTMLElement[]) => void; go: (id: string) => void; back: () => void }): void {
  let id = opts.id;
  const render = () => {
    const access = opts.unlocks.access();
    const soon = upcoming(id);
    const lock = soon ? null : onlineLock(id, access);
    const sel = el('select', 'tank-select');
    sel.setAttribute('aria-label', 'Your tank');
    addCharacterOptions(sel, id, access);
    sel.addEventListener('change', () => {
      id = sel.value;
      render();
    });
    const ok = button(soon ? 'Coming soon' : lock ? `🔒 ${LOCK_TEXT[lock].short}` : `${opts.action} with ${getCharacter(id).name}`, () => {
      if (upcoming(id) || onlineLock(id, opts.unlocks.access())) return;
      netLog(`ui: ${opts.action} with ${id}`);
      opts.go(id);
    }, 'big');
    ok.id = 'tank-go';
    ok.disabled = !!soon || !!lock;
    const bar = el('div', 'tank-bar');
    bar.append(el('span', 'online-label', 'Your tank:'), sel, ok);
    const details = el('div', 'tank-details');
    if (lock) details.append(lockNote(getCharacter(id).name, lock));
    details.append(...(soon ? comingSoon(soon) : characterDetails(getCharacter(id), getCharacter(id).colours[0]!)));
    opts.show([screenTop('Choose your tank', opts.note, opts.back), bar, details]);
  };
  /** Why it's locked, and (not unlocked yet, with a token) the way to unlock it. */
  const lockNote = (name: string, lock: NonNullable<ReturnType<typeof onlineLock>>) => {
    const note = el('div', 'tank-lock');
    note.append(el('p', undefined, `🔒 ${LOCK_TEXT[lock].long(name)}`));
    const tokens = opts.unlocks.tokens();
    if (lock === 'locked' && tokens > 0) {
      const chosen = id;
      const unlock = button(`🔓 Unlock ${name} (${tokens === 1 ? 'your unlock token' : `1 of your ${tokens} unlock tokens`})`, () => {
        unlock.disabled = true;
        void opts.unlocks.unlock(chosen).then(() => {
          if (id === chosen) render();
        });
      }, 'big');
      unlock.id = 'tank-unlock';
      note.append(unlock);
    } else if (lock === 'locked') {
      note.append(el('p', 'tank-lock-tokens', 'No unlock tokens yet: win online matches to earn them.'));
    }
    return note;
  };
  render();
}

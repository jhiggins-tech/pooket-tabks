import { netLog } from '../../net/log';
import type { RoomRef } from '../../net/rooms';
import { followWatchers, type Watcher } from '../../net/watchers';
import { byId, el } from '../dom';
import { hideToast, showToast } from '../toast';

/**
 * Who's watching, on screen: a 👁 chip with the count in the top bar (tap it for the names) and a toast
 * when someone starts watching. Shown to the players and to everyone watching (you're "You").
 */
export class Audience {
  private readonly chip = byId<HTMLButtonElement>('watchers');
  private readonly list = byId('watchers-list');
  private stopFollowing: (() => void) | null = null;

  constructor() {
    this.chip.addEventListener('click', () => this.open(this.list.hidden !== false));
    this.list.addEventListener('click', () => this.open(false));
  }

  /** Follow who's watching in this room (`self`: this phone's own check-in, if it's watching). Returns how to stop. */
  follow(room: RoomRef, self?: string): () => void {
    this.stop();
    const f = followWatchers(room, {
      list: (watchers) => this.show(watchers, self),
      arrive: (w) => {
        if (w.id !== self) showToast(`👁 ${w.name} just started watching`);
      },
    });
    const stop = () => {
      if (this.stopFollowing !== stop) return;
      this.stopFollowing = null;
      f.stop();
      this.show([]);
      hideToast();
    };
    this.stopFollowing = stop;
    return stop;
  }

  /** Stop following (and clear the chip and the toast). */
  stop(): void {
    this.stopFollowing?.();
  }

  private show(watchers: Watcher[], self?: string): void {
    netLog(`watchers: ${watchers.length} watching`);
    this.chip.hidden = watchers.length === 0;
    this.chip.textContent = `👁 ${watchers.length}`;
    this.chip.setAttribute('aria-label', `${watchers.length} watching: show who`);
    if (!watchers.length) this.open(false);
    const names = watchers.map((w) => el('li', w.id === self ? 'you' : undefined, w.id === self ? 'You' : w.name));
    const ul = el('ul');
    ul.append(...names);
    this.list.replaceChildren(el('b', undefined, watchers.length === 1 ? '1 watching' : `${watchers.length} watching`), ul);
  }

  private open(on: boolean): void {
    this.list.hidden = !on;
    this.chip.setAttribute('aria-expanded', String(on));
  }
}

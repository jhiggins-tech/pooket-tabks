import { followOutbox } from '../net/push';
import type { Rtdb } from '../net/rtdb';
import { showToast } from '../ui/toast';
import { isSeen, markSeen } from './seen';
import { render } from './templates';

/**
 * While the page is open, notifications for this phone arrive at once (the sender's push comes minutes
 * later, and isn't alerted again: the `seen` store and the shared tag). On screen: a toast to tap; in
 * the background: a system notification, if allowed. `here(ref)`: already in that match, so say nothing.
 */
export function notifyWhileOpen(db: Rtdb, on: { open: (ref: string) => void; here: (ref: string) => boolean }, to?: string): { stop: () => void } {
  return followOutbox(db, (e) => {
    const r = render(e.type, e.ref);
    if (!r || on.here(e.ref)) return;
    void (async () => {
      if (await isSeen(e.id)) return;
      await markSeen(e.id);
      if (document.visibilityState === 'visible') return showToast(`${r.title} ${r.body}`, () => on.open(e.ref));
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const reg = await navigator.serviceWorker?.ready;
      await reg?.showNotification(r.title, { body: r.body, tag: `evt-${e.id}`, icon: './icon.svg', badge: './icon.svg', data: { url: r.url, eventId: e.id } });
    })();
  }, to);
}

/**
 * Pooket Tabks' service worker: shows push notifications ("your turn", "someone joined your game") and
 * opens the game when one is tapped. It doesn't cache anything (the page loads as normal).
 *
 * Each push is a `PushPayload` ({ eventId, title, body, url, tag }, src/push/templates.ts) from the
 * sender (notifier/). A notification the open page already showed (the `seen` store in IndexedDB, shared
 * with src/push/seen.ts) isn't alerted again. Every push must still end in a visible notification
 * (Chrome insists, and iOS revokes subscriptions that don't), so a repeat replaces the one in the tray
 * quietly instead.
 *
 * A classic service worker can't import, so it keeps its own copies of templates.ts's `PUSH_ICON` and
 * `showOptions` (below): keep them in step. Phones pick up a new version of this file by themselves (the
 * browser checks it for changes, byte for byte, when the page registers it).
 */
const DB = 'pooket-push';
const STORE = 'seen';
const KEEP_MS = 7 * 24 * 60 * 60_000;
/** templates.ts `PUSH_ICON`. */
const ICON = './icon.svg';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function isSeen(id) {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result !== undefined);
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

async function markSeen(id) {
  try {
    const db = await openDb();
    const now = Date.now();
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    store.put(now, id);
    const all = store.openCursor();
    all.onsuccess = () => {
      const c = all.result;
      if (!c) return;
      if (typeof c.value === 'number' && now - c.value > KEEP_MS) c.delete();
      c.continue();
    };
  } catch {
    /* the worst is an alert twice */
  }
}

const isIos = () => /iPhone|iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

async function onPush(event) {
  let msg = null;
  try {
    msg = event.data ? event.data.json() : null;
  } catch {
    msg = null;
  }
  if (!msg || typeof msg.title !== 'string' || typeof msg.eventId !== 'string') {
    // Something's off with it, but a push must always show something.
    return self.registration.showNotification('Pooket Tabks', { body: 'Something happened in one of your games.', icon: ICON, badge: ICON });
  }
  // templates.ts `showOptions`.
  const options = { body: msg.body, tag: msg.tag, icon: ICON, badge: ICON, data: { url: msg.url, eventId: msg.eventId } };
  if (!(await isSeen(msg.eventId))) {
    await self.registration.showNotification(msg.title, options);
    return markSeen(msg.eventId);
  }
  // Seen already (the open page showed it). Still in the tray: leave it be.
  const shown = await self.registration.getNotifications({ tag: msg.tag });
  if (shown.length) return;
  // Dismissed already: replace it quietly. On Android, take it straight away again; iOS revokes
  // subscriptions whose pushes don't end in a notification, so there it stays.
  await self.registration.showNotification(msg.title, { ...options, silent: true });
  if (!isIos()) {
    for (const n of await self.registration.getNotifications({ tag: msg.tag })) n.close();
  }
}

self.addEventListener('push', (event) => event.waitUntil(onPush(event)));

async function onClick(event) {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = windows.find((w) => w.url.startsWith(self.registration.scope));
  if (open) {
    await open.focus();
    open.postMessage({ type: 'open', url });
    return;
  }
  await self.clients.openWindow(url);
}

self.addEventListener('notificationclick', (event) => event.waitUntil(onClick(event)));

/**
 * The notifications already shown on this phone (outbox entry id → when), in IndexedDB so the page
 * and the service worker (public/sw.js, which keeps its own copy of these few lines) share it: an
 * entry the open page has shown isn't alerted again when its push arrives. Kept a week.
 */

const DB = 'pooket-push';
const STORE = 'seen';
const KEEP_MS = 7 * 24 * 60 * 60_000;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function isSeen(id: string): Promise<boolean> {
  try {
    const db = await open();
    return await new Promise<boolean>((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result !== undefined);
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/** Note it as shown (and forget ones older than a week). */
export async function markSeen(id: string, now = Date.now()): Promise<void> {
  try {
    const db = await open();
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
    /* no IndexedDB (a private window): the worst is an alert twice */
  }
}

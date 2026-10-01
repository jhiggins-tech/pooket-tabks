import { netLog } from './log';
import type { Rtdb } from './rtdb';
import type { Sealer } from './seal';
import { openSealed, putSealed } from './sealed';

/**
 * Who's watching a match. Each spectator checks in to the room (`watchers/<id>`: its name, sealed with
 * the room code like everything else in it) every CHECK_IN_MS while it watches, and checks out when it
 * stops. The players and the other spectators follow the list; a check-in older than WATCHER_STALE_MS no
 * longer counts (a phone that went without checking out).
 */

/** A room in the database: where it is and its seal. */
export interface RoomRef {
  db: Rtdb;
  /** `rooms/<topic>` */
  path: string;
  sealer: Sealer;
}

export interface Watcher {
  id: string;
  name: string;
}

export const CHECK_IN_MS = 20_000;
export const WATCHER_STALE_MS = 60_000;

/** Watch as `name`: checked in until `stop()`. */
export function checkIn(room: RoomRef, id: string, name: string): { stop: () => void } {
  const path = `${room.path}/watchers/${id}`;
  const put = () =>
    void putSealed(room.db, path, room.sealer, { name }).catch((e: unknown) => netLog(`watchers: couldn't check in (${e instanceof Error ? e.message : e})`));
  put();
  const timer = setInterval(put, CHECK_IN_MS);
  netLog('watchers: checked in');
  return {
    stop: () => {
      clearInterval(timer);
      void room.db.remove(path).catch(() => {});
      netLog('watchers: checked out');
    },
  };
}

/**
 * Follow who's watching: `onList` gets everyone checked in (oldest first) whenever that changes, and
 * `onArrive` each spectator who turns up after we started following (not the ones already there).
 */
export function followWatchers(room: RoomRef, on: { list: (watchers: Watcher[]) => void; arrive: (w: Watcher) => void }, now = () => Date.now()): { stop: () => void } {
  const base = `${room.path}/watchers`;
  const entries = new Map<string, { name: string; ts: number }>();
  /** Everyone seen so far (only newcomers are announced); null until the first look at the list. */
  let known: Set<string> | null = null;
  let last = '';
  const emit = () => {
    const list = [...entries.entries()]
      .filter(([, e]) => now() - e.ts < WATCHER_STALE_MS)
      .sort((a, b) => a[1].ts - b[1].ts)
      .map(([id, e]) => ({ id, name: e.name }));
    const key = JSON.stringify(list);
    if (key === last) return;
    last = key;
    on.list(list);
  };
  const take = async (id: string, raw: unknown) => {
    const entry = raw === null ? null : await openSealed<{ name?: unknown }>(room.sealer, raw);
    const name = entry && typeof entry.value.name === 'string' ? entry.value.name.slice(0, 40) : null;
    if (!entry || name === null) entries.delete(id);
    else {
      entries.set(id, { name, ts: entry.ts });
      if (known && !known.has(id) && now() - entry.ts < WATCHER_STALE_MS) {
        netLog(`watchers: ${name} started watching`);
        on.arrive({ id, name });
      }
      known?.add(id);
    }
  };
  const stream = room.db.stream(base, (e) => {
    if (e.path === '/') {
      const all = Object.entries((e.data as Record<string, unknown>) ?? {});
      known ??= new Set(all.map(([id]) => id)); // already watching when we started following
      entries.clear();
      void Promise.all(all.map(([id, v]) => take(id, v))).then(emit);
    } else {
      const id = e.path.slice(1).split('/')[0];
      if (!id) return;
      // A whole entry, or part of one (read it whole).
      const raw = e.path.slice(1).includes('/') ? room.db.get(`${base}/${id}`) : Promise.resolve(e.data);
      void raw.then((v) => take(id, v)).then(emit);
    }
  });
  // Check-ins go stale even when nothing changes.
  const timer = setInterval(emit, 5000);
  return {
    stop: () => {
      clearInterval(timer);
      stream.close();
    },
  };
}

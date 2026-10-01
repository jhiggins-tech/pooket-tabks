import { isPushType, type PushType } from '../push/templates';
import { netLog } from './log';
import { SERVER_TIME, type Rtdb } from './rtdb';
import { getSealed, putSealed } from './sealed';
import type { RoomRef } from './watchers';

/**
 * Notifications between the two phones in a match ("your turn", "someone joined your game"), the
 * database side. Each phone has a random id (`clientId`); in each of its rooms it says which device it
 * is (`devices/<host|guest>`, sealed with the room code: { clientId, seatId, push }). When the other
 * player should hear about something and isn't there, this phone looks up their device and adds an
 * entry to the `outbox` ({ type, ref, to, originClientId, createdAt }: no text, and the room's topic, not
 * its code). From there a page that's open shows it at once (`followOutbox`), and the sender (`notifier/`,
 * a scheduled GitHub Action) pushes it to the device's subscriptions (`pushSubscriptions`, see
 * push/client.ts) and clears it.
 */

const CLIENT_KEY = 'pooket.clientId';
const WANTS_KEY = 'pooket.push';

/** This install's id (made once, kept in localStorage; not a secret, just which phone it is). */
export function clientId(): string {
  try {
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id) {
      id = globalThis.crypto.randomUUID();
      localStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  } catch {
    return (memoryId ??= globalThis.crypto.randomUUID());
  }
}
let memoryId: string | undefined;

/** Whether this phone has notifications on (set by push/client.ts once it's subscribed). */
export function wantsPush(set?: boolean): boolean {
  try {
    if (set !== undefined) localStorage.setItem(WANTS_KEY, set ? 'on' : 'off');
    return localStorage.getItem(WANTS_KEY) === 'on';
  } catch {
    return set ?? false;
  }
}

interface Device {
  clientId: string;
  /** The seat's id in the room (so a device left over from an earlier game in the same room doesn't count). */
  seatId: string;
  push: boolean;
}

/** Say which device holds this seat (whenever it takes it, or comes back to it). */
export function announceDevice(room: RoomRef, role: 'host' | 'guest', seatId: string): void {
  const device: Device = { clientId: clientId(), seatId, push: wantsPush() };
  void putSealed(room.db, `${room.path}/devices/${role}`, room.sealer, device).catch((e: unknown) =>
    netLog(`push: couldn't announce this device (${e instanceof Error ? e.message : e})`),
  );
}

/** Tell whoever holds `role` in this room about `type` (if they have notifications on). Best effort. */
export async function notifySeat(room: RoomRef, role: 'host' | 'guest', type: PushType): Promise<void> {
  try {
    const [device, seat] = await Promise.all([getSealed<Device>(room.db, `${room.path}/devices/${role}`, room.sealer), room.db.get<{ id?: string }>(`${room.path}/${role}`)]);
    const d = device?.value;
    if (!d || !d.push || d.seatId !== seat?.id || d.clientId === clientId()) return netLog(`push: no ${type} for the ${role} (notifications off, or not known)`);
    await room.db.post('outbox', { type, ref: room.sealer.topic, to: d.clientId, originClientId: clientId(), createdAt: SERVER_TIME });
    netLog(`push: told the ${role} (${type})`);
  } catch (e) {
    netLog(`push: couldn't send ${type} (${e instanceof Error ? e.message : e})`);
  }
}

export interface OutboxEntry {
  id: string;
  type: PushType;
  ref: string;
}

/** Entries for this phone as they're added (not the ones already there when it started following). */
export function followOutbox(db: Rtdb, onEntry: (e: OutboxEntry) => void): { stop: () => void } {
  const me = clientId();
  let known: Set<string> | null = null;
  const take = (id: string, v: unknown) => {
    const e = v as { type?: unknown; ref?: unknown; to?: unknown } | null;
    if (!known || known.has(id)) return;
    known.add(id);
    if (e?.to !== me || !isPushType(e.type) || typeof e.ref !== 'string') return;
    netLog(`push: ${e.type} for this phone`);
    onEntry({ id, type: e.type, ref: e.ref });
  };
  const stream = db.stream(
    'outbox',
    (ev) => {
      if (ev.path === '/') {
        const all = Object.entries((ev.data as Record<string, unknown>) ?? {});
        if (!known) known = new Set(all.map(([id]) => id)); // already there: old news (or pushed already)
        for (const [id, v] of all) take(id, v);
      } else {
        const id = ev.path.slice(1).split('/')[0];
        if (id && !ev.path.slice(1).includes('/')) take(id, ev.data);
      }
    },
    { child: 'to', value: me },
  );
  return { stop: () => stream.close() };
}

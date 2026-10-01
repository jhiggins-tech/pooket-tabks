import { fromB64, toB64 } from './b64';
import { SERVER_TIME, type Rtdb } from './rtdb';
import { seal, unseal, type Sealer } from './seal';

/**
 * Sealed entries in the database: `{ m: <the value, sealed, base64>, ts: <server time of the write> }`.
 * The records, open offers, Games list and replays are all stored this way (the database rules check
 * the shape and that `ts` isn't in the future).
 */

/** Seal `value` and write it at `path`, stamped with the server's time. */
export async function putSealed(db: Rtdb, path: string, sealer: Sealer, value: unknown): Promise<void> {
  await db.put(path, { m: toB64(await seal(sealer, value)), ts: SERVER_TIME });
}

/** An entry as read from the database (or a stream): its value and when it was written, or null if it isn't one of ours. */
export async function openSealed<T>(sealer: Sealer, raw: unknown): Promise<{ value: T; ts: number } | null> {
  const e = raw as { m?: unknown; ts?: unknown } | null;
  if (typeof e?.m !== 'string') return null;
  const value = await unseal(sealer, fromB64(e.m));
  if (value === null || value === undefined) return null;
  return { value: value as T, ts: typeof e.ts === 'number' ? e.ts : 0 };
}

/** Read and open the entry at `path` (null: nothing there, or not ours). */
export async function getSealed<T>(db: Rtdb, path: string, sealer: Sealer): Promise<{ value: T; ts: number } | null> {
  return openSealed<T>(sealer, await db.get(path));
}

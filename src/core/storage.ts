/**
 * localStorage, best effort: it can be missing or throw (private mode, storage full, blocked), and
 * nothing saved this way is critical, so reads fall back to "nothing saved" and writes just report
 * whether they stuck. Keys are whatever each caller already uses (some `pooket.*`, some `pooket-tabks.*`):
 * never rename one, or what phones have saved is lost.
 */

/** The value saved under `key` (null: nothing saved, or storage unavailable). */
export function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Save `value` under `key`; false if storage is unavailable (it lasts this visit at most). */
export function writeStore(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** The JSON saved under `key`, parsed (null: nothing saved, storage unavailable, or not JSON). Check its shape. */
export function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as unknown;
  } catch {
    return null;
  }
}

/** Save `value` as JSON under `key`; false if storage is unavailable. */
export function writeJson(key: string, value: unknown): boolean {
  return writeStore(key, JSON.stringify(value));
}

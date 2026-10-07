/**
 * The senders' set-up (notify.ts and stats.ts): reading their settings from the environment and
 * connecting firebase-admin. A set-up problem stops the run (exit 1) with a line saying what's wrong,
 * never the values themselves (some are secret). Node runs it as is (plain TypeScript).
 */
import { cert, initializeApp } from 'firebase-admin/app';

/** Stop with a set-up problem, naming what's wrong but never printing the values (some are secret). */
export function setupError(what: string): never {
  console.error(`set-up problem: ${what}`);
  process.exit(1);
}

/**
 * The settings named, each as pasted into GitHub without stray spaces or quotes around it. Any missing:
 * says which, and stops.
 */
export function readEnv<const K extends string>(needed: readonly K[]): Record<K, string> {
  const missing = needed.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`missing: ${missing.join(', ')}`);
    process.exit(1);
  }
  return Object.fromEntries(needed.map((k) => [k, process.env[k]!.trim().replace(/^(['"])(.*)\1$/s, '$2').trim()])) as Record<K, string>;
}

/** Connect firebase-admin with the service account (the whole downloaded JSON file) to the database. */
export function initFirebase(env: { FIREBASE_SERVICE_ACCOUNT: string; FIREBASE_DATABASE_URL: string }): void {
  let account: object;
  try {
    account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) as object;
  } catch {
    setupError("FIREBASE_SERVICE_ACCOUNT isn't JSON (paste the whole downloaded file)");
  }
  try {
    initializeApp({ credential: cert(account), databaseURL: env.FIREBASE_DATABASE_URL });
  } catch {
    setupError('FIREBASE_SERVICE_ACCOUNT or FIREBASE_DATABASE_URL was refused by firebase-admin');
  }
}

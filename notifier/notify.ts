/**
 * The push sender, run every few minutes by .github/workflows/notify.yml: drains the outbox in the
 * Firebase Realtime Database into Web Push notifications (drain.ts), then exits. Node runs it as is
 * (`node notify.ts`: plain TypeScript).
 *
 * Needs (repo secrets and variables; README, "Push notifications"): VAPID_PRIVATE_KEY and
 * FIREBASE_SERVICE_ACCOUNT (secrets), VAPID_PUBLIC_KEY, VAPID_SUBJECT and FIREBASE_DATABASE_URL
 * (variables). Exits 1 only when something's set up wrong (or the database can't be reached), so a red
 * run always means something to fix; a push that fails is just counted.
 */
import { cert, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import webpush from 'web-push';
import { drain, type OutboxEntry, type Store, type Subscription } from './drain.ts';

const NEEDED = ['VAPID_PRIVATE_KEY', 'FIREBASE_SERVICE_ACCOUNT', 'VAPID_PUBLIC_KEY', 'VAPID_SUBJECT', 'FIREBASE_DATABASE_URL'] as const;
const missing = NEEDED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`missing: ${missing.join(', ')}`);
  process.exit(1);
}
/** A value as pasted into GitHub, without stray spaces or quotes around it. */
const env = Object.fromEntries(NEEDED.map((k) => [k, process.env[k]!.trim().replace(/^(['"])(.*)\1$/s, '$2').trim()])) as Record<(typeof NEEDED)[number], string>;

/** Stop with a set-up problem, naming what's wrong but never printing the values (some are secret). */
function setupError(what: string): never {
  console.error(`set-up problem: ${what}`);
  process.exit(1);
}

// The push services want a contact URL: `mailto:you@example.com` (a bare address gets the mailto:) or https://.
const subject = /^(mailto:|https:\/\/)/.test(env.VAPID_SUBJECT) ? env.VAPID_SUBJECT : env.VAPID_SUBJECT.includes('@') ? `mailto:${env.VAPID_SUBJECT}` : setupError('VAPID_SUBJECT should be mailto:you@example.com (or an https:// URL)');
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
try {
  webpush.setVapidDetails(subject, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
} catch {
  setupError("the VAPID keys weren't accepted (both from the same `generate-vapid-keys` run, pasted whole)");
}
const db = getDatabase();

const children = <T>(snap: { forEach: (fn: (c: { key: string | null; val: () => unknown }) => boolean | void) => boolean }): [string, T][] => {
  const out: [string, T][] = [];
  snap.forEach((c) => {
    if (c.key) out.push([c.key, c.val() as T]);
  });
  return out;
};

const store: Store = {
  outbox: async (limit) => children<OutboxEntry>(await db.ref('outbox').orderByChild('createdAt').limitToFirst(limit).get()),
  subscriptions: async () => children<Subscription>(await db.ref('pushSubscriptions').get()),
  deleteEntry: (id) => db.ref(`outbox/${id}`).remove(),
  setAttempts: (id, attempts) => db.ref(`outbox/${id}/attempts`).set(attempts),
  deleteSubscription: (id) => db.ref(`pushSubscriptions/${id}`).remove(),
};

const push = async (sub: Subscription, payload: string): Promise<number> => {
  try {
    const res = await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, { TTL: 86_400, urgency: 'high' });
    return res.statusCode;
  } catch (e) {
    const status = (e as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number') return status;
    throw e;
  }
};

try {
  await drain(store, push);
  process.exit(0);
} catch (e) {
  // (Database or set-up trouble: push errors are counted inside, never thrown, so no endpoint can show.)
  console.error(`couldn't drain the outbox: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

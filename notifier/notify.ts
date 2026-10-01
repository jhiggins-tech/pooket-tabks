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
const env = process.env as Record<(typeof NEEDED)[number], string>;

initializeApp({ credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)), databaseURL: env.FIREBASE_DATABASE_URL });
webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
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

/**
 * The push sender, run every few minutes by .github/workflows/notify.yml: drains the outbox in the
 * Firebase Realtime Database into Web Push notifications (drain.ts), then exits. Node runs it as is
 * (`node notify.ts`: plain TypeScript).
 *
 * Needs (README, "Push notifications"): VAPID_PRIVATE_KEY and FIREBASE_SERVICE_ACCOUNT (secrets), and
 * VAPID_PUBLIC_KEY, VAPID_SUBJECT and FIREBASE_DATABASE_URL (each a secret or a variable). Exits 1 only
 * when something's set up wrong (or the database can't be reached), so a red run always means something
 * to fix; a push that fails is just counted.
 */
import { getDatabase } from 'firebase-admin/database';
import webpush from 'web-push';
import { drain, type OutboxEntry, type Store, type Subscription } from './drain.ts';
import { initFirebase, readEnv, setupError } from './setup.ts';

const env = readEnv(['VAPID_PRIVATE_KEY', 'FIREBASE_SERVICE_ACCOUNT', 'VAPID_PUBLIC_KEY', 'VAPID_SUBJECT', 'FIREBASE_DATABASE_URL']);

// The push services want a contact URL: `mailto:you@example.com` (a bare address gets the mailto:) or https://.
const subject = /^(mailto:|https:\/\/)/.test(env.VAPID_SUBJECT) ? env.VAPID_SUBJECT : env.VAPID_SUBJECT.includes('@') ? `mailto:${env.VAPID_SUBJECT}` : setupError('VAPID_SUBJECT should be mailto:you@example.com (or an https:// URL)');
initFirebase(env);
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
  accountDevices: async (uid) => Object.keys(((await db.ref(`users/${uid}/push`).get()).val() as Record<string, unknown> | null) ?? {}),
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

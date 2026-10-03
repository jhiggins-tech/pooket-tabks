/**
 * Drains the outbox once: each entry becomes a Web Push to the subscriptions of the device it's for (or,
 * addressed to a signed-in player's account, `u:<uid>`, of every phone they've signed in to with
 * notifications on: `users/<uid>/push`), then goes. The database and the push service come in through `Store` and `Pusher` (notify.ts wires up
 * firebase-admin and web-push; the tests use fakes). Run by Node as is (plain TypeScript, `.ts` imports).
 *
 * Logs are public (the repo is): counts, types and the first 8 characters of a subscription's id only,
 * never endpoints, keys or what a notification says.
 */
import { render } from '../src/push/templates.ts';

export interface OutboxEntry {
  type?: unknown;
  ref?: unknown;
  to?: unknown;
  originClientId?: unknown;
  createdAt?: unknown;
  attempts?: unknown;
}

export interface Subscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  clientId: string;
}

export interface Store {
  /** The oldest entries first, at most `limit`. */
  outbox(limit: number): Promise<[string, OutboxEntry][]>;
  subscriptions(): Promise<[string, Subscription][]>;
  deleteEntry(id: string): Promise<void>;
  setAttempts(id: string, attempts: number): Promise<void>;
  deleteSubscription(id: string): Promise<void>;
  /** The devices (clientIds) a signed-in player has notifications on for. */
  accountDevices(uid: string): Promise<string[]>;
}

/** An entry for an account rather than one device: `u:` and the account's uid. */
const ACCOUNT = /^u:([A-Za-z0-9_-]{1,128})$/;

/** Send one push: the push service's status code (a network error throws). */
export type Pusher = (sub: Subscription, payload: string) => Promise<number>;

export interface Summary {
  entries: number;
  sent: number;
  pruned: number;
  failed: number;
  retrying: number;
  stale: number;
  unknown: number;
}

/** Entries older than this go unsent (the push service would only hold them a day anyway). */
export const STALE_MS = 24 * 60 * 60_000;
export const BATCH = 200;
export const MAX_ATTEMPTS = 3;
const PARALLEL = 10;
const RETRY_AFTER_MS = 2000;

type Outcome = 'sent' | 'gone' | 'failed' | 'retry';

export async function drain(store: Store, push: Pusher, opts: { now?: number; log?: (line: string) => void; sleep?: (ms: number) => Promise<void> } = {}): Promise<Summary> {
  const now = opts.now ?? Date.now();
  const log = opts.log ?? ((line: string) => console.log(line));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const summary: Summary = { entries: 0, sent: 0, pruned: 0, failed: 0, retrying: 0, stale: 0, unknown: 0 };

  const entries = await store.outbox(BATCH);
  if (!entries.length) {
    log('outbox empty');
    return summary;
  }
  const subs = await store.subscriptions();
  const pruned = new Set<string>();
  const accounts = new Map<string, Promise<string[]>>();
  /** Which devices an entry is for: the one it names, or an account's (looked up once a run). */
  const devicesFor = async (to: string): Promise<Set<string>> => {
    const uid = ACCOUNT.exec(to)?.[1];
    if (!uid) return new Set([to]);
    if (!accounts.has(uid)) accounts.set(uid, store.accountDevices(uid));
    return new Set(await accounts.get(uid)!);
  };

  /** Send to one subscription: a 429 or 5xx (or no answer) gets one more go after a moment. */
  const sendTo = async (subId: string, sub: Subscription, payload: string): Promise<Outcome> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      let status: number;
      try {
        status = await push(sub, payload);
      } catch {
        status = 0;
      }
      if (status >= 200 && status < 300) return 'sent';
      if (status === 404 || status === 410) {
        if (!pruned.has(subId)) {
          pruned.add(subId);
          await store.deleteSubscription(subId);
          log(`pruned ${subId.slice(0, 8)} (${status})`);
        }
        return 'gone';
      }
      if (status === 413 || (status >= 400 && status < 500 && status !== 429)) {
        log(`failed ${subId.slice(0, 8)} (${status})`);
        return 'failed';
      }
      if (attempt === 0) await sleep(RETRY_AFTER_MS);
    }
    return 'retry';
  };

  for (const [id, e] of entries) {
    summary.entries++;
    const createdAt = typeof e.createdAt === 'number' ? e.createdAt : 0;
    if (now - createdAt > STALE_MS) {
      summary.stale++;
      await store.deleteEntry(id);
      continue;
    }
    const shown = render(e.type, e.ref);
    if (!shown || typeof e.to !== 'string' || (e.to.startsWith('u:') && !ACCOUNT.test(e.to))) {
      summary.unknown++;
      log(`unknown entry (${typeof e.type === 'string' ? e.type.slice(0, 20) : typeof e.type}): dropped`);
      await store.deleteEntry(id);
      continue;
    }
    const payload = JSON.stringify({ eventId: id, title: shown.title, body: shown.body, url: shown.url, tag: `evt-${id}` });
    const devices = await devicesFor(e.to);
    const targets = subs.filter(([subId, s]) => devices.has(s.clientId) && s.clientId !== e.originClientId && !pruned.has(subId));
    const outcomes: Outcome[] = [];
    for (let i = 0; i < targets.length; i += PARALLEL) {
      outcomes.push(...(await Promise.all(targets.slice(i, i + PARALLEL).map(([subId, s]) => sendTo(subId, s, payload)))));
    }
    summary.sent += outcomes.filter((o) => o === 'sent').length;
    summary.pruned += outcomes.filter((o) => o === 'gone').length;
    summary.failed += outcomes.filter((o) => o === 'failed').length;
    if (outcomes.includes('retry')) {
      const attempts = (typeof e.attempts === 'number' ? e.attempts : 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        summary.failed++;
        log(`${e.type}: gave up after ${attempts} runs`);
        await store.deleteEntry(id);
      } else {
        summary.retrying++;
        await store.setAttempts(id, attempts);
      }
    } else {
      await store.deleteEntry(id);
    }
    log(`${e.type}: ${targets.length} device subscription(s), ${outcomes.filter((o) => o === 'sent').length} sent`);
  }
  log(
    `done: ${summary.entries} entries, ${summary.sent} sent, ${summary.pruned} pruned, ${summary.failed} failed, ${summary.retrying} to retry, ${summary.stale} stale, ${summary.unknown} unknown`,
  );
  return summary;
}

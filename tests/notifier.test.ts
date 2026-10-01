import { describe, expect, it } from 'vitest';
import { drain, MAX_ATTEMPTS, STALE_MS, type OutboxEntry, type Store, type Subscription } from '../notifier/drain';

const REF = '0123456789abcdef01234567';
const NOW = 1_800_000_000_000;

function fakeStore(outbox: Record<string, OutboxEntry>, subs: Record<string, Subscription>) {
  const store: Store & { outboxNow: typeof outbox; subsNow: typeof subs } = {
    outboxNow: outbox,
    subsNow: subs,
    outbox: async (limit) => Object.entries(outbox).sort((a, b) => Number(a[1].createdAt) - Number(b[1].createdAt)).slice(0, limit),
    subscriptions: async () => Object.entries(subs),
    deleteEntry: async (id) => void delete outbox[id],
    setAttempts: async (id, n) => void (outbox[id]!.attempts = n),
    deleteSubscription: async (id) => void delete subs[id],
  };
  return store;
}
const sub = (clientId: string, n = 1): Subscription => ({ endpoint: `https://push.example/${clientId}/${n}`, keys: { p256dh: 'p', auth: 'a' }, clientId });
const entry = (o: Partial<OutboxEntry> = {}): OutboxEntry => ({ type: 'your-turn', ref: REF, to: 'bob', originClientId: 'ann', createdAt: NOW - 1000, ...o });
const quiet = { now: NOW, log: () => {}, sleep: async () => {} };

describe('the push sender (notifier/drain.ts)', () => {
  it("pushes each entry to its device's subscriptions only, as the shared template says, then clears it", async () => {
    const store = fakeStore({ e1: entry() }, { s1: sub('bob', 1), s2: sub('bob', 2), s3: sub('ann'), s4: sub('cat') });
    const sent: { endpoint: string; payload: Record<string, unknown> }[] = [];
    const summary = await drain(store, async (s, payload) => (sent.push({ endpoint: s.endpoint, payload: JSON.parse(payload) }), 201), quiet);
    expect(sent.map((s) => s.endpoint).sort()).toEqual(['https://push.example/bob/1', 'https://push.example/bob/2']);
    expect(sent[0]!.payload).toEqual({ eventId: 'e1', title: '🎯 Your turn!', body: 'Your move in Pooket Tabks. Tap to play.', url: `./#play=${REF}`, tag: 'evt-e1' });
    expect(store.outboxNow).toEqual({});
    expect(summary).toMatchObject({ entries: 1, sent: 2 });
  });

  it('drops stale and unknown entries unsent; prunes dead subscriptions', async () => {
    const store = fakeStore(
      { old: entry({ createdAt: NOW - STALE_MS - 1 }), odd: entry({ type: 'hack' }), badref: entry({ ref: 'ABCD' }), ok: entry() },
      { gone: sub('bob', 1), fine: sub('bob', 2) },
    );
    let pushes = 0;
    const summary = await drain(store, async (s) => (pushes++, s.endpoint.endsWith('/1') ? 410 : 201), quiet);
    expect(pushes).toBe(2);
    expect(Object.keys(store.subsNow)).toEqual(['fine']);
    expect(store.outboxNow).toEqual({});
    expect(summary).toMatchObject({ stale: 1, unknown: 2, sent: 1, pruned: 1 });
  });

  it('a busy push service gets one more go; still busy, the entry waits for the next run, up to 3 runs', async () => {
    const store = fakeStore({ e1: entry() }, { s1: sub('bob') });
    let calls = 0;
    const busy = async () => (calls++, 503);
    await drain(store, busy, quiet);
    expect(calls).toBe(2); // tried again after a moment
    expect(store.outboxNow.e1?.attempts).toBe(1);
    for (let run = 2; run <= MAX_ATTEMPTS; run++) await drain(store, busy, quiet);
    expect(store.outboxNow).toEqual({}); // given up
    // A network error counts as busy; a 4xx (other than 429) is final.
    const s2 = fakeStore({ e2: entry() }, { s1: sub('bob') });
    await drain(s2, async () => { throw new Error('offline'); }, quiet);
    expect(s2.outboxNow.e2?.attempts).toBe(1);
    const s3 = fakeStore({ e3: entry() }, { s1: sub('bob') });
    const summary = await drain(s3, async () => 413, quiet);
    expect(s3.outboxNow).toEqual({});
    expect(summary.failed).toBe(1);
  });

  it("never logs endpoints or keys; an empty outbox doesn't even read the subscriptions", async () => {
    const lines: string[] = [];
    const store = fakeStore({ e1: entry() }, { abcdef1234567890: sub('bob') });
    await drain(store, async () => 410, { ...quiet, log: (l) => lines.push(l) });
    expect(lines.join('\n')).not.toMatch(/push\.example|p256dh|abcdef1234567890/);
    expect(lines.join('\n')).toContain('abcdef12');
    let read = false;
    const empty = fakeStore({}, {});
    empty.subscriptions = async () => ((read = true), []);
    await drain(empty, async () => 201, quiet);
    expect(read).toBe(false);
  });
});

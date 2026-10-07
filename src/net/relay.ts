import { fromB64, toB64 } from './b64';
import { errText, netLog } from './log';
import type { RtdbEvent } from './rtdb';
import type { RoomRef } from './rooms';
import { seal, unseal } from './seal';
import type { Transport } from './transport';

/** A seat's message queues in the room: the one it posts to (`outbox`) and the one it reads (`inbox`). */
export function queuesFor(side: 'host' | 'guest'): { outbox: 'h2g' | 'g2h'; inbox: 'h2g' | 'g2h' } {
  return side === 'host' ? { outbox: 'h2g', inbox: 'g2h' } : { outbox: 'g2h', inbox: 'h2g' };
}

/** How often to ping while the other phone is away (enough to notice each other again after a blip). */
const QUIET_PING_MS = 30_000;

/**
 * A message pipe through a room: each side posts sealed, numbered batches to its outbox and streams
 * the other's, delivering in order and deleting what it has read. Pings every few seconds; silence for
 * too long means the other phone has gone quiet (`onQuiet`), not that the match is over: it may come
 * back (a blip, or rejoining after a reload). Only the room closing ends it (`onClose`).
 *
 * Each pipe numbers its batches within an epoch (when it started): a phone that rejoins starts a new
 * epoch at 1, and the other side switches to it and ignores anything left over from the old one.
 */
export class RelayTransport implements Transport {
  onMessage: (msg: unknown) => void = () => {};
  onClose: () => void = () => {};
  onQuiet: (quiet: boolean) => void = () => {};
  private readonly outbox: string;
  private readonly inbox: string;
  private readonly queue: unknown[] = [];
  private readonly retry: { seq: number; payload: string }[] = [];
  private epoch = Date.now();
  private seqOut = 0;
  private expected = 1;
  /** The other side's current epoch (0: not heard yet), and batches waiting for their turn in it. */
  private peerEpoch = 0;
  private pending = new Map<number, unknown[]>();
  /** Batches from a newer epoch of theirs, until its first batch arrives. */
  private readonly future = new Map<number, Map<number, unknown[]>>();
  private quiet = false;
  private lastRoomCheck = 0;
  private readonly seen = new Set<string>();
  private toDelete: string[] = [];
  private sending = false;
  private lastHeard = Date.now();
  private lastSent = 0;
  private closed = false;
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private stream: { close: () => void } | null = null;

  constructor(
    /** The room it goes through. */
    readonly room: RoomRef,
    private readonly side: 'host' | 'guest',
    /** `me`/`peer`: the seat ids of this phone and the other one; batches from anyone else are ignored. */
    private readonly opts: { pingMs?: number; lostMs?: number; me?: string; peer?: string } = {},
  ) {
    const queues = queuesFor(side);
    this.outbox = `${room.path}/${queues.outbox}`;
    this.inbox = `${room.path}/${queues.inbox}`;
  }

  start(): this {
    this.stream = this.room.db.stream(this.inbox, (e) => this.onEvent(e));
    const ping = this.opts.pingMs ?? 4000;
    const lost = this.opts.lostMs ?? 20_000;
    this.timers.push(
      setInterval(() => {
        const now = Date.now();
        // Nobody's listening while they're away (turn by turn, they may be gone for days): ping rarely.
        if (now - this.lastSent >= (this.quiet ? QUIET_PING_MS : ping)) this.send({ k: '~ping' });
        if (now - this.lastHeard > lost) {
          if (!this.quiet) {
            this.quiet = true;
            netLog(`relay: nothing from the other phone for ${Math.round((now - this.lastHeard) / 1000)}s`);
            this.onQuiet(true);
          }
          // Waiting for them to come back: unless the room has closed.
          if (now - this.lastRoomCheck >= Math.max(ping, 3000)) {
            this.lastRoomCheck = now;
            void this.room.db.get(`${this.room.path}/host`).then(
              (h) => {
                if (h === null && !this.closed) {
                  netLog('relay: the room has closed');
                  this.handleClose();
                }
              },
              () => {},
            );
          }
        }
      }, Math.min(ping, 1000)),
      setInterval(() => this.cleanup(), 1500),
    );
    return this;
  }

  send(msg: unknown): void {
    if (this.closed) return;
    this.queue.push(msg);
    void this.flush();
  }

  /**
   * Stop using this pipe but leave the room as it is: the match carries on without this phone (turn by
   * turn, or on its other phone), or the host frees the guest seat to wait for someone else.
   */
  detach(): void {
    if (this.closed) return;
    this.stop();
  }

  /** Start a new epoch: numbering from 1 again, and whatever wasn't sent yet dropped. */
  restart(): void {
    this.epoch = Math.max(Date.now(), this.epoch + 1);
    this.seqOut = 0;
    this.queue.length = 0;
    this.retry.length = 0;
    netLog('relay: starting afresh for the rejoined phone');
  }

  close(): void {
    if (this.closed) return;
    this.stop();
    // The host closes the room, a moment later so a last goodbye can still get through.
    if (this.side === 'host') setTimeout(() => void this.room.db.patch(this.room.path, ROOM_CLEARED).catch(() => {}), 1500);
  }

  private stop(): void {
    this.closed = true;
    this.stream?.close();
    this.timers.forEach(clearInterval);
  }

  private handleClose(): void {
    if (this.closed) return;
    this.close();
    this.onClose();
  }

  /**
   * One request at a time, so batches arrive in order; whatever queued meanwhile goes in the next.
   * After closing, it still sends what was queued before (a goodbye), one try each.
   */
  private async flush(): Promise<void> {
    if (this.sending) return;
    if (this.closed && !this.queue.length && !this.retry.length) return;
    let batch = this.retry.shift();
    if (!batch) {
      if (!this.queue.length) return;
      const msgs = this.queue.splice(0);
      const seq = ++this.seqOut;
      batch = { seq, payload: toB64(await seal(this.room.sealer, { e: this.epoch, seq, m: msgs, from: this.opts.me })) };
    }
    this.sending = true;
    try {
      await this.room.db.post(this.outbox, batch.payload);
      this.lastSent = Date.now();
    } catch (e) {
      if (this.closed) return netLog(`relay: a last message didn't go (${errText(e)})`);
      netLog(`relay: send failed (${errText(e)}), retrying`);
      this.retry.unshift(batch);
      await new Promise((r) => setTimeout(r, 1000));
    } finally {
      this.sending = false;
    }
    void this.flush();
  }

  private onEvent(e: RtdbEvent): void {
    if (e.path === '/') {
      for (const [k, v] of Object.entries((e.data as Record<string, unknown>) ?? {})) this.receive(k, v);
    } else if (e.data !== null) {
      const key = e.path.slice(1);
      if (!key.includes('/')) this.receive(key, e.data);
    }
  }

  private receive(key: string, value: unknown): void {
    if (this.seen.has(key) || typeof value !== 'string') return;
    this.seen.add(key);
    this.toDelete.push(key);
    void unseal(this.room.sealer, fromB64(value)).then((b) => {
      const batch = b as { e?: number; seq: number; m: unknown[]; from?: string } | null;
      if (!batch) return netLog('relay: a message that did not unseal');
      // From someone who's since lost the seat (a ghost the host freed it from): not for us. (An older
      // version doesn't say who it is; the session's version check deals with that.)
      if (this.opts.peer && batch.from !== undefined && batch.from !== this.opts.peer) return;
      const e = batch.e ?? 0;
      if (e < this.peerEpoch || this.closed) return; // left over from a connection they've since replaced
      this.lastHeard = Date.now();
      if (this.quiet) {
        this.quiet = false;
        netLog('relay: the other phone is back');
        this.onQuiet(false);
      }
      if (e > this.peerEpoch) {
        // A newer connection of theirs: switch to it once its first batch is in.
        const next = this.future.get(e) ?? new Map<number, unknown[]>();
        this.future.set(e, next.set(batch.seq, batch.m));
        if (!next.has(1)) return;
        if (this.peerEpoch) netLog('relay: the other phone reconnected');
        this.peerEpoch = e;
        this.expected = 1;
        this.pending = next;
        for (const old of this.future.keys()) if (old <= e) this.future.delete(old);
      } else {
        if (batch.seq < this.expected) return; // a retry that got through twice
        this.pending.set(batch.seq, batch.m);
      }
      while (this.pending.has(this.expected)) {
        const msgs = this.pending.get(this.expected)!;
        this.pending.delete(this.expected++);
        for (const m of msgs) {
          if (this.closed) return;
          if ((m as { k?: string }).k !== '~ping') this.onMessage(m);
        }
      }
    });
  }

  /** Delete what we've read, a batch at a time, to keep the database small. */
  private cleanup(): void {
    if (!this.toDelete.length || this.closed) return;
    const keys = this.toDelete;
    this.toDelete = [];
    void this.room.db.patch(this.inbox, Object.fromEntries(keys.map((k) => [k, null]))).catch(() => {});
  }
}

/** Everything in a room, removed. */
export const ROOM_CLEARED = { host: null, guest: null, h2g: null, g2h: null, view: null, game: null };

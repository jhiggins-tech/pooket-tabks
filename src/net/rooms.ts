import { netLog } from './log';
import { Rtdb, SERVER_TIME, type RtdbEvent } from './rtdb';
import { seal, sealerFor, unseal, type Sealer } from './seal';
import type { ViewMsg } from './session';
import type { Transport } from './transport';

/**
 * Online play through Firebase (Realtime Database, REST): a room is `rooms/<hash of the code>` with a
 * host seat, a guest seat, and two message queues (h2g, g2h). Everything in it is sealed with a key from
 * the room code, so the database only holds ciphertext under a path nobody can guess. Messages travel
 * phone → Firebase → phone, so it works on any network, including mobile data.
 */

/** Room codes: 4 letters (letters only, so a typed 0 or 1 can only mean O or I). */
export const ROOM_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** A host that hasn't checked in for this long has gone. */
const HOST_STALE_MS = 3 * 60_000;
const HOST_REFRESH_MS = 60_000;
const ADVERT_EVERY_MS = 30_000;
const ADVERT_STALE_MS = 90_000;

export function randomId(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function newRoomCode(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(4));
  return [...b].map((x) => ROOM_ALPHABET[x % ROOM_ALPHABET.length]).join('');
}

/** Tidy up a typed room code ("fr0g " → "FROG"); null if it can't be one. */
export function normaliseRoomCode(text: string): string | null {
  const c = text.toUpperCase().replace(/0/g, 'O').replace(/1/g, 'I').replace(/[^A-Z]/g, '');
  return c.length === 4 ? c : null;
}

export function toB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

/**
 * A message pipe through a room: each side posts sealed, numbered batches to its outbox and streams
 * the other's, delivering in order and deleting what it has read. Pings every few seconds; silence for
 * too long means the other phone has gone.
 */
export class RelayTransport implements Transport {
  onMessage: (msg: unknown) => void = () => {};
  onClose: () => void = () => {};
  private readonly outbox: string;
  private readonly inbox: string;
  private readonly queue: unknown[] = [];
  private readonly retry: { seq: number; payload: string }[] = [];
  private seqOut = 0;
  private expected = 1;
  private readonly pending = new Map<number, unknown[]>();
  private readonly seen = new Set<string>();
  private toDelete: string[] = [];
  private sending = false;
  private lastHeard = Date.now();
  private lastSent = 0;
  private closed = false;
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private stream: { close: () => void } | null = null;

  constructor(
    readonly db: Rtdb,
    readonly roomPath: string,
    private readonly side: 'host' | 'guest',
    readonly sealer: Sealer,
    private readonly opts: { pingMs?: number; lostMs?: number } = {},
  ) {
    this.outbox = `${roomPath}/${side === 'host' ? 'h2g' : 'g2h'}`;
    this.inbox = `${roomPath}/${side === 'host' ? 'g2h' : 'h2g'}`;
  }

  start(): this {
    this.stream = this.db.stream(this.inbox, (e) => this.onEvent(e));
    const ping = this.opts.pingMs ?? 4000;
    const lost = this.opts.lostMs ?? 20_000;
    this.timers.push(
      setInterval(() => {
        const now = Date.now();
        if (now - this.lastSent >= ping) this.send({ k: '~ping' });
        if (now - this.lastHeard > lost) {
          netLog(`relay: nothing from the other phone for ${Math.round((now - this.lastHeard) / 1000)}s`);
          this.handleClose();
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

  close(): void {
    if (this.closed) return;
    this.stop();
    if (this.side === 'host') void this.db.patch(this.roomPath, ROOM_CLEARED).catch(() => {});
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

  /** One request at a time, so batches arrive in order; whatever queued meanwhile goes in the next. */
  private async flush(): Promise<void> {
    if (this.sending || this.closed) return;
    let batch = this.retry.shift();
    if (!batch) {
      if (!this.queue.length) return;
      const msgs = this.queue.splice(0);
      batch = { seq: ++this.seqOut, payload: toB64(await seal(this.sealer, { seq: this.seqOut, m: msgs })) };
    }
    this.sending = true;
    try {
      await this.db.post(this.outbox, batch.payload);
      this.lastSent = Date.now();
    } catch (e) {
      netLog(`relay: send failed (${e instanceof Error ? e.message : e}), retrying`);
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
    void unseal(this.sealer, fromB64(value)).then((b) => {
      const batch = b as { seq: number; m: unknown[] } | null;
      if (!batch) return netLog('relay: a message that did not unseal');
      this.lastHeard = Date.now();
      if (batch.seq < this.expected) return; // a retry that got through twice
      this.pending.set(batch.seq, batch.m);
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
    void this.db.patch(this.inbox, Object.fromEntries(keys.map((k) => [k, null]))).catch(() => {});
  }
}

/** Everything in a room, removed. */
const ROOM_CLEARED = { host: null, guest: null, h2g: null, g2h: null, view: null };

/**
 * A player's spectator feed, written to the room (`view/state`: the latest full state; `view/aim`: the
 * live aim, at most a few times a second). One write at a time per slot, always the newest.
 */
export class ViewPublisher {
  private readonly latest: { state?: ViewMsg; aim?: ViewMsg } = {};
  private readonly busy = { state: false, aim: false };
  private lastAim = 0;
  private aimTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly relay: RelayTransport) {}

  push(v: ViewMsg): void {
    const slot = v.k === 'state' ? 'state' : 'aim';
    this.latest[slot] = v;
    if (slot === 'aim') {
      const wait = 250 - (Date.now() - this.lastAim);
      if (wait > 0) {
        this.aimTimer ??= setTimeout(() => {
          this.aimTimer = null;
          void this.write('aim');
        }, wait);
        return;
      }
    }
    void this.write(slot);
  }

  private async write(slot: 'state' | 'aim'): Promise<void> {
    const v = this.latest[slot];
    if (!v || this.busy[slot]) return;
    this.busy[slot] = true;
    delete this.latest[slot];
    if (slot === 'aim') this.lastAim = Date.now();
    try {
      await this.relay.db.put(`${this.relay.roomPath}/view/${slot}`, toB64(await seal(this.relay.sealer, v)));
    } catch (e) {
      netLog(`view: couldn't publish ${slot} (${e instanceof Error ? e.message : e})`);
    } finally {
      this.busy[slot] = false;
    }
    if (this.latest[slot]) void this.write(slot);
  }
}

/** Watch a room's spectator feed. Resolves once watching; `onEnd` when the room closes. */
export async function watchRoom(db: Rtdb, code: string, onView: (v: ViewMsg) => void, onEnd: () => void): Promise<{ stop: () => void }> {
  const sealer = await sealerFor('room', code);
  const path = `rooms/${sealer.topic}`;
  const host = await db.get<{ id: string; ts: number }>(`${path}/host`);
  if (!host) throw new Error(`No game with code ${code}.`);
  netLog(`watch: watching ${code}`);
  let seen = false;
  let ended = false;
  const take = (v: unknown) => {
    if (typeof v !== 'string') return;
    void unseal(sealer, fromB64(v)).then((m) => {
      if (m && !ended) onView(m as ViewMsg);
    });
  };
  const stream = db.stream(`${path}/view`, (e) => {
    if (e.path === '/') {
      const d = e.data as { state?: unknown; aim?: unknown } | null;
      if (!d) {
        if (seen && !ended) {
          ended = true;
          onEnd();
        }
        return;
      }
      seen = true;
      take(d.state);
      take(d.aim);
    } else if (e.path === '/state') {
      if (e.data === null) {
        if (!ended) {
          ended = true;
          onEnd();
        }
        return;
      }
      seen = true;
      take(e.data);
    } else if (e.path === '/aim') take(e.data);
  });
  return { stop: () => stream.close() };
}

/** A room this phone is hosting, waiting for someone to join. */
export class HostedRoom {
  private guestStream: { close: () => void } | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private stopped = false;

  private constructor(
    private readonly db: Rtdb,
    readonly code: string,
    private readonly path: string,
    private readonly sealer: Sealer,
    private readonly hostId: string,
  ) {}

  /** Claim a fresh room code (trying another if it's taken). */
  static async open(db: Rtdb): Promise<HostedRoom> {
    const hostId = randomId();
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = newRoomCode();
      const sealer = await sealerFor('room', code);
      const path = `rooms/${sealer.topic}`;
      try {
        await db.put(`${path}/host`, { id: hostId, ts: SERVER_TIME });
        // A clean slate (leftovers from an old game with the same code).
        await db.patch(path, { guest: null, h2g: null, g2h: null, view: null });
        netLog(`rooms: hosting ${code}`);
        const room = new HostedRoom(db, code, path, sealer, hostId);
        room.timers.push(setInterval(() => void db.put(`${path}/host`, { id: hostId, ts: SERVER_TIME }).catch(() => {}), HOST_REFRESH_MS));
        return room;
      } catch (e) {
        netLog(`rooms: code ${code} is taken (${e instanceof Error ? e.message : e})`);
      }
    }
    throw new Error("Couldn't open a room. Try again in a moment.");
  }

  /** Resolves with a message pipe once someone takes the guest seat. */
  waitForGuest(opts?: ConstructorParameters<typeof RelayTransport>[4]): Promise<RelayTransport> {
    return new Promise((resolve) => {
      this.guestStream = this.db.stream(`${this.path}/guest`, (e) => {
        const guest = e.path === '/' ? (e.data as { id?: string } | null) : null;
        if (this.stopped || !guest?.id) return;
        netLog(`rooms: ${guest.id.slice(0, 4)} joined`);
        this.guestStream?.close();
        this.timers.forEach(clearInterval);
        resolve(new RelayTransport(this.db, this.path, 'host', this.sealer, opts).start());
      });
    });
  }

  /** Stop waiting and close the room (not once a game has started: the transport owns it then). */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.guestStream?.close();
    this.timers.forEach(clearInterval);
  }

  /** Stop and remove the room entirely (nobody joined). */
  cancel(): void {
    this.stop();
    void this.db.patch(this.path, ROOM_CLEARED).catch(() => {});
  }

  get id(): string {
    return this.hostId;
  }
}

/** Join a room by code: take the guest seat and get a message pipe. */
export async function joinRoom(db: Rtdb, code: string, opts?: ConstructorParameters<typeof RelayTransport>[4]): Promise<RelayTransport> {
  const sealer = await sealerFor('room', code);
  const path = `rooms/${sealer.topic}`;
  const host = await db.get<{ id: string; ts: number }>(`${path}/host`);
  if (!host || Date.now() - host.ts > HOST_STALE_MS) {
    netLog(`rooms: no live host for ${code}${host ? ' (stale)' : ''}`);
    throw new Error(`No game with code ${code}. Check it, and that the host is still on the Host screen.`);
  }
  try {
    await db.put(`${path}/guest`, { id: randomId(), ts: SERVER_TIME });
  } catch (e) {
    if ((e as { denied?: boolean }).denied) throw new Error('That game already has two players.');
    throw e;
  }
  netLog(`rooms: joined ${code}`);
  return new RelayTransport(db, path, 'guest', sealer, opts).start();
}

/** A game on the nearby (same Wi-Fi) list. */
export interface Advert {
  hostId: string;
  name: string;
  characterId: string;
  room: string;
  ts: number;
  /** A match is under way: others can watch. */
  playing?: boolean;
}

export function lobbySealer(lanId: string): Promise<Sealer> {
  return sealerFor('wifi', lanId);
}

/** Host: keep a game on the nearby list (refreshed) until stopped. */
export function advertise(db: Rtdb, lan: Sealer, ad: Omit<Advert, 'ts'>): { stop: () => void; update: (changes: Partial<Advert>) => void } {
  const path = `lobby/${lan.topic}/${ad.hostId}`;
  let stopped = false;
  const put = async () => {
    if (stopped) return;
    try {
      await db.put(path, { m: toB64(await seal(lan, { ...ad, ts: Date.now() })), ts: SERVER_TIME });
    } catch (e) {
      netLog(`rooms: advert failed (${e instanceof Error ? e.message : e})`);
    }
  };
  void put();
  const timer = setInterval(() => void put(), ADVERT_EVERY_MS);
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
      void db.remove(path).catch(() => {});
    },
    update: (changes) => {
      Object.assign(ad, changes);
      void put();
    },
  };
}

/** Joiner: watch the nearby list. */
export function watchLobby(db: Rtdb, lan: Sealer, onList: (games: Advert[]) => void): { stop: () => void } {
  const games = new Map<string, Advert>();
  const emit = () => onList([...games.values()].filter((g) => Date.now() - g.ts < ADVERT_STALE_MS).sort((a, b) => b.ts - a.ts));
  const take = (hostId: string, v: unknown) => {
    const m = (v as { m?: unknown } | null)?.m;
    if (typeof m !== 'string') {
      games.delete(hostId);
      emit();
      return;
    }
    void unseal(lan, fromB64(m)).then((a) => {
      const ad = a as Advert | null;
      if (!ad || ad.hostId !== hostId) return;
      games.set(hostId, ad);
      emit();
    });
  };
  const stream = db.stream(`lobby/${lan.topic}`, (e) => {
    if (e.path === '/') {
      games.clear();
      for (const [k, v] of Object.entries((e.data as Record<string, unknown>) ?? {})) take(k, v);
      emit();
    } else {
      const [hostId, child] = e.path.slice(1).split('/');
      if (!hostId) return;
      if (child) void db.get(`lobby/${lan.topic}/${hostId}`).then((v) => take(hostId, v));
      else take(hostId, e.data);
    }
  });
  const timer = setInterval(emit, 5000);
  emit();
  return {
    stop: () => {
      clearInterval(timer);
      stream.close();
    },
  };
}

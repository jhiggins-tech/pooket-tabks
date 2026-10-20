import { fromB64 } from './b64';
import type { Preview } from './follow';
import { errText, netLog } from './log';
import { readRecord, RecordStore, type GameRecord } from './record';
import type { RoomRef } from './rooms';
import { SERVER_TIME } from './rtdb';
import { unseal } from './seal';
import type { ViewMsg } from './session';
import { ViewPublisher } from './view';
import { decodeMsg, encodeMsg } from './wire';

/**
 * How a match on this phone reaches the other phone: through its record (record.ts), which both phones
 * follow, and the live aim. There's no message pipe between the phones: whoever's turn it is writes the
 * record and streams its aim, and whatever has the match open follows them.
 *
 * - `save`: write the record (the database keeps the newest; its rules refuse one that isn't newer);
 *   `onRecord`: each record as it's written (this phone's own included).
 * - `view`: out to spectators (the latest full state, and the live aim, which the other phone follows:
 *   `onAim`).
 * - `onPresence`: whether the other player has the match open right now (each phone checks in on its seat
 *   while it does: the green "live" dot).
 * - `onClose`: the room has gone. `close`: stop following (the room stays); `gone`, saying this phone has
 *   left the match (it's no longer here).
 */
export interface MatchChannel {
  start(): void;
  save(rec: GameRecord): void;
  view(v: ViewMsg): void;
  onRecord: (rec: GameRecord) => void;
  onAim: (p: Preview) => void;
  onPresence: (here: boolean) => void;
  onClose: () => void;
  close(gone: boolean): void;
}

/**
 * How often a phone with the match open checks in on its seat (`everyMs`), and how long a check-in says
 * it's here (`forMs`). (Tests shorten them: `?debug&here=MS` sets `forMs`, and the rest follow.)
 */
export const presence = { everyMs: 20_000, forMs: 60_000 };

/** Presence a lot quicker (for tests): here for `forMs`, checking in three times as often. */
export function quickPresence(forMs: number): void {
  Object.assign(presence, { forMs, everyMs: Math.round(forMs / 3) });
}

/** A seat as stored: whose (`id`), the last check-in (`ts`, server time), and `out` once its phone has left the match. */
export interface SeatEntry {
  id?: string;
  ts?: number;
  dev?: string;
  out?: boolean;
}

/**
 * Whether a seat's player has the match open: they checked in lately, and haven't left. (Either by the
 * server's time against this phone's clock, or, clocks being what they are, a check-in seen to arrive.)
 */
export function seatHere(seat: SeatEntry | null, now = Date.now(), lastSeen = 0): boolean {
  if (!seat || seat.out || typeof seat.ts !== 'number') return false;
  return Math.abs(now - seat.ts) < presence.forMs || now - lastSeen < presence.forMs;
}

/** A seat's check-in: still here (`out` cleared). */
export const checkInSeat = (room: RoomRef, role: 'host' | 'guest') => room.db.patch(`${room.path}/${role}`, { ts: SERVER_TIME, out: null });

/** A match through its room in the database. */
export class RoomChannel implements MatchChannel {
  onRecord: (rec: GameRecord) => void = () => {};
  onAim: (p: Preview) => void = () => {};
  onPresence: (here: boolean) => void = () => {};
  onClose: () => void = () => {};
  private readonly record: RecordStore;
  private readonly publisher: ViewPublisher;
  private readonly streams: { close: () => void }[] = [];
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  /** Records are opened (unsealed) one after another, so they come out in the order they went in. */
  private opening: Promise<void> = Promise.resolve();
  private hadRecord = false;
  private closed = false;
  /** The other seat as it stands, when a check-in of theirs was last seen to arrive, and whether they're here. */
  private theirs: SeatEntry | null = null;
  private theirsSeen = 0;
  private here: boolean | null = null;

  constructor(
    /** The room it goes through. */
    readonly room: RoomRef,
    readonly role: 'host' | 'guest',
  ) {
    this.record = new RecordStore(room);
    this.publisher = new ViewPublisher(room);
  }

  start(): void {
    const { db, path } = this.room;
    // One stream for the whole room (the record, the live aim, the seats): phones keep few connections
    // open at once, and it's all small but the record.
    this.streams.push(
      db.stream(path, (e) => {
        if (e.path === '/') {
          const room = (e.data && typeof e.data === 'object' ? e.data : {}) as Record<string, unknown>;
          if (e.kind === 'put') {
            this.take(room.game ?? null);
            this.seat('/', room[this.other] ?? null, 'put');
            this.aim((room.view as { aim?: unknown } | undefined)?.aim);
          } else for (const [key, v] of Object.entries(room)) this.child(`/${key}`, v, 'put');
          return;
        }
        this.child(e.path, e.data, e.kind);
      }),
    );
    const checkIn = () => void checkInSeat(this.room, this.role).catch((e: unknown) => netLog(`match: couldn't check in (${errText(e)})`));
    checkIn();
    this.timers.push(setInterval(checkIn, presence.everyMs), setInterval(() => this.checkPresence(), Math.min(5000, presence.everyMs)));
  }

  save(rec: GameRecord): void {
    if (!this.closed) this.record.save(rec);
  }

  view(v: ViewMsg): void {
    if (!this.closed) this.publisher.push(v);
  }

  close(gone: boolean): void {
    if (this.closed) return;
    this.closed = true;
    this.streams.forEach((s) => s.close());
    this.timers.forEach(clearInterval);
    if (gone) void this.room.db.patch(`${this.room.path}/${this.role}`, { out: true }).catch(() => {});
  }

  /** The other player's seat. */
  private get other(): 'host' | 'guest' {
    return this.role === 'host' ? 'guest' : 'host';
  }

  /** Something in the room changed (`path` within it). */
  private child(path: string, data: unknown, kind: 'put' | 'patch'): void {
    const [top, ...rest] = path.slice(1).split('/');
    const sub = rest.length ? `/${rest.join('/')}` : '/';
    if (top === 'game') {
      if (sub === '/' && kind === 'put') this.take(data);
      else void this.room.db.get(`${this.room.path}/game`).then((d) => this.take(d), () => {}); // (part of it changed: read it all)
    } else if (top === this.other) this.seat(sub, data, kind);
    else if (top === 'view') {
      if (sub === '/aim' && kind === 'put') this.aim(data);
      else if (sub === '/' && kind === 'put') this.aim((data as { aim?: unknown } | null)?.aim);
    }
  }

  /** The other player's aim, as it streams in. */
  private aim(data: unknown): void {
    if (typeof data !== 'string') return;
    void unseal(this.room.sealer, fromB64(data)).then((v) => {
      const p = v as Preview | null;
      if (p?.k === 'preview' && !this.closed) this.onAim(p);
    });
  }

  /** The other player's seat changed (`path` within it): are they here? */
  private seat(path: string, value: unknown, kind: 'put' | 'patch'): void {
    const data = (value && typeof value === 'object' ? value : null) as SeatEntry | null;
    const before = this.theirs?.ts;
    if (path === '/') this.theirs = kind === 'patch' ? { ...this.theirs, ...data } : data;
    else {
      const key = path.slice(1);
      if (!key.includes('/')) this.theirs = { ...this.theirs, [key]: value };
    }
    if (this.theirs?.ts !== before && before !== undefined) this.theirsSeen = Date.now();
    this.checkPresence();
  }

  private take(raw: unknown): void {
    this.opening = this.opening.then(async () => {
      if (this.closed) return;
      if (raw === null) {
        if (!this.hadRecord) return;
        netLog('match: the room has gone');
        return this.onClose();
      }
      const r = await readRecord(this.room.sealer, raw);
      if (!r || !('game' in r) || this.closed) return;
      this.hadRecord = true;
      this.onRecord(r.game.rec);
    });
  }

  private checkPresence(): void {
    if (this.closed) return;
    const here = seatHere(this.theirs, Date.now(), this.theirsSeen);
    if (here === this.here) return;
    this.here = here;
    netLog(`match: the other player is ${here ? 'here' : 'away'}`);
    this.onPresence(here);
  }
}

/**
 * A room in memory, for tests: its record (kept like the database keeps it: the newest, and a write that
 * isn't newer refused), the live aim, and who's here. Each phone's channel gets every record (its own
 * too) and the other's aim, asynchronously like a real network; `onView` gets the spectator feed.
 */
export function memoryRoom(opts: { onView?: (v: ViewMsg) => void } = {}): {
  channel(role: 'host' | 'guest'): MatchChannel;
  readonly rec: GameRecord | null;
  readonly saves: number;
  /** A record put there directly (as if written by a phone that's gone). */
  put(rec: GameRecord): void;
} {
  let rec: GameRecord | null = null;
  let saves = 0;
  const open = new Set<MemoryChannel>();
  const here = { host: false, guest: false };
  const copy = <T>(v: T): T => decodeMsg(encodeMsg(v)) as T; // exactly what goes over the wire
  const presence = () => {
    for (const c of open) {
      const theirs = here[c.role === 'host' ? 'guest' : 'host'];
      queueMicrotask(() => c.live && c.onPresence(theirs));
    }
  };
  const store = (r: GameRecord): boolean => {
    if (rec && r.n <= rec.n) return false;
    rec = copy(r);
    saves++;
    for (const c of open) {
      const mine = copy(r);
      queueMicrotask(() => c.live && c.onRecord(mine));
    }
    return true;
  };
  class MemoryChannel implements MatchChannel {
    onRecord: (rec: GameRecord) => void = () => {};
    onAim: (p: Preview) => void = () => {};
    onPresence: (here: boolean) => void = () => {};
    onClose: () => void = () => {};
    live = false;
    constructor(readonly role: 'host' | 'guest') {}
    start(): void {
      this.live = true;
      open.add(this);
      here[this.role] = true;
      presence();
      const now = rec && copy(rec);
      if (now) queueMicrotask(() => this.live && this.onRecord(now));
    }
    save(r: GameRecord): void {
      if (this.live) store(r);
    }
    view(v: ViewMsg): void {
      if (!this.live) return;
      opts.onView?.(copy(v));
      if (v.k !== 'preview') return;
      for (const c of open) if (c !== this) queueMicrotask(() => c.live && c.onAim(copy(v)));
    }
    close(gone: boolean): void {
      if (!this.live) return;
      this.live = false;
      open.delete(this);
      if (gone) here[this.role] = false;
      presence();
    }
  }
  return {
    channel: (role) => new MemoryChannel(role),
    get rec() {
      return rec;
    },
    get saves() {
      return saves;
    },
    put: (r) => void store(r),
  };
}

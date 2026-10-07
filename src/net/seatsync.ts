import type { Auth } from './auth';
import { errText, netLog } from './log';
import type { Rtdb } from './rtdb';
import { findSeat, loadForgotten, loadSeats, SEAT_EXPIRY_MS, takeSeats, type Seat } from './seat';

/**
 * A signed-in player's match seats follow them (net/seat.ts): `users/<uid>/games/<room code>` holds each
 * seat ({ role, id, listed, ts, at }) or a note that it was forgotten ({ gone: true, at, ts }), so a match
 * started on one phone carries on from another, and a finished one doesn't come back. The newer change
 * wins (`at`); what's only about one phone (`left`, `seen`) stays on it. Only that account can read or
 * write it (the rules), which matters: a seat is a room code (the key to the room) and the seat's id.
 *
 * `sync` (on signing in, on every load and before the Game browser lists your matches) brings the two
 * together; `changed` (a seat saved or forgotten here) sends that one. Best effort, like Account.
 *
 * Two phones in the same seat at once: the one that rejoins last plays, the other stands aside (rooms.ts,
 * `watchSeat`).
 */

interface Entry {
  role?: 'host' | 'guest';
  id?: string;
  listed?: boolean;
  ts?: number;
  at?: number;
  gone?: boolean;
}

/** Where this phone keeps its seats (tests pass their own; by default localStorage). */
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class SeatSync {
  private queue: Promise<void> = Promise.resolve();
  private readonly store: Store | undefined;
  private readonly now: () => number;

  constructor(
    private readonly auth: Auth,
    private readonly db: Rtdb,
    /** Seats came down from the account (refresh whatever lists them). */
    private readonly onApplied: () => void = () => {},
    opts: { store?: Store; now?: () => number } = {},
  ) {
    this.store = opts.store;
    this.now = opts.now ?? Date.now;
  }

  sync(): Promise<void> {
    return this.run(async () => {
      const uid = this.auth.uid;
      if (!uid) return;
      const path = `users/${uid}/games`;
      const now = this.now();
      const remote = (await this.db.get<Record<string, Entry>>(path)) ?? {};
      const theirs: { seats: Seat[]; forgotten: Record<string, number> } = { seats: [], forgotten: {} };
      for (const [code, e] of Object.entries(remote)) {
        const at = e.at ?? e.ts ?? 0;
        if (!/^[A-Z]{4}$/.test(code) || now - (e.gone ? at : (e.ts ?? 0)) > SEAT_EXPIRY_MS) {
          await this.db.remove(`${path}/${code}`); // long over: tidy it away
          delete remote[code];
        } else if (e.gone) {
          theirs.forgotten[code] = at;
        } else if ((e.role === 'host' || e.role === 'guest') && typeof e.id === 'string' && typeof e.ts === 'number') {
          theirs.seats.push({ code, role: e.role, id: e.id, listed: e.listed, ts: e.ts, at });
        }
      }
      const before = JSON.stringify(loadSeats(this.store, now));
      takeSeats(theirs, this.store, now);
      // Whatever the account hasn't got (or has an older version of) goes up.
      for (const seat of loadSeats(this.store, now)) {
        const e = remote[seat.code];
        if (!e || (e.at ?? e.ts ?? 0) < (seat.at ?? seat.ts)) await this.put(uid, seat.code);
      }
      for (const [code, when] of Object.entries(loadForgotten(this.store, now))) {
        const e = remote[code];
        if (e && !e.gone && (e.at ?? e.ts ?? 0) < when) await this.put(uid, code);
      }
      if (JSON.stringify(loadSeats(this.store, now)) !== before) {
        netLog('seats: matches came down from the account');
        this.onApplied();
      }
    });
  }

  /** A seat was saved, changed or forgotten here: send it (signed in only; otherwise the next sync does). */
  changed(code: string): void {
    const uid = this.auth.uid;
    if (uid) void this.run(() => this.put(uid, code));
  }

  /** Send one seat as it stands here: the seat, or that it was forgotten. */
  private async put(uid: string, code: string): Promise<void> {
    const seat = findSeat(code, this.store, this.now());
    const gone = loadForgotten(this.store, this.now())[code];
    const entry: Entry | null = seat
      ? { role: seat.role, id: seat.id, ts: seat.ts, at: seat.at ?? seat.ts, ...(seat.listed !== undefined ? { listed: seat.listed } : {}) }
      : gone !== undefined
        ? { gone: true, at: gone, ts: gone }
        : null;
    if (entry) await this.db.put(`users/${uid}/games/${code}`, entry);
  }

  private run(job: () => Promise<unknown>): Promise<void> {
    const next = this.queue.then(job).then(
      () => {},
      (e: unknown) => netLog(`seats: ${errText(e)}`),
    );
    this.queue = next;
    return next;
  }
}

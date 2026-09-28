/**
 * This phone's seat in an online match (room code, host or guest, and the id the seat was claimed
 * with), remembered so it can rejoin after dropping out: a reload, the app being killed, a lost signal.
 */

export interface Seat {
  code: string;
  role: 'host' | 'guest';
  id: string;
  /** The host had the game on the public Games list (so it goes back on after a rejoin). */
  listed?: boolean;
  /** When the match was last active on this phone (ms). */
  ts: number;
}

export const SEAT_KEY = 'pooket.seat';
/** Rejoin straight away after a reload if the match was going this recently. */
export const AUTO_REJOIN_MS = 10 * 60_000;
/** Offer a Rejoin button for this long. */
export const SEAT_EXPIRY_MS = 2 * 60 * 60_000;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function store(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function saveSeat(seat: Omit<Seat, 'ts'>, s: Store | null = store(), now = Date.now()): void {
  try {
    s?.setItem(SEAT_KEY, JSON.stringify({ ...seat, ts: now }));
  } catch {
    /* storage unavailable: no rejoining, that's all */
  }
}

/** The remembered seat, if there is one and it isn't too old. */
export function loadSeat(s: Store | null = store(), now = Date.now()): Seat | null {
  try {
    const v = JSON.parse(s?.getItem(SEAT_KEY) ?? 'null') as Partial<Seat> | null;
    if (!v || typeof v.code !== 'string' || typeof v.id !== 'string' || typeof v.ts !== 'number') return null;
    if (v.role !== 'host' && v.role !== 'guest') return null;
    if (now - v.ts > SEAT_EXPIRY_MS) return null;
    return v as Seat;
  } catch {
    return null;
  }
}

/** Still playing: keep the seat fresh. */
export function touchSeat(s: Store | null = store(), now = Date.now()): void {
  const seat = loadSeat(s, now);
  if (seat) saveSeat(seat, s, now);
}

export function clearSeat(s: Store | null = store()): void {
  try {
    s?.removeItem(SEAT_KEY);
  } catch {
    /* nothing to clear */
  }
}

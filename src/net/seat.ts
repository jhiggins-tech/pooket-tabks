/**
 * This phone's seats in online matches (room code, host or guest, and the id each seat was claimed with),
 * remembered so it can go back to them: after a reload, the app being killed or a lost signal, and for
 * matches played turn by turn (the My games list). Newest first.
 */

export interface Seat {
  code: string;
  role: 'host' | 'guest';
  id: string;
  /** The host had the game on the public Games list (so it goes back on after a rejoin). */
  listed?: boolean;
  /** When the match was last active on this phone (ms). */
  ts: number;
  /** Left for now on purpose (back to the menu): no rejoining straight away on a reload. */
  left?: boolean;
  /** The last turn this phone has seen played out (so their newer shot gets replayed). */
  seen?: number;
}

export const GAMES_KEY = 'pooket.games';
/** Where an older version kept its one seat (taken over into the list). */
const LEGACY_SEAT_KEY = 'pooket.seat';
/** Rejoin straight away after a reload if the match was going this recently (and not left on purpose). */
export const AUTO_REJOIN_MS = 10 * 60_000;
/** Forget a match this long after it was last played here (it's been forfeited by then: record.ts). */
export const SEAT_EXPIRY_MS = 5 * 24 * 60 * 60_000;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function store(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function valid(v: Partial<Seat> | null): v is Seat {
  return !!v && typeof v.code === 'string' && typeof v.id === 'string' && typeof v.ts === 'number' && (v.role === 'host' || v.role === 'guest');
}

/** This phone's matches, newest first (expired ones dropped). */
export function loadSeats(s: Store | null = store(), now = Date.now()): Seat[] {
  try {
    const list = JSON.parse(s?.getItem(GAMES_KEY) ?? '[]') as Partial<Seat>[];
    const legacy = JSON.parse(s?.getItem(LEGACY_SEAT_KEY) ?? 'null') as Partial<Seat> | null;
    const all = [...(Array.isArray(list) ? list : []), ...(legacy && !list.some((x) => x?.code === legacy.code) ? [legacy] : [])];
    return all.filter(valid).filter((v) => now - v.ts <= SEAT_EXPIRY_MS).sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
}

function write(seats: Seat[], s: Store | null): void {
  try {
    s?.setItem(GAMES_KEY, JSON.stringify(seats));
    s?.removeItem(LEGACY_SEAT_KEY);
  } catch {
    /* storage unavailable: no going back to matches, that's all */
  }
}

/** The seat in this room, if we have one. */
export function findSeat(code: string, s: Store | null = store(), now = Date.now()): Seat | null {
  return loadSeats(s, now).find((x) => x.code === code) ?? null;
}

/** The match this phone played most recently. */
export function latestSeat(s: Store | null = store(), now = Date.now()): Seat | null {
  return loadSeats(s, now)[0] ?? null;
}

/** Remember a seat (or refresh it): playing it now. */
export function saveSeat(seat: Omit<Seat, 'ts'>, s: Store | null = store(), now = Date.now()): void {
  const seats = loadSeats(s, now);
  const old = seats.find((x) => x.code === seat.code);
  write([{ ...old, ...seat, left: false, ts: now }, ...seats.filter((x) => x !== old)], s);
}

/** Change a remembered seat (without it counting as played). */
export function updateSeat(code: string, changes: Partial<Omit<Seat, 'code'>>, s: Store | null = store(), now = Date.now()): void {
  const seats = loadSeats(s, now);
  if (!seats.some((x) => x.code === code)) return;
  write(seats.map((x) => (x.code === code ? { ...x, ...changes } : x)), s);
}

/** Still playing: keep the seat fresh. */
export function touchSeat(code: string, s: Store | null = store(), now = Date.now()): void {
  updateSeat(code, { ts: now }, s, now);
}

export function forgetSeat(code: string, s: Store | null = store(), now = Date.now()): void {
  write(loadSeats(s, now).filter((x) => x.code !== code), s);
}

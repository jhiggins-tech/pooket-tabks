import { Emitter } from '../core/emitter';

/**
 * This phone's seats in online matches (room code, host or guest, and the id each seat was claimed with),
 * remembered so it can go back to them: after a reload, the app being killed or a lost signal, and for
 * matches played turn by turn (listed first in the Game browser). Newest first.
 *
 * A signed-in player's seats also follow them to their other phones (net/seatsync.ts): each seat says when
 * it last changed (`at`), a forgotten one leaves a note (`forgotten`) so it doesn't come back from the
 * account, and `seatChanges` says when either happens. `left` and `seen` are about this phone only.
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
  /** When what follows the player about it (role, id, listed) last changed (ms; older seats: `ts`). */
  at?: number;
}

/** A seat's number in a match (the host is seat 0, the guest seat 1). */
export const seatOf = (role: 'host' | 'guest'): 0 | 1 => (role === 'host' ? 0 : 1);

/** The other player's seat. */
export const otherSeat = (seat: number): 0 | 1 => (seat === 0 ? 1 : 0);

/** Something listed by seat ([host, guest], like a match's players) as [this seat's, the other's]. */
export function bySeat<T>(list: readonly T[], seat: number): T[] {
  return seat === 0 ? [...list] : [...list].reverse();
}

/** `changed`: a seat was saved, changed or forgotten here (its code), so a signed-in player's account hears. */
export const seatChanges = new Emitter<{ changed: [code: string] }>();

export const GAMES_KEY = 'pooket.games';
/** Seats forgotten here lately: code → when (ms), kept as long as a seat would be. */
export const FORGOTTEN_KEY = 'pooket.games.forgotten';
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
  write([{ ...old, ...seat, left: false, ts: now, at: now }, ...seats.filter((x) => x !== old)], s);
  unforget(seat.code, s, now);
  seatChanges.emit('changed', seat.code);
}

/** Change a remembered seat (without it counting as played). */
export function updateSeat(code: string, changes: Partial<Omit<Seat, 'code'>>, s: Store | null = store(), now = Date.now()): void {
  const seats = loadSeats(s, now);
  const old = seats.find((x) => x.code === code);
  if (!old) return;
  // Only what follows the player counts as a change for the account (not `ts`, `left` or `seen`).
  const shared = (['role', 'id', 'listed'] as const).some((k) => k in changes && changes[k] !== old[k]);
  write(seats.map((x) => (x === old ? { ...x, ...changes, ...(shared ? { at: now } : {}) } : x)), s);
  if (shared) seatChanges.emit('changed', code);
}

/** Still playing: keep the seat fresh. */
export function touchSeat(code: string, s: Store | null = store(), now = Date.now()): void {
  updateSeat(code, { ts: now }, s, now);
}

export function forgetSeat(code: string, s: Store | null = store(), now = Date.now()): void {
  write(loadSeats(s, now).filter((x) => x.code !== code), s);
  writeForgotten({ ...loadForgotten(s, now), [code]: now }, s);
  seatChanges.emit('changed', code);
}

/** Seats forgotten here lately (code → when), so a signed-in player's other phones forget them too. */
export function loadForgotten(s: Store | null = store(), now = Date.now()): Record<string, number> {
  try {
    const v = JSON.parse(s?.getItem(FORGOTTEN_KEY) ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).filter((e): e is [string, number] => typeof e[1] === 'number' && now - e[1] <= SEAT_EXPIRY_MS));
  } catch {
    return {};
  }
}

function writeForgotten(map: Record<string, number>, s: Store | null): void {
  try {
    s?.setItem(FORGOTTEN_KEY, JSON.stringify(map));
  } catch {
    /* the account may bring it back: harmless, the Game browser tidies it again */
  }
}

function unforget(code: string, s: Store | null, now: number): void {
  const map = loadForgotten(s, now);
  if (!(code in map)) return;
  delete map[code];
  writeForgotten(map, s);
}

/**
 * What the account says (net/seatsync.ts), taken in quietly (no `seatChanges`): seats played on another
 * phone (newer than ours, or new here) and seats forgotten there (more lately than ours changed). This
 * phone's own `left` and `seen` stay as they are.
 */
export function takeSeats(theirs: { seats: Seat[]; forgotten: Record<string, number> }, s: Store | null = store(), now = Date.now()): void {
  let seats = loadSeats(s, now);
  const forgotten = loadForgotten(s, now);
  for (const t of theirs.seats) {
    if ((forgotten[t.code] ?? -1) >= (t.at ?? t.ts)) continue;
    const mine = seats.find((x) => x.code === t.code);
    if (mine && (mine.at ?? mine.ts) >= (t.at ?? t.ts)) continue;
    const merged: Seat = { code: t.code, role: t.role, id: t.id, listed: t.listed, ts: Math.max(t.ts, mine?.ts ?? 0), at: t.at ?? t.ts, left: mine?.left, seen: mine?.seen };
    seats = [merged, ...seats.filter((x) => x !== mine)];
    delete forgotten[t.code];
  }
  for (const [code, when] of Object.entries(theirs.forgotten)) {
    const mine = seats.find((x) => x.code === code);
    if (mine && (mine.at ?? mine.ts) > when) continue;
    seats = seats.filter((x) => x !== mine);
    forgotten[code] = Math.max(when, forgotten[code] ?? 0);
  }
  write(seats.sort((a, b) => b.ts - a.ts), s);
  writeForgotten(forgotten, s);
}

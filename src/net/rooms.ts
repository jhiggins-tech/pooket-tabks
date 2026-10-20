import { hex } from '../core/hex';
import { errText, netLog } from './log';
import { clientId } from './push';
import { RtdbError, SERVER_TIME, type Rtdb } from './rtdb';
import { readRecord, saveOffer, type OpenRecord, type StoredGame } from './record';
import type { Compat } from './version';
import { sealerFor, type Sealer } from './seal';

/**
 * Online play through Firebase (Realtime Database, REST): a room is `rooms/<hash of the code>` with a
 * host seat, a guest seat, and the match's record (`game`, record.ts: the host's open offer until someone
 * joins, then the match itself), plus the spectator feed. Everything in it is sealed with a key from the
 * room code, so the database only holds ciphertext under a path nobody can guess. It all goes phone →
 * Firebase → phone, so it works on any network, including mobile data. The room outlives both phones
 * leaving: a room with a recent record can't be taken over by a new host (the database rules see to that).
 *
 * A seat ({ id, ts, dev }) also says which device has it (`dev`, net/push.ts `clientId`): a player signed
 * in on two phones can open the same match on either. The one that takes the seat last plays; the other
 * sees `dev` change under the same id (`watchSeat`) and stands aside. (Seats written by older versions
 * have no `dev`: nothing to compare, so nobody stands aside.)
 */

/**
 * Why a room couldn't be opened, joined, rejoined or watched (the message is for showing): the database
 * couldn't be reached (`offline`) or wouldn't give us a code (`refused`), there's no such game (`no-game`),
 * it already has two players (`full`), the match has ended (`ended`), or someone else has our seat
 * (`seat-taken`).
 */
export class RoomError extends Error {
  constructor(
    readonly kind: 'offline' | 'refused' | 'no-game' | 'full' | 'ended' | 'seat-taken',
    message: string,
  ) {
    super(message);
  }
}

export const ROOM_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const HOST_REFRESH_MS = 30_000;
/** Taking a seat over from another device: give that one a moment to notice and stand aside. */
export const TAKEOVER_WAIT_MS = 1500;

/** A room in the database: where it is and its seal. */
export interface RoomRef {
  db: Rtdb;
  /** `rooms/<topic>` */
  path: string;
  sealer: Sealer;
}

/** The room with this code: `rooms/<topic>`, sealed with a key from the code. */
export async function roomRef(db: Rtdb, code: string): Promise<RoomRef> {
  const sealer = await sealerFor('room', code);
  return { db, path: `rooms/${sealer.topic}`, sealer };
}

/** Take (or take back) a seat as `id`, on device `dev`. */
const claimSeat = (room: RoomRef, role: 'host' | 'guest', id: string, dev: string) => room.db.put(`${room.path}/${role}`, { id, ts: SERVER_TIME, dev });

/** Check in as the host (just the time: whose device it is stays as it was claimed). */
const checkIn = (room: RoomRef) => () => void room.db.patch(`${room.path}/host`, { ts: SERVER_TIME }).catch(() => {});

export function randomId(): string {
  return hex(globalThis.crypto.getRandomValues(new Uint8Array(8)));
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

/** A room this phone is hosting, waiting for someone to join. */
export class HostedRoom {
  private matchStream: { close: () => void } | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private stopped = false;

  private constructor(
    /** The room in the database (for checking in, notifications). */
    readonly ref: RoomRef,
    readonly code: string,
    private readonly hostId: string,
  ) {}

  /**
   * Claim a fresh room code (trying another if it's taken). With an `offer`, the game is open: whoever
   * joins first can start it, even with the host away.
   */
  static async open(db: Rtdb, offer?: OpenRecord['open'], dev = clientId()): Promise<HostedRoom> {
    const hostId = randomId();
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = newRoomCode();
      const ref = await roomRef(db, code);
      try {
        await claimSeat(ref, 'host', hostId, dev);
        // A clean slate (leftovers from an old game with the same code).
        await db.patch(ref.path, { guest: null, view: null, game: null });
        if (offer) await saveOffer(ref, offer);
        netLog(`rooms: hosting ${code}`);
        const room = new HostedRoom(ref, code, hostId);
        room.timers.push(setInterval(checkIn(ref), HOST_REFRESH_MS));
        return room;
      } catch (e) {
        if (!(e instanceof RtdbError)) {
          netLog(`rooms: couldn't reach the database (${errText(e)})`);
          throw new RoomError('offline', "Couldn't reach the game server. Is this phone online?");
        }
        netLog(`rooms: code ${code} refused (${e.message})`);
      }
    }
    throw new RoomError('refused', "The game server wouldn't open a room. Try again in a moment.");
  }

  /** Back to our open game (nobody's joined yet): the host seat again, waiting as before. */
  static async reclaim(db: Rtdb, code: string, hostId: string, dev = clientId()): Promise<HostedRoom> {
    const ref = await roomRef(db, code);
    await claimSeat(ref, 'host', hostId, dev);
    netLog(`rooms: back to hosting ${code}`);
    const room = new HostedRoom(ref, code, hostId);
    room.timers.push(setInterval(checkIn(ref), HOST_REFRESH_MS));
    return room;
  }

  /** Update the open offer (e.g. listed or private). */
  offer(offer: OpenRecord['open']): Promise<void> {
    return saveOffer(this.ref, offer);
  }

  /** Resolves with the match once someone has joined and started it (the guest starts it as it joins). */
  waitForMatch(): Promise<StoredGame> {
    return new Promise((resolve) => {
      let opening = Promise.resolve();
      this.matchStream = this.ref.db.stream(`${this.ref.path}/game`, (e) => {
        if (e.path !== '/' || e.kind !== 'put') return;
        opening = opening.then(async () => {
          const r = await readRecord(this.ref.sealer, e.data);
          if (this.stopped || !r || !('game' in r)) return;
          netLog('rooms: someone joined, and the match has started');
          this.stop();
          resolve(r.game);
        });
      });
    });
  }

  /**
   * Stop waiting and checking in, leaving the room as it is (an open game stays open; once the match has
   * started, its MatchLink has it). Only `cancel` removes the room.
   */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.matchStream?.close();
    this.timers.forEach(clearInterval);
  }

  /** Stop, and say the host isn't here any more (it's left the host screen: the game stays open). */
  leave(): void {
    if (this.stopped) return;
    this.stop();
    void this.ref.db.patch(`${this.ref.path}/host`, { out: true }).catch(() => {});
  }

  /** Stop and remove the room entirely (nobody joined). */
  cancel(): void {
    this.stop();
    void this.ref.db.patch(this.ref.path, ROOM_CLEARED).catch(() => {});
  }

  get id(): string {
    return this.hostId;
  }
}

/** Everything in a room, removed. (`h2g` and `g2h`: left by older versions, which talked through them.) */
export const ROOM_CLEARED = { host: null, guest: null, h2g: null, g2h: null, view: null, game: null };

/**
 * Join a room's open game by code: take the guest seat (as `id`, kept for rejoining). Resolves with the
 * room, the host's offer (to start the match from: the guest starts it) and who's hosting. A room whose match has
 * started already has two players: `full` (watch it instead).
 */
export async function joinRoom(db: Rtdb, code: string, id = randomId(), dev = clientId()): Promise<{ room: RoomRef; offer: OpenRecord['open']; compat: Compat; hostId: string }> {
  const room = await roomRef(db, code);
  const [host, rec] = await Promise.all([db.get<{ id: string; ts: number }>(`${room.path}/host`), db.get(`${room.path}/game`).then((raw) => readRecord(room.sealer, raw))]);
  if (!host || !rec) {
    netLog(`rooms: no game in ${code}`);
    throw new RoomError('no-game', `No game with code ${code}. Check it, and that the host hasn't cancelled it.`);
  }
  if (!('offer' in rec)) throw new RoomError('full', 'That game already has two players.');
  try {
    await claimSeat(room, 'guest', id, dev);
  } catch (e) {
    if (e instanceof RtdbError && e.denied) throw new RoomError('full', 'That game already has two players.');
    throw e;
  }
  netLog(`rooms: joined ${code}`);
  return { room, offer: rec.offer, compat: rec.compat, hostId: host.id };
}

/** Take back our seat in a match (the seat remembers our id). */
export async function rejoinRoom(db: Rtdb, code: string, role: 'host' | 'guest', id: string, dev = clientId()): Promise<RoomRef> {
  const room = await roomRef(db, code);
  const [host, mine] = await Promise.all([db.get<{ id: string }>(`${room.path}/host`), db.get<{ id?: string; dev?: string }>(`${room.path}/${role}`)]);
  if (!host || (role === 'host' && host.id !== id)) {
    netLog(`rooms: ${code} has closed`);
    throw new RoomError('ended', `That match (${code}) has ended.`);
  }
  try {
    await claimSeat(room, role, id, dev);
  } catch (e) {
    if (e instanceof RtdbError && e.denied) throw new RoomError('seat-taken', 'Someone else has taken your seat in that match.');
    throw e;
  }
  if (mine?.id === id && mine.dev && mine.dev !== dev) {
    // Our other phone had the seat: let it see that and stand aside first.
    netLog(`rooms: taking ${code} over from another device`);
    await new Promise((r) => setTimeout(r, TAKEOVER_WAIT_MS));
  }
  netLog(`rooms: rejoined ${code} as ${role}`);
  return room;
}

/**
 * Calls `taken` (once) if our seat is claimed by another device under the same id: this player has
 * opened the match on another phone, which plays from now on.
 */
export function watchSeat(room: RoomRef, role: 'host' | 'guest', id: string, taken: () => void, dev = clientId()): { close: () => void } {
  let seat: { id?: unknown; dev?: unknown } = {};
  let done = false;
  const stream = room.db.stream(`${room.path}/${role}`, (e) => {
    if (done) return;
    if (e.path === '/') {
      const data = (e.data && typeof e.data === 'object' ? e.data : {}) as typeof seat;
      seat = e.kind === 'patch' ? { ...seat, ...data } : data;
    } else {
      const key = e.path.split('/')[1] as 'id' | 'dev';
      if (e.path.split('/').length === 2) seat = { ...seat, [key]: e.data };
    }
    if (seat.id === id && typeof seat.dev === 'string' && seat.dev !== dev) {
      done = true;
      stream.close();
      netLog('rooms: our seat was taken by another device');
      taken();
    }
  });
  return { close: () => ((done = true), stream.close()) };
}

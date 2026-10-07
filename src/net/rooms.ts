import { errText, netLog } from './log';
import { clientId } from './push';
import { queuesFor, RelayTransport, ROOM_CLEARED } from './relay';
import { RtdbError, SERVER_TIME, type Rtdb } from './rtdb';
import { saveOffer, type OpenRecord } from './record';
import { sealerFor, type Sealer } from './seal';

/**
 * Online play through Firebase (Realtime Database, REST): a room is `rooms/<hash of the code>` with a
 * host seat, a guest seat, and two message queues (h2g, g2h). Everything in it is sealed with a key from
 * the room code, so the database only holds ciphertext under a path nobody can guess. Messages travel
 * phone → Firebase → phone, so it works on any network, including mobile data. Once a match starts the
 * room also keeps its record (`game`, record.ts), so it outlives both phones leaving: a room with a
 * recent record can't be taken over by a new host (the database rules see to that).
 *
 * A seat ({ id, ts, dev }) also says which device has it (`dev`, net/push.ts `clientId`): a player signed
 * in on two phones can open the same match on either. The one that takes the seat last plays; the other
 * sees `dev` change under the same id (`watchSeat`) and stands aside. (Seats written by older versions
 * have no `dev`: nothing to compare, so nobody stands aside.)
 */

export const ROOM_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** A host that hasn't checked in for this long has gone (or is away from its open game). */
const HOST_STALE_MS = 90_000;
const HOST_REFRESH_MS = 30_000;
/** Taking a seat over from another device: give that one a moment to notice and stop reading our messages. */
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

/** A room this phone is hosting, waiting for someone to join. */
export class HostedRoom {
  private guestStream: { close: () => void } | null = null;
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
        await db.patch(ref.path, { guest: null, h2g: null, g2h: null, view: null, game: null });
        if (offer) await saveOffer(ref, offer);
        netLog(`rooms: hosting ${code}`);
        const room = new HostedRoom(ref, code, hostId);
        room.timers.push(setInterval(checkIn(ref), HOST_REFRESH_MS));
        return room;
      } catch (e) {
        if (!(e instanceof RtdbError)) {
          netLog(`rooms: couldn't reach the database (${errText(e)})`);
          throw new Error("Couldn't reach the game server. Is this phone online?");
        }
        netLog(`rooms: code ${code} refused (${e.message})`);
      }
    }
    throw new Error("The game server wouldn't open a room. Try again in a moment.");
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

  /** Resolves with a message pipe once someone takes the guest seat. */
  waitForGuest(opts?: RelayOptions): Promise<RelayTransport> {
    return new Promise((resolve) => {
      this.guestStream = this.ref.db.stream(`${this.ref.path}/guest`, (e) => {
        const guest = e.path === '/' ? (e.data as { id?: string } | null) : null;
        if (this.stopped || !guest?.id) return;
        netLog(`rooms: ${guest.id.slice(0, 4)} joined`);
        this.guestStream?.close();
        this.timers.forEach(clearInterval);
        resolve(new RelayTransport(this.ref, 'host', { ...opts, me: this.hostId, peer: guest.id }).start());
      });
    });
  }

  /**
   * The guest turned out not to be a real player (a link preview that joined and vanished): free the
   * guest seat and its queues, ready for `waitForGuest` again.
   */
  async reopen(): Promise<void> {
    this.stopped = false;
    this.guestStream?.close();
    await this.ref.db.patch(this.ref.path, { guest: null, h2g: null, g2h: null, view: null }); // (the open offer stays)
    this.timers.push(setInterval(checkIn(this.ref), HOST_REFRESH_MS));
    netLog('rooms: guest seat freed');
  }

  /**
   * Stop waiting and checking in, leaving the room as it is (an open game stays open; once a game has
   * started, the transport has it). Only `cancel` removes the room.
   */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.guestStream?.close();
    this.timers.forEach(clearInterval);
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

type RelayOptions = ConstructorParameters<typeof RelayTransport>[2];

/** Join a room by code: take the guest seat (as `id`, kept for rejoining) and get a message pipe. */
export async function joinRoom(db: Rtdb, code: string, opts?: RelayOptions, id = randomId(), dev = clientId()): Promise<RelayTransport> {
  const room = await roomRef(db, code);
  const [host, open] = await Promise.all([db.get<{ id: string; ts: number }>(`${room.path}/host`), db.get<number>(`${room.path}/game/ts`)]);
  // An open game can be joined with its host away; otherwise the host has to be there.
  if (!host || (open === null && Date.now() - host.ts > HOST_STALE_MS)) {
    netLog(`rooms: no live host for ${code}${host ? ' (stale)' : ''}`);
    throw new Error(`No game with code ${code}. Check it, and that the host is still on the Host screen.`);
  }
  try {
    await claimSeat(room, 'guest', id, dev);
  } catch (e) {
    if ((e as { denied?: boolean }).denied) throw new Error('That game already has two players.');
    throw e;
  }
  netLog(`rooms: joined ${code}`);
  return new RelayTransport(room, 'guest', { ...opts, me: id, peer: host.id }).start();
}

/** Whether a room's host is there right now (it checks in every HOST_REFRESH_MS while it is), and who it is. */
export async function roomHost(db: Rtdb, code: string): Promise<{ id: string; here: boolean } | null> {
  const room = await roomRef(db, code);
  const host = await db.get<{ id: string; ts: number }>(`${room.path}/host`);
  return host ? { id: host.id, here: Date.now() - host.ts < HOST_STALE_MS } : null;
}

/** Take back our seat in a match we dropped out of (the seat remembers our id), with a fresh pipe. */
export async function rejoinRoom(db: Rtdb, code: string, role: 'host' | 'guest', id: string, opts?: RelayOptions, dev = clientId()): Promise<RelayTransport> {
  const room = await roomRef(db, code);
  const [host, mine] = await Promise.all([db.get<{ id: string }>(`${room.path}/host`), db.get<{ id?: string; dev?: string }>(`${room.path}/${role}`)]);
  if (!host || (role === 'host' && host.id !== id)) {
    netLog(`rooms: ${code} has closed`);
    throw new Error(`That match (${code}) has ended.`);
  }
  try {
    await claimSeat(room, role, id, dev);
  } catch (e) {
    if ((e as { denied?: boolean }).denied) throw new Error('Someone else has taken your seat in that match.');
    throw e;
  }
  const inbox = `${room.path}/${queuesFor(role).inbox}`;
  if (mine?.id === id && mine.dev && mine.dev !== dev) {
    // Our other phone had the seat: let it see that and stop reading our messages first.
    netLog(`rooms: taking ${code} over from another device`);
    await new Promise((r) => setTimeout(r, TAKEOVER_WAIT_MS));
  }
  // Whatever's waiting was for our old connection: start clean. (Anything more they send on it is
  // numbered past the start, so it's never taken up.)
  await db.remove(inbox);
  netLog(`rooms: rejoined ${code} as ${role}`);
  const guest = role === 'host' ? await db.get<{ id: string }>(`${room.path}/guest`) : null;
  const peer = role === 'guest' ? host.id : guest?.id;
  return new RelayTransport(room, role, { ...opts, me: id, peer }).start();
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

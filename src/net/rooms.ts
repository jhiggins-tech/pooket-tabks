import { netLog } from './log';
import { RelayTransport, ROOM_CLEARED } from './relay';
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
 */

export const ROOM_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** A host that hasn't checked in for this long has gone (or is away from its open game). */
const HOST_STALE_MS = 90_000;
const HOST_REFRESH_MS = 30_000;

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
    private readonly db: Rtdb,
    readonly code: string,
    private readonly path: string,
    private readonly sealer: Sealer,
    private readonly hostId: string,
  ) {}

  /**
   * Claim a fresh room code (trying another if it's taken). With an `offer`, the game is open: whoever
   * joins first can start it, even with the host away.
   */
  static async open(db: Rtdb, offer?: OpenRecord['open']): Promise<HostedRoom> {
    const hostId = randomId();
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = newRoomCode();
      const sealer = await sealerFor('room', code);
      const path = `rooms/${sealer.topic}`;
      try {
        await db.put(`${path}/host`, { id: hostId, ts: SERVER_TIME });
        // A clean slate (leftovers from an old game with the same code).
        await db.patch(path, { guest: null, h2g: null, g2h: null, view: null, game: null });
        if (offer) await saveOffer(db, path, sealer, offer);
        netLog(`rooms: hosting ${code}`);
        const room = new HostedRoom(db, code, path, sealer, hostId);
        room.timers.push(setInterval(() => void db.put(`${path}/host`, { id: hostId, ts: SERVER_TIME }).catch(() => {}), HOST_REFRESH_MS));
        return room;
      } catch (e) {
        if (!(e instanceof RtdbError)) {
          netLog(`rooms: couldn't reach the database (${e instanceof Error ? e.message : e})`);
          throw new Error("Couldn't reach the game server. Is this phone online?");
        }
        netLog(`rooms: code ${code} refused (${e.message})`);
      }
    }
    throw new Error("The game server wouldn't open a room. Try again in a moment.");
  }

  /** Back to our open game (nobody's joined yet): the host seat again, waiting as before. */
  static async reclaim(db: Rtdb, code: string, hostId: string): Promise<HostedRoom> {
    const sealer = await sealerFor('room', code);
    const path = `rooms/${sealer.topic}`;
    await db.put(`${path}/host`, { id: hostId, ts: SERVER_TIME });
    netLog(`rooms: back to hosting ${code}`);
    const room = new HostedRoom(db, code, path, sealer, hostId);
    room.timers.push(setInterval(() => void db.put(`${path}/host`, { id: hostId, ts: SERVER_TIME }).catch(() => {}), HOST_REFRESH_MS));
    return room;
  }

  /** Update the open offer (e.g. listed or private). */
  offer(offer: OpenRecord['open']): Promise<void> {
    return saveOffer(this.db, this.path, this.sealer, offer);
  }

  /** Resolves with a message pipe once someone takes the guest seat. */
  waitForGuest(opts?: RelayOptions): Promise<RelayTransport> {
    return new Promise((resolve) => {
      this.guestStream = this.db.stream(`${this.path}/guest`, (e) => {
        const guest = e.path === '/' ? (e.data as { id?: string } | null) : null;
        if (this.stopped || !guest?.id) return;
        netLog(`rooms: ${guest.id.slice(0, 4)} joined`);
        this.guestStream?.close();
        this.timers.forEach(clearInterval);
        resolve(new RelayTransport(this.db, this.path, 'host', this.sealer, { ...opts, me: this.hostId, peer: guest.id }).start());
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
    await this.db.patch(this.path, { guest: null, h2g: null, g2h: null, view: null }); // (the open offer stays)
    this.timers.push(setInterval(() => void this.db.put(`${this.path}/host`, { id: this.hostId, ts: SERVER_TIME }).catch(() => {}), HOST_REFRESH_MS));
    netLog('rooms: guest seat freed');
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

type RelayOptions = ConstructorParameters<typeof RelayTransport>[4];

/** Join a room by code: take the guest seat (as `id`, kept for rejoining) and get a message pipe. */
export async function joinRoom(db: Rtdb, code: string, opts?: RelayOptions, id = randomId()): Promise<RelayTransport> {
  const sealer = await sealerFor('room', code);
  const path = `rooms/${sealer.topic}`;
  const [host, open] = await Promise.all([db.get<{ id: string; ts: number }>(`${path}/host`), db.get<number>(`${path}/game/ts`)]);
  // An open game can be joined with its host away; otherwise the host has to be there.
  if (!host || (open === null && Date.now() - host.ts > HOST_STALE_MS)) {
    netLog(`rooms: no live host for ${code}${host ? ' (stale)' : ''}`);
    throw new Error(`No game with code ${code}. Check it, and that the host is still on the Host screen.`);
  }
  try {
    await db.put(`${path}/guest`, { id, ts: SERVER_TIME });
  } catch (e) {
    if ((e as { denied?: boolean }).denied) throw new Error('That game already has two players.');
    throw e;
  }
  netLog(`rooms: joined ${code}`);
  return new RelayTransport(db, path, 'guest', sealer, { ...opts, me: id, peer: host.id }).start();
}

/** Whether a room's host is there right now (it checks in every HOST_REFRESH_MS while it is), and who it is. */
export async function roomHost(db: Rtdb, code: string): Promise<{ id: string; here: boolean } | null> {
  const sealer = await sealerFor('room', code);
  const host = await db.get<{ id: string; ts: number }>(`rooms/${sealer.topic}/host`);
  return host ? { id: host.id, here: Date.now() - host.ts < HOST_STALE_MS } : null;
}

/** Take back our seat in a match we dropped out of (the seat remembers our id), with a fresh pipe. */
export async function rejoinRoom(db: Rtdb, code: string, role: 'host' | 'guest', id: string, opts?: RelayOptions): Promise<RelayTransport> {
  const sealer = await sealerFor('room', code);
  const path = `rooms/${sealer.topic}`;
  const host = await db.get<{ id: string }>(`${path}/host`);
  if (!host || (role === 'host' && host.id !== id)) {
    netLog(`rooms: ${code} has closed`);
    throw new Error(`That match (${code}) has ended.`);
  }
  try {
    await db.put(`${path}/${role}`, { id, ts: SERVER_TIME });
  } catch (e) {
    if ((e as { denied?: boolean }).denied) throw new Error('Someone else has taken your seat in that match.');
    throw e;
  }
  // Whatever's waiting was for our old connection: start clean. (Anything more they send on it is
  // numbered past the start, so it's never taken up.)
  await db.remove(`${path}/${role === 'host' ? 'g2h' : 'h2g'}`);
  netLog(`rooms: rejoined ${code} as ${role}`);
  const guest = role === 'host' ? await db.get<{ id: string }>(`${path}/guest`) : null;
  const peer = role === 'guest' ? host.id : guest?.id;
  return new RelayTransport(db, path, role, sealer, { ...opts, me: id, peer }).start();
}

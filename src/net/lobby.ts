import { errText, netLog } from './log';
import { type Rtdb } from './rtdb';
import { type Sealer, sealerFor } from './seal';
import { openSealed, putSealed } from './sealed';

/**
 * The Games list: every public game, on any network, for anyone to join (waiting for a second player)
 * or watch (under way). A host keeps its listing fresh while it's there; a game waiting for a player
 * (`open`) stays on the list without its host (whoever joins first starts it), up to OPEN_ADVERT_MS; a
 * live listing that stops being refreshed drops off quickly. Old ones are removed by whoever sees them.
 * Listings live at `lobby/<topic>/<hostId>`, sealed with a key from the list's name: that keeps the
 * database tidy, not secret (the game itself knows the name).
 */

/** The one list everyone shares. (Tests use their own, `?debug&lobby=NAME`, so they don't see each other.) */
export const PUBLIC_LOBBY = 'everyone';
const ADVERT_EVERY_MS = 30_000;
const ADVERT_STALE_MS = 90_000;
/** A listing this old is from a host long gone: whoever sees it removes it. */
const ADVERT_GONE_MS = 10 * 60_000;
/** A game waiting for a player stays listed this long without its host (then it's forfeit territory). */
export const OPEN_ADVERT_MS = 3 * 24 * 60 * 60_000;

/** A game on the list. */
export interface Advert {
  hostId: string;
  name: string;
  characterId: string;
  room: string;
  ts: number;
  /** Two players are in: others can watch. */
  playing?: boolean;
  /** Waiting for a player, and stays listed even while the host is away. */
  open?: boolean;
  /** The second player, once they've said hello. */
  opponent?: { name: string; characterId: string };
  /** The match has finished (they may start another). */
  over?: boolean;
}

export function lobbySealer(name = PUBLIC_LOBBY): Promise<Sealer> {
  return sealerFor('lobby', name);
}

/** Host: keep a game on the list (refreshed) until stopped. */
export function advertise(
  db: Rtdb,
  lobby: Sealer,
  ad: Omit<Advert, 'ts'>,
): { stop: () => void; pause: () => void; update: (changes: Partial<Advert>) => void } {
  const path = `lobby/${lobby.topic}/${ad.hostId}`;
  let stopped = false;
  const put = async () => {
    if (stopped) return;
    try {
      await putSealed(db, path, lobby, { ...ad, ts: Date.now() });
    } catch (e) {
      netLog(`lobby: listing failed (${errText(e)})`);
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
    pause: () => {
      stopped = true;
      clearInterval(timer);
    },
    update: (changes) => {
      Object.assign(ad, changes);
      void put();
    },
  };
}

/**
 * A host's game on the list, which can be switched on and off (public or private) at any time without
 * losing track of its state.
 */
export class Listing {
  private ad: ReturnType<typeof advertise> | null = null;

  constructor(
    private readonly db: Rtdb,
    private readonly lobby: Sealer,
    private readonly info: Omit<Advert, 'ts'>,
  ) {}

  get listed(): boolean {
    return this.ad !== null;
  }

  list(on: boolean): void {
    if (on && !this.ad) {
      this.ad = advertise(this.db, this.lobby, this.info);
      netLog(`lobby: listed ${this.info.room}`);
    } else if (!on && this.ad) {
      this.ad.stop();
      this.ad = null;
      netLog(`lobby: unlisted ${this.info.room}`);
    }
  }

  update(changes: Partial<Advert>): void {
    const before = JSON.stringify(this.info);
    Object.assign(this.info, changes);
    if (JSON.stringify(this.info) !== before) this.ad?.update({});
  }

  stop(): void {
    this.list(false);
  }

  /** Stop keeping it fresh but leave it on the list (an open game carries on without its host). */
  leave(): void {
    this.ad?.pause();
    this.ad = null;
  }
}

/** Watch the list: `onList` gets every live listing (newest first) whenever it changes. */
export function watchLobby(db: Rtdb, lobby: Sealer, onList: (games: Advert[]) => void): { stop: () => void } {
  const base = `lobby/${lobby.topic}`;
  const games = new Map<string, Advert>();
  const shown = (g: Advert) => Date.now() - g.ts < (g.open && !g.playing ? OPEN_ADVERT_MS : ADVERT_STALE_MS);
  const emit = () => onList([...games.values()].filter(shown).sort((a, b) => b.ts - a.ts));
  const take = (hostId: string, v: unknown) => {
    if (typeof (v as { m?: unknown } | null)?.m !== 'string') {
      games.delete(hostId);
      emit();
      return;
    }
    void openSealed<Advert>(lobby, v).then((entry) => {
      const ad = entry?.value;
      if (!ad || ad.hostId !== hostId) return;
      if (Date.now() - ad.ts > (ad.open && !ad.playing ? OPEN_ADVERT_MS : 0) + ADVERT_GONE_MS) {
        void db.remove(`${base}/${hostId}`).catch(() => {}); // tidy up after a host that vanished
        return;
      }
      games.set(hostId, ad);
      emit();
    });
  };
  const stream = db.stream(base, (e) => {
    if (e.path === '/') {
      games.clear();
      for (const [k, v] of Object.entries((e.data as Record<string, unknown>) ?? {})) take(k, v);
      emit();
    } else {
      const [hostId, child] = e.path.slice(1).split('/');
      if (!hostId) return;
      if (child) void db.get(`${base}/${hostId}`).then((v) => take(hostId, v));
      else take(hostId, e.data);
    }
  });
  // Listings age out even when nothing changes.
  const timer = setInterval(emit, 5000);
  emit();
  return {
    stop: () => {
      clearInterval(timer);
      stream.close();
    },
  };
}

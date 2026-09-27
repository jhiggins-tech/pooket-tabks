import { fromB64, toB64 } from './b64';
import { netLog } from './log';
import { SERVER_TIME, type Rtdb } from './rtdb';
import { seal, sealerFor, unseal, type Sealer } from './seal';

/** The nearby list: games hosted on the same Wi-Fi (keyed by its public address), sealed with a key from it. */

const ADVERT_EVERY_MS = 30_000;
const ADVERT_STALE_MS = 90_000;

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

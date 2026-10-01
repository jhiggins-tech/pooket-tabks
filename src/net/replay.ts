import { finishDecoyPick, fire } from '../game/game';
import type { GameState, PlayerConfig } from '../game/state';
import { fromB64, toB64 } from './b64';
import { netLog } from './log';
import type { GameRecord, GameStore, ShotRecord } from './record';
import { SERVER_TIME, type Rtdb } from './rtdb';
import { seal, sealerFor, unseal, type Sealer } from './seal';
import { applySnapshot, decodeSolid, type Snapshot } from './snapshot';

/**
 * Replays of public matches (ones on the Games list), to watch once they're over: the Game browser's
 * "Past matches". A replay is every shot of the match, each as the exact state just before it was fired
 * (so it plays out just as it did, and a shot that didn't make it is simply skipped), and how it ended.
 *
 * - `replays/<topic>/<entry>`: the shots (`s<turn>_<the shooter's rounds>`, ShotRecord) and the end
 *   (`end`), sealed with a key from the replay's id: whoever has the id can watch it.
 * - `replayList/<Games list topic>/<topic>`: the list (ReplayListing, sealed like the Games list),
 *   written when the match starts and again when it's over. Whoever loads the list removes old ones,
 *   replays and all.
 *
 * The phone in charge writes them, as it writes the game record (`ReplayRecorder` is a GameStore). The
 * replay's id is in the match setup (NetSession.publicReplay), so either phone can.
 */

/** A finished match can be replayed for this long. */
export const REPLAY_KEEP_MS = 14 * 24 * 60 * 60_000;
/** A match that never finished is tidied away after this long. */
const UNFINISHED_KEEP_MS = 30 * 24 * 60 * 60_000;
/** How many past matches the Game browser shows. */
const LIST_MAX = 30;

/** A public match, on the list of replays. */
export interface ReplayListing {
  id: string;
  seed: number;
  players: PlayerConfig[];
  /** Once it's over: who won (seat; null for a draw), why if it wasn't the guns, and how many turns it took. */
  over?: { winner: number | null; endReason: GameState['endReason']; turns: number };
  /** When it was listed (server time, ms). */
  ts: number;
}

/** Everything needed to watch a match again. */
export interface Replay {
  listing: ReplayListing;
  shots: ShotRecord[];
  end: { snap: Snapshot; terrain: string } | null;
}

export function newReplayId(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(12));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const replaySealer = (id: string) => sealerFor('replay', id);
const listSealer = (lobby: string) => sealerFor('replays', lobby);

/** Where a shot goes: by turn, then by the shooter's rounds (a turn can have a bonus move or a steal first). */
function shotKey(shot: ShotRecord): string {
  const shooter = (shot.snap.players as { ammo: number[] }[] | undefined)?.[shot.owner];
  return `s${shot.turn}_${shooter?.ammo.join('-') ?? ''}`;
}

/** Records a public match's replay, from the game record as the phone in charge writes it. */
export class ReplayRecorder implements GameStore {
  /** What this phone has written (or is writing). */
  private readonly done = new Set<string>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: Rtdb,
    private readonly lobby: string,
  ) {}

  save(rec: GameRecord): void {
    const id = rec.setup.replay;
    if (!id) return;
    const over = rec.snap.phase === 'gameover';
    if (!rec.last && !rec.flying && !over) this.once(`${id}/listing`, () => this.list(rec, id));
    // (Each shot is in the record as it's fired, by the phone that fired it.)
    const shot = rec.flying;
    if (shot) this.once(`${id}/${shotKey(shot)}`, () => this.put(id, shotKey(shot), shot));
    if (over) {
      this.once(`${id}/end`, async () => {
        await this.put(id, 'end', { snap: rec.snap, terrain: rec.terrain });
        await this.list(rec, id);
      });
    }
  }

  /** Write it (in order, after anything before it), unless it's been written; tried again next time if it fails. */
  private once(key: string, write: () => Promise<void>): void {
    if (this.done.has(key)) return;
    this.done.add(key);
    this.queue = this.queue.then(write).catch((e: unknown) => {
      this.done.delete(key);
      netLog(`replay: couldn't save ${key.split('/')[1]} (${e instanceof Error ? e.message : e})`);
    });
  }

  private async put(id: string, entry: string, value: unknown): Promise<void> {
    const sealer = await replaySealer(id);
    await this.db.put(`replays/${sealer.topic}/${entry}`, { m: toB64(await seal(sealer, value)), ts: SERVER_TIME });
    netLog(`replay: saved ${entry}`);
  }

  private async list(rec: GameRecord, id: string): Promise<void> {
    const snap = rec.snap as Snapshot & Pick<GameState, 'phase' | 'endReason'>;
    const listing: Omit<ReplayListing, 'ts'> = { id, seed: rec.setup.seed, players: rec.setup.players };
    if (snap.phase === 'gameover') listing.over = { winner: snap.winner, endReason: snap.endReason, turns: snap.turn };
    const [lobby, sealer] = await Promise.all([listSealer(this.lobby), replaySealer(id)]);
    await this.db.put(`replayList/${lobby.topic}/${sealer.topic}`, { m: toB64(await seal(lobby, listing)), ts: SERVER_TIME });
    netLog(`replay: listed${listing.over ? ' (over)' : ''}`);
  }
}

/** The finished public matches, newest first (and old ones tidied away). */
export async function loadReplays(db: Rtdb, lobbyName: string, now = Date.now()): Promise<ReplayListing[]> {
  const lobby = await listSealer(lobbyName);
  const raw = (await db.get<Record<string, { m?: unknown; ts?: unknown }>>(`replayList/${lobby.topic}`)) ?? {};
  const out = await Promise.all(
    Object.entries(raw).map(async ([topic, v]): Promise<ReplayListing | null> => {
      if (typeof v?.m !== 'string' || typeof v.ts !== 'number') return null;
      const listing = (await unseal(lobby, fromB64(v.m))) as Omit<ReplayListing, 'ts'> | null;
      if (!listing) return null;
      if (now - v.ts > (listing.over ? REPLAY_KEEP_MS : UNFINISHED_KEEP_MS)) {
        netLog('replay: tidying away an old one');
        void db.remove(`replays/${topic}`).then(() => db.remove(`replayList/${lobby.topic}/${topic}`)).catch(() => {});
        return null;
      }
      return { ...listing, ts: v.ts };
    }),
  );
  return out
    .filter((r): r is ReplayListing => !!r?.over)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, LIST_MAX);
}

/** A match's replay: its shots in order, and how it ended. */
export async function loadReplay(db: Rtdb, listing: ReplayListing): Promise<Replay> {
  const sealer: Sealer = await replaySealer(listing.id);
  const raw = (await db.get<Record<string, { m?: unknown; ts?: unknown }>>(`replays/${sealer.topic}`)) ?? {};
  const entries = await Promise.all(
    Object.entries(raw).map(async ([key, v]) => {
      if (typeof v?.m !== 'string') return null;
      const value = await unseal(sealer, fromB64(v.m));
      return value ? { key, ts: typeof v.ts === 'number' ? v.ts : 0, value } : null;
    }),
  );
  const shots: { shot: ShotRecord; ts: number }[] = [];
  let end: Replay['end'] = null;
  for (const e of entries) {
    if (!e) continue;
    if (e.key === 'end') end = e.value as Replay['end'];
    else shots.push({ shot: e.value as ShotRecord, ts: e.ts });
  }
  shots.sort((a, b) => a.shot.turn - b.shot.turn || a.ts - b.ts);
  netLog(`replay: loaded ${shots.length} shots${end ? '' : ' (no ending)'}`);
  return { listing, shots: shots.map((s) => s.shot), end };
}

/** Before the first shot; each shot's aim, shown before it's fired; after each shot has played out. */
const INTRO = 1.5;
const AIM = 1.2;
const AFTER = 0.8;
/** A shot that hasn't played out after this long is moved on from. */
const SHOT_MAX = 60;

/**
 * Plays a replay, view only (like a Spectator): builds the match, then for each shot puts everything as it
 * was just before it, shows the aim for a moment, fires and lets it play out. Ends on how it ended.
 * Call `tick` once a frame after stepping the simulation; `speed` is how much faster than life to run.
 */
export class ReplayPlayer {
  /** Build a fresh game for this match setup. */
  onStart: (seed: number, players: PlayerConfig[]) => GameState = () => {
    throw new Error('onStart not set');
  };
  speed = 1;

  private state: GameState | null = null;
  private next = 0;
  private stage: 'pause' | 'aim' | 'flying' | 'done' = 'pause';
  private wait = INTRO;
  private flown = 0;

  constructor(readonly replay: Replay) {}

  get game(): GameState | null {
    return this.state;
  }

  get finished(): boolean {
    return this.stage === 'done';
  }

  /** Watch it again from the top. */
  restart(): void {
    this.state = null;
  }

  tick(dt: number): void {
    if (!this.state) {
      netLog('replay: playing');
      this.state = this.onStart(this.replay.listing.seed, this.replay.listing.players);
      this.next = 0;
      this.stage = 'pause';
      this.wait = INTRO;
      return;
    }
    const s = this.state;
    switch (this.stage) {
      case 'pause':
        if ((this.wait -= dt) <= 0) this.advance(s);
        return;
      case 'aim':
        if ((this.wait -= dt) > 0) return;
        fire(s);
        finishDecoyPick(s); // which decoy they swapped into (if any) shows from the next shot on
        this.stage = 'flying';
        this.flown = 0;
        return;
      case 'flying':
        this.flown += dt;
        if (s.phase === 'aiming' || s.phase === 'gameover' || this.flown > SHOT_MAX) {
          this.stage = 'pause';
          this.wait = AFTER;
        }
        return;
    }
  }

  private advance(s: GameState): void {
    const shot = this.replay.shots[this.next++];
    if (shot) {
      put(s, shot.snap, shot.terrain);
      this.stage = 'aim';
      this.wait = AIM;
      return;
    }
    if (this.replay.end) put(s, this.replay.end.snap, this.replay.end.terrain);
    this.stage = 'done';
  }
}

function put(s: GameState, snap: Snapshot, terrain: string): void {
  applySnapshot(s, snap);
  s.terrain.patchSolid(decodeSolid(terrain, s.terrain.solid.length));
}

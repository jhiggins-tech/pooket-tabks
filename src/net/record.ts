import type { PlayerConfig } from '../game/state';
import { fromB64, toB64 } from './b64';
import { netLog } from './log';
import { SERVER_TIME, type Rtdb } from './rtdb';
import { seal, sealerFor, unseal, type Sealer } from './seal';
import type { Snapshot } from './snapshot';
import { decodeMsg, encodeMsg } from './wire';

/**
 * The lasting record of an online match, so it can be played turn by turn (take your turn, leave, and the
 * other player takes theirs when they're back). It lives in the room (`game`: sealed, with the server
 * time of the last write) and is written by whichever phone is in charge: the host when the match
 * starts, the shooter when they fire (so closing the app mid-shot can't undo a move) and when the shot
 * has played out. A phone that opens the game with nobody else there catches up from it.
 */

/** A turn nobody takes for this long is forfeited by whoever's turn it is. */
export const FORFEIT_MS = 3 * 24 * 60 * 60_000;

/** A shot: the state just before it was fired (and the terrain then), and whose it was. */
export interface ShotRecord {
  turn: number;
  owner: number;
  snap: Snapshot;
  terrain: string;
}

export interface GameRecord {
  /** The protocol it was written with: a game from another version can't be carried on. */
  v: number;
  setup: { seed: number; players: PlayerConfig[] };
  /** The match as it stands between shots. */
  snap: Snapshot;
  terrain: string;
  /** The shot that led to `snap` (replayed for the player who hasn't seen it). */
  last: ShotRecord | null;
  /** A shot fired but not yet played out (its phone went away mid-shot): whoever opens the game plays it out. */
  flying: ShotRecord | null;
}

/** A record as stored: `ts` is the server time of the last write (the last move). */
export interface StoredGame {
  rec: GameRecord;
  ts: number;
}

/** Where a session keeps its record (the room, or memory in tests). */
export interface GameStore {
  save(rec: GameRecord): void;
}

/** Writes a room's record, one write at a time, always the newest. */
export class RecordStore implements GameStore {
  private latest: GameRecord | null = null;
  private busy = false;

  constructor(
    private readonly db: Rtdb,
    private readonly roomPath: string,
    private readonly sealer: Sealer,
  ) {}

  save(rec: GameRecord): void {
    this.latest = rec;
    void this.write();
  }

  private async write(): Promise<void> {
    const rec = this.latest;
    if (!rec || this.busy) return;
    this.busy = true;
    this.latest = null;
    let saved = false;
    try {
      await this.db.put(`${this.roomPath}/game`, { m: toB64(await seal(this.sealer, encodeMsg(rec))), ts: SERVER_TIME });
      netLog(`record: saved (turn ${rec.snap.turn}${rec.flying ? ', a shot in flight' : ''})`);
      saved = true;
    } catch (e) {
      netLog(`record: couldn't save (${e instanceof Error ? e.message : e})`);
      this.latest ??= rec; // goes with the next save (not straight away: no hammering the server)
    } finally {
      this.busy = false;
    }
    if (saved && this.latest) void this.write();
  }
}

/** A room's record (null: the match never started, or the room has gone). */
export async function loadRecord(db: Rtdb, code: string): Promise<StoredGame | null> {
  const sealer = await sealerFor('room', code);
  const raw = await db.get<{ m?: unknown; ts?: unknown }>(`rooms/${sealer.topic}/game`);
  if (!raw || typeof raw.m !== 'string' || typeof raw.ts !== 'number') return null;
  const text = await unseal(sealer, fromB64(raw.m));
  return typeof text === 'string' ? { rec: decodeMsg(text) as GameRecord, ts: raw.ts } : null;
}

/** Nobody has moved for three days and the match isn't over: whoever's turn it is forfeits. */
export function forfeitDue(g: StoredGame, now = Date.now()): boolean {
  return g.rec.snap.phase !== 'gameover' && now - g.ts > FORFEIT_MS;
}

export type GameStatus = 'your-turn' | 'their-turn' | 'won' | 'lost' | 'draw' | 'old';

/** How a match stands for the player in `seat` (0 host, 1 guest), for the My games list. */
export function gameStatus(g: StoredGame, seat: number, protocol: number, now = Date.now()): GameStatus {
  if (g.rec.v !== protocol) return 'old';
  const snap = g.rec.snap as Snapshot & { phase: string; current: number };
  if (snap.phase === 'gameover') return snap.winner === null ? 'draw' : snap.winner === seat ? 'won' : 'lost';
  if (forfeitDue(g, now)) return snap.current === seat ? 'lost' : 'won';
  return snap.current === seat ? 'your-turn' : 'their-turn';
}

/** The other player's name in a match (seat 0 is the host). */
export function opponentName(g: StoredGame, seat: number): string {
  return g.rec.setup.players[seat === 0 ? 1 : 0]?.name ?? 'them';
}

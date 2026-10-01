import { netLog } from './log';
import type { Rtdb } from './rtdb';
import { sealerFor, type Sealer } from './seal';
import { getSealed, putSealed } from './sealed';
import type { MatchSetup, Pick } from './session';
import { compat, RULES, WIRE, type Compat } from './version';
import { upgradeSnapshot, type Snapshot } from './snapshot';
import { decodeMsg, encodeMsg } from './wire';
import { LatestWriter } from './writer';

/**
 * The lasting record of an online match, so it can be played turn by turn (take your turn, leave, and the
 * other player takes theirs when they're back). It lives in the room (`game`: sealed, with the server
 * time of the last write) and is written by whichever phone is in charge: the host when the match
 * starts, the shooter when they fire (so closing the app mid-shot can't undo a move) and when the shot
 * has played out. A phone that opens the game with nobody else there catches up from it.
 *
 * Before the match starts the same slot holds the host's open offer (`OpenRecord`: who's hosting and as
 * which character), so whoever joins first can start the match even if the host has gone.
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
  /** The wire version it was written in, and the rules of the build that wrote it (version.ts). */
  v: number;
  rules: number;
  /** The match's setup, including the rules it started on. */
  setup: MatchSetup;
  /** The match as it stands between shots. */
  snap: Snapshot;
  terrain: string;
  /** The shot that led to `snap` (replayed for the player who hasn't seen it). */
  last: ShotRecord | null;
  /** A shot fired but not yet played out (its phone went away mid-shot): whoever opens the game plays it out. */
  flying: ShotRecord | null;
}

/** A hosted game nobody has joined yet: the host's pick, and whether it's on the public Games list. */
export interface OpenRecord {
  v: number;
  rules: number;
  open: { host: Pick; listed: boolean };
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

/**
 * Writes a room's record, one write at a time, always the newest (a failed write goes with the next save).
 * (The record is sealed as a string of the wire format, inside: how it has always been stored.)
 */
export class RecordStore implements GameStore {
  private readonly writer: LatestWriter<GameRecord>;

  constructor(db: Rtdb, roomPath: string, sealer: Sealer) {
    this.writer = new LatestWriter(
      async (rec) => {
        await putSealed(db, `${roomPath}/game`, sealer, encodeMsg(rec));
        netLog(`record: saved (turn ${rec.snap.turn}${rec.flying ? ', a shot in flight' : ''})`);
      },
      { retry: true, failed: (e) => netLog(`record: couldn't save (${e instanceof Error ? e.message : e})`) },
    );
  }

  save(rec: GameRecord): void {
    this.writer.save(rec);
  }
}

/** Put up a hosted game's open offer (before anyone has joined). */
export async function saveOffer(db: Rtdb, roomPath: string, sealer: Sealer, offer: OpenRecord['open']): Promise<void> {
  const rec: OpenRecord = { v: WIRE, rules: RULES, open: offer };
  await putSealed(db, `${roomPath}/game`, sealer, encodeMsg(rec));
}

/** Whatever's in a room's record slot: a match, an open offer, or nothing. */
export async function loadRoomRecord(
  db: Rtdb,
  code: string,
): Promise<{ game: StoredGame } | { offer: OpenRecord['open']; compat: Compat; ts: number } | null> {
  const sealer = await sealerFor('room', code);
  const raw = await getSealed<unknown>(db, `rooms/${sealer.topic}/game`, sealer);
  if (!raw || typeof raw.value !== 'string') return null;
  const rec = decodeMsg(raw.value) as GameRecord | OpenRecord;
  // Written before the rules were recorded (1 Oct): wire 7 was rules 7. (Those matches are over by 5 Oct.)
  if (rec.v === 7) {
    rec.rules ??= 7;
    if ('setup' in rec) rec.setup.rules ??= 7;
  }
  if ('open' in rec) return { offer: rec.open, compat: compat(rec.v, rec.rules), ts: raw.ts };
  for (const snap of [rec.snap, rec.last?.snap, rec.flying?.snap]) if (snap) upgradeSnapshot(snap);
  return { game: { rec, ts: raw.ts } };
}

/** Whether this build can carry a stored match on: yes, it's too old, or it's from a newer build (reload first). */
export function recordCompat(rec: GameRecord): Compat {
  return compat(rec.v, rec.rules, rec.setup.rules);
}

/** A room's match record (null: the match hasn't started, or the room has gone). */
export async function loadRecord(db: Rtdb, code: string): Promise<StoredGame | null> {
  const r = await loadRoomRecord(db, code);
  return r && 'game' in r ? r.game : null;
}

/** Nobody has moved for three days and the match isn't over: whoever's turn it is forfeits. */
export function forfeitDue(g: StoredGame, now = Date.now()): boolean {
  return g.rec.snap.phase !== 'gameover' && now - g.ts > FORFEIT_MS;
}

export type GameStatus = 'your-turn' | 'their-turn' | 'won' | 'lost' | 'draw' | 'old' | 'newer';

/**
 * How a match stands for the player in `seat` (0 host, 1 guest), for the Game browser's list of your
 * matches: `old` (can't carry on) or `newer` (reload to play) when it's from another version.
 */
export function gameStatus(g: StoredGame, seat: number, now = Date.now()): GameStatus {
  const c = recordCompat(g.rec);
  if (c !== 'ok') return c;
  const snap = g.rec.snap as Snapshot & { phase: string; current: number };
  if (snap.phase === 'gameover') return snap.winner === null ? 'draw' : snap.winner === seat ? 'won' : 'lost';
  if (forfeitDue(g, now)) return snap.current === seat ? 'lost' : 'won';
  return snap.current === seat ? 'your-turn' : 'their-turn';
}

/** The other player's name in a match (seat 0 is the host). */
export function opponentName(g: StoredGame, seat: number): string {
  return g.rec.setup.players[seat === 0 ? 1 : 0]?.name ?? 'them';
}

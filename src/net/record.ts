import { errText, netLog } from './log';
import { roomRef, type RoomRef } from './rooms';
import { RtdbError, type Rtdb } from './rtdb';
import { openSealed, putSealed } from './sealed';
import type { Sealer } from './seal';
import { otherSeat } from './seat';
import type { MatchSetup, Pick } from './session';
import { compat, RULES, WIRE, type Compat } from './version';
import { upgradeSnapshot, type Snapshot } from './snapshot';
import { decodeMsg, encodeMsg } from './wire';
import { LatestWriter } from './writer';

/**
 * The record of an online match: the match itself. It lives in the room (`game`: sealed, with the server
 * time of the last write and its number, `n`), and both phones follow it (net/channel.ts): the phone whose
 * turn it is writes it when it fires (so closing the app mid-shot can't undo a move) and again when the
 * shot has played out; the other phone, if it has the match open, plays each shot out from it as it comes
 * and snaps to its result. A phone that opens the match later replays the moves it missed (`moves`).
 *
 * Writes are numbered (`n`) and the database rules refuse one that isn't newer than what's there, so two
 * phones can never overwrite each other's moves: whoever loses a race takes the winner's record.
 *
 * Before the match starts the same slot holds the host's open offer (`OpenRecord`: who's hosting and as
 * which character, `n` 0): whoever joins first starts the match from it, host there or not.
 */

/** A turn nobody takes for this long is forfeited by whoever's turn it is. */
export const FORFEIT_MS = 3 * 24 * 60 * 60_000;

/** A move: the state just before it was fired (and the terrain then), whose it was, and its number in the match. */
export interface ShotRecord {
  turn: number;
  owner: number;
  /** Counts every move fired in the match (`GameRecord.fired`), so a phone knows which it has seen. */
  seq: number;
  snap: Snapshot;
  terrain: string;
}

export interface GameRecord {
  /** The wire version it was written in, and the rules of the build that wrote it (version.ts). */
  v: number;
  rules: number;
  /** Its number (each write is one more than the last: the rules insist), and who wrote it (a session's id). */
  n: number;
  by: string;
  /** The match's setup, including the rules it started on and who went first. */
  setup: MatchSetup;
  /** The match as it stands between shots. */
  snap: Snapshot;
  terrain: string;
  /** How many moves have been fired in the match (each one's `seq`). */
  fired: number;
  /**
   * The moves that led to `snap` since the other player last moved (one player's, in order: a turn, and an
   * extra turn's), replayed for the other player when they open the match.
   */
  moves: ShotRecord[];
  /** A move fired and not yet played out (or its phone went away mid-shot: whoever opens the game plays it out). */
  flying: ShotRecord | null;
}

/** A hosted game nobody has joined yet: the host's pick, and whether it's on the public Games list. */
export interface OpenRecord {
  v: number;
  rules: number;
  open: { host: Pick; listed: boolean; gameName?: string };
}

/** A record as stored: `ts` is the server time of the last write (the last move). */
export interface StoredGame {
  rec: GameRecord;
  ts: number;
}

/** Where a session's records also go (a public match's replay). */
export interface GameStore {
  save(rec: GameRecord): void;
}

/**
 * Writes a room's record, one write at a time, always the newest (a failed write goes with the next save;
 * one the rules refuse, because the other phone's write got there first, is dropped: theirs stands).
 * (The record is sealed as a string of the wire format, inside: how it has always been stored.)
 */
export class RecordStore implements GameStore {
  private readonly writer: LatestWriter<GameRecord>;

  constructor(room: RoomRef) {
    this.writer = new LatestWriter(
      async (rec) => {
        try {
          await putSealed(room.db, `${room.path}/game`, room.sealer, encodeMsg(rec), { n: rec.n });
        } catch (e) {
          if (e instanceof RtdbError && e.denied) return netLog(`record: #${rec.n} refused (the other phone's move got there first)`);
          throw e;
        }
        netLog(`record: saved #${rec.n} (turn ${rec.snap.turn}${rec.flying ? ', a shot in flight' : ''})`);
      },
      { retry: true, failed: (e) => netLog(`record: couldn't save (${errText(e)})`) },
    );
  }

  save(rec: GameRecord): void {
    this.writer.save(rec);
  }
}

/** Put up a hosted game's open offer (before anyone has joined). */
export async function saveOffer(room: RoomRef, offer: OpenRecord['open']): Promise<void> {
  const rec: OpenRecord = { v: WIRE, rules: RULES, open: offer };
  await putSealed(room.db, `${room.path}/game`, room.sealer, encodeMsg(rec), { n: 0 });
}

/** Whatever's in a room's record slot: a match, an open offer, or nothing. */
export async function loadRoomRecord(
  db: Rtdb,
  code: string,
): Promise<{ game: StoredGame } | { offer: OpenRecord['open']; compat: Compat; ts: number } | null> {
  const room = await roomRef(db, code);
  return readRecord(room.sealer, await db.get(`${room.path}/game`));
}

/** A room's record slot as read (or streamed): a match, an open offer, or nothing (or not ours). */
export async function readRecord(sealer: Sealer, raw: unknown): Promise<{ game: StoredGame } | { offer: OpenRecord['open']; compat: Compat; ts: number } | null> {
  const entry = await openSealed<unknown>(sealer, raw).catch(() => null); // (junk: not ours)
  if (!entry || typeof entry.value !== 'string') return null;
  const rec = decodeMsg(entry.value) as GameRecord | OpenRecord;
  if ('open' in rec) return { offer: rec.open, compat: compat(rec.v, rec.rules), ts: entry.ts };
  // (One from an older wire format is never played on: `recordCompat` says it's too old.)
  if (rec.v === WIRE) for (const snap of [rec.snap, rec.flying?.snap, ...rec.moves.map((m) => m.snap)]) if (snap) upgradeSnapshot(snap);
  return { game: { rec, ts: entry.ts } };
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
  return g.rec.setup.players[otherSeat(seat)]?.name ?? 'them';
}

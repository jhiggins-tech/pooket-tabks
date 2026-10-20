import { characterName } from '../characters/roster';
import { seatHere, type SeatEntry } from './channel';
import { gameStatus, loadRoomRecord, opponentName, type GameStatus } from './record';
import { endOfSnapshot, reportMatch } from './results';
import { roomRef } from './rooms';
import type { Rtdb } from './rtdb';
import { bySeat, forgetSeat, loadSeats, seatOf, type Seat } from './seat';

/** This phone's matches (its seats), and how each stands: the Game browser's first rows, the landing screen's dot. */

/** One of this phone's matches, and how it stands. */
export interface MatchSummary {
  seat: Seat;
  status: GameStatus | 'open';
  opponent: string;
  /** Who's playing which character ("tones vs kie"), yours first. */
  detail: string;
  /** The other player has the match open right now. */
  live?: boolean;
}

/**
 * How each of this phone's matches stands (newest first). Matches whose room has gone are forgotten
 * (a finished one is forgotten once this phone has seen how it ended and left it).
 */
export async function matchesOf(db: Rtdb): Promise<MatchSummary[]> {
  const out = await Promise.all(
    loadSeats().map(async (seat): Promise<MatchSummary | null> => {
      try {
        const rec = await loadRoomRecord(db, seat.code);
        if (rec && 'offer' in rec) return { seat, status: 'open', opponent: '…', detail: `${characterName(rec.offer.host.characterId)} · waiting for a player` };
        const stored = rec && 'game' in rec ? rec.game : null;
        if (!stored) {
          const room = await roomRef(db, seat.code);
          if (!(await db.get(`${room.path}/host`))) forgetSeat(seat.code);
          return null;
        }
        const seatNo = seatOf(seat.role);
        const status = gameStatus(stored, seatNo);
        const room = await roomRef(db, seat.code);
        const theirs = await db.get<SeatEntry>(`${room.path}/${seat.role === 'host' ? 'guest' : 'host'}`).catch(() => null);
        // Finished: file this phone's results for the stats (once), even if it's never opened again.
        if (status === 'won' || status === 'lost' || status === 'draw') {
          void reportMatch(db, room.sealer.topic, seatNo, stored.rec.setup, endOfSnapshot(stored.rec.snap));
        }
        const [me, them] = bySeat(stored.rec.setup.players, seatNo);
        const detail = me && them ? `${characterName(me.characterId)} vs ${characterName(them.characterId)} · your match` : 'your match';
        const live = (status === 'your-turn' || status === 'their-turn') && seatHere(theirs);
        return { seat, status, opponent: opponentName(stored, seatNo), detail, ...(live ? { live } : {}) };
      } catch {
        return null; // can't tell right now: leave it be
      }
    }),
  );
  return out.filter((m): m is MatchSummary => m !== null);
}

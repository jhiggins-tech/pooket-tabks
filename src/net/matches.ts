import { characterName } from '../characters/roster';
import { gameStatus, loadRoomRecord, opponentName, type GameStatus } from './record';
import { endOfSnapshot, reportMatch } from './results';
import type { Rtdb } from './rtdb';
import { sealerFor } from './seal';
import { forgetSeat, loadSeats, type Seat } from './seat';

/** This phone's matches (its seats), and how each stands: the Game browser's first rows, the landing screen's dot. */

/** One of this phone's matches, and how it stands. */
export interface MatchSummary {
  seat: Seat;
  status: GameStatus | 'lobby' | 'open';
  opponent: string;
  /** Who's playing which character ("tones vs kie"), yours first. */
  detail: string;
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
          const sealer = await sealerFor('room', seat.code);
          if (!(await db.get(`rooms/${sealer.topic}/host`))) return (forgetSeat(seat.code), null);
          return { seat, status: 'lobby', opponent: '…', detail: 'your match' };
        }
        const seatNo = seat.role === 'host' ? 0 : 1;
        const status = gameStatus(stored, seatNo);
        // Finished: file this phone's results for the stats (once), even if it's never opened again.
        if (status === 'won' || status === 'lost' || status === 'draw') {
          void sealerFor('room', seat.code).then((s) => reportMatch(db, s.topic, seatNo, stored.rec.setup, endOfSnapshot(stored.rec.snap)));
        }
        const [me, them] = seatNo === 0 ? stored.rec.setup.players : [...stored.rec.setup.players].reverse();
        const detail = me && them ? `${characterName(me.characterId)} vs ${characterName(them.characterId)} · your match` : 'your match';
        return { seat, status, opponent: opponentName(stored, seatNo), detail };
      } catch {
        return null; // can't tell right now: leave it be
      }
    }),
  );
  return out.filter((m): m is MatchSummary => m !== null);
}

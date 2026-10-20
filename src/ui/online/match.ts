import { RoomChannel, type MatchChannel } from '../../net/channel';
import type { Listing } from '../../net/lobby';
import { netLog } from '../../net/log';
import { announceDevice, notifySeat } from '../../net/push';
import { ReplayRecorder } from '../../net/replay';
import { endOfGame, reportMatch } from '../../net/results';
import { watchSeat, type RoomRef } from '../../net/rooms';
import { bySeat, forgetSeat, saveSeat, touchSeat, updateSeat, type Seat } from '../../net/seat';
import { NetSession, type Pick } from '../../net/session';
import { Scope } from './scope';

/**
 * One match on this phone, from opening it to leaving it (`OnlineScreen` has at most one, `MatchSlot`):
 * its session and seat, and everything that goes with them while it's on (kept in its own Scope): the
 * seat kept fresh here, standing aside if the player opens it on another phone (`watchSeat`), the replay,
 * who's watching, its place on the Games list, "your turn" notifications and filing the results.
 * `end(how)` is the one way out: what happens to the seat and the session depends on how it ends (ENDS),
 * and everything else stops. DOM-free (the screens follow the session's events).
 */

/** How a match ends on this phone (see ENDS). */
export type MatchEnd =
  /** An update's needed (or it never opened): away, the seat as it is. */
  | 'away'
  /** Back to the menu mid-match: away, the seat marked left (and the moves seen). */
  | 'left'
  /** Back to the menu from a match that's over: away, the seat forgotten. */
  | 'done'
  /** The player opened it on their other phone: stand aside without a word, the seat marked left. */
  | 'stand-down'
  /** The room went (the session has ended): the seat forgotten. */
  | 'lost';

/** For each way a match ends: the seat, and the session. */
const ENDS: Record<MatchEnd, { seat: 'keep' | 'left' | 'left-seen' | 'forget'; session: 'away' | 'stand-down' | null }> = {
  away: { seat: 'keep', session: 'away' },
  left: { seat: 'left-seen', session: 'away' },
  done: { seat: 'forget', session: 'away' },
  'stand-down': { seat: 'left', session: 'stand-down' },
  lost: { seat: 'forget', session: null },
};

/** Going back to the menu (or into another match): how this one ends, by where it is. */
export function leaving(s: NetSession): MatchEnd {
  if (s.ended || !s.game) return 'away';
  return s.game.phase === 'gameover' ? 'done' : 'left';
}

export interface MatchLinkOptions {
  /** Which Games list (a public match's replay is recorded for it). */
  lobby: string;
  /** This phone's pick (a rated match is its player's). */
  pick: () => Pick;
  /** Follow who's watching in the room (ui/online/audience.ts); returns how to stop. */
  audience?: (room: RoomRef) => () => void;
  /** This player has opened the match on another phone, which has taken the seat. */
  taken?: (link: MatchLink) => void;
  /** The match whose results this phone has filed (once per match, whichever link it was in). */
  filed?: { key: string };
  /** A rated match has ended here: against `opponent` (their key), how it went (1 won, 0.5 drew, 0 lost), and how many turns it went. */
  ranked?: (opponent: string, score: 1 | 0.5 | 0, turns: number) => void;
}

/** How often a match being played checks in on its seat here (still playing, and the moves seen). */
const SEAT_EVERY_MS = 20_000;

export class MatchLink {
  readonly session: NetSession;
  readonly seat: Omit<Seat, 'ts'>;
  /** The match's room (null over a pipe that isn't a room's, e.g. in tests). */
  readonly room: RoomRef | null = null;
  /** This phone's game on the Games list (the host's, or a guest's that started it with the host away). */
  listing: Listing | null = null;
  private readonly scope = new Scope();
  /** For "your turn" notifications: the last turn seen (match and turn) and whose it was. */
  private turnSeen: { key: string; current: number; told: boolean } | null = null;

  constructor(
    channel: MatchChannel,
    seat: Omit<Seat, 'ts'>,
    private readonly opts: MatchLinkOptions,
  ) {
    const s = new NetSession(channel, seat.role);
    this.session = s;
    // Remembered as our seat (so this phone can go back to it), and kept fresh while playing.
    this.seat = { code: seat.code, role: seat.role, id: seat.id, listed: seat.listed };
    saveSeat(this.seat);
    const timer = setInterval(() => {
      touchSeat(seat.code);
      if (s.game && !s.replaying) updateSeat(seat.code, { seen: s.seen });
    }, SEAT_EVERY_MS);
    this.scope.onEnd(() => clearInterval(timer));
    s.publicReplay = !!seat.listed;
    if (channel instanceof RoomChannel) {
      const room = channel.room;
      // A public match's replay (the host's game on the Games list), whichever phone moves.
      const replay = new ReplayRecorder(room.db, opts.lobby);
      s.store = replay;
      this.room = room;
      if (opts.audience) this.scope.onEnd(opts.audience(room));
      announceDevice(room, seat.role, seat.id);
      // This player opening the match on another phone: that one plays, this one stands aside.
      const taken = watchSeat(room, seat.role, seat.id, () => opts.taken?.(this));
      this.scope.onEnd(() => taken.close());
    }
  }

  /** Over on this phone (see `end`). */
  get ended(): boolean {
    return !this.scope.alive;
  }

  /** The match is over on this phone, `how` (see ENDS): the seat and the session as it says, and everything else stops. Once. */
  end(how: MatchEnd): void {
    if (this.ended) return;
    netLog(`ui: done with ${this.seat.code} (${how})`);
    const s = this.session;
    const { code } = this.seat;
    const e = ENDS[how];
    if (e.seat === 'forget') forgetSeat(code);
    else if (e.seat === 'left') updateSeat(code, { left: true }); // (no rejoining straight away on a reload here)
    else if (e.seat === 'left-seen') updateSeat(code, { left: true, ...(s.game && !s.replaying ? { seen: s.seen } : {}) });
    if (e.session === 'away') s.away();
    else if (e.session === 'stand-down') s.standDown();
    this.scope.end();
    this.listing?.stop();
    this.listing = null;
    this.turnSeen = null;
  }

  /** Call once a frame: "your turn" notifications, and filing the results once it's over. */
  tick(): void {
    if (this.ended) return;
    this.tellTheirTurn();
    this.fileResults();
  }

  /**
   * The turn has passed from us to them and they're not here: notify them (once a turn; if they only go
   * later in it, then). The host's first turn (the guest has just joined and had theirs): "someone joined".
   */
  private tellTheirTurn(): void {
    const s = this.session;
    const g = s.game;
    if (!g || s.ended || !this.room || g.phase !== 'aiming') return;
    const key = `${this.seat.code}:${g.turn}`;
    if (this.turnSeen?.key !== key) {
      const ours = this.turnSeen?.current === s.localSeat && this.turnSeen.key.startsWith(`${this.seat.code}:`);
      this.turnSeen = { key, current: g.current, told: !ours }; // (only a turn we've just handed over)
    }
    if (this.turnSeen.told || g.current === s.localSeat || !s.peerAway) return;
    this.turnSeen.told = true;
    const joined = !s.isHost && s.matchSetup.first === s.localSeat && g.turn === 2;
    void notifySeat(this.room, s.isHost ? 'guest' : 'host', joined ? 'joined' : 'your-turn');
  }

  /** The match has ended here: file this phone's results for the stats (once per match; net/results.ts). */
  private fileResults(): void {
    const s = this.session;
    const filed = this.opts.filed;
    if (!this.room || !filed || s.game?.phase !== 'gameover') return;
    const key = `${this.room.sealer.topic}:${s.matchSetup.seed}`;
    if (filed.key === key) return;
    filed.key = key;
    void reportMatch(this.room.db, this.room.sealer.topic, s.localSeat, s.matchSetup, endOfGame(s.game));
    // Both players signed in: a rated match (net rank changes and a rank-up are worked out at once).
    const [mine, theirs] = bySeat(s.matchSetup.players, s.localSeat);
    if (mine?.key && theirs?.key && mine.key !== theirs.key && mine.key === this.opts.pick().key) {
      const w = s.game.winner?.id ?? null;
      this.opts.ranked?.(theirs.key, w === null ? 0.5 : w === s.localSeat ? 1 : 0, s.game.turn);
    }
  }
}

/**
 * The one match on this phone (if any). Opening another ends the one before, as if left from the menu
 * (into another match from a notification, say). A match that ended by itself (`lost`) stays, ended, until
 * it's closed: its game is still there to look at.
 */
export class MatchSlot {
  private current: MatchLink | null = null;

  get link(): MatchLink | null {
    return this.current;
  }

  open(channel: MatchChannel, seat: Omit<Seat, 'ts'>, opts: MatchLinkOptions): MatchLink {
    this.close();
    this.current = new MatchLink(channel, seat, opts);
    return this.current;
  }

  /** End the match (`how`, else as if left from the menu) and let it go. */
  close(how?: MatchEnd): void {
    const link = this.current;
    this.current = null;
    link?.end(how ?? leaving(link.session));
  }
}

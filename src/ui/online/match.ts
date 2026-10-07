import type { Listing } from '../../net/lobby';
import { netLog } from '../../net/log';
import { announceDevice, notifySeat } from '../../net/push';
import { RecordStore } from '../../net/record';
import { RelayTransport } from '../../net/relay';
import { ReplayRecorder } from '../../net/replay';
import { endOfGame, reportMatch } from '../../net/results';
import { watchSeat, type RoomRef } from '../../net/rooms';
import { bySeat, forgetSeat, saveSeat, touchSeat, updateSeat, type Seat } from '../../net/seat';
import { NetSession, type Pick } from '../../net/session';
import type { Transport } from '../../net/transport';
import { ViewPublisher } from '../../net/view';
import { Scope } from './scope';

/**
 * One match on this phone, from connecting to leaving it (`OnlineScreen` has at most one, `MatchSlot`):
 * its session and seat, and everything that goes with them while it's on (kept in its own Scope): the
 * seat's check-ins, standing aside if the player opens it on another phone (`watchSeat`), the spectator
 * feed, the record and replay, who's watching, its place on the Games list, "your turn" notifications and
 * filing the results. `end(how)` is the one way out: what happens to the seat and the session depends on
 * how it ends (ENDS), and everything else stops. DOM-free (the screens follow the session's events).
 */

/** How a match ends on this phone (see ENDS). */
export type MatchEnd =
  /** Not caught up yet, or an update's needed: away, the seat as it is. */
  | 'away'
  /** Back to the menu mid-match: away, the seat marked left (and the turn seen). */
  | 'left'
  /** Back to the menu from a match that's over: away, the seat forgotten. */
  | 'done'
  /** Leaving in the lobby, before it started: goodbye (that's the end of the room), the seat forgotten. */
  | 'leave'
  /** The player opened it on their other phone: stand aside without a word, the seat marked left. */
  | 'stand-down'
  /** The other phone left before it started, or the room went (the session has ended): the seat forgotten. */
  | 'lost'
  /** A guest who went quiet in the lobby (a link preview): let the pipe go; the seat and the listing stay (the host waits again). */
  | 'drop';

/** For each way a match ends: the seat, the session, and the Games list entry. */
const ENDS: Record<MatchEnd, { seat: 'keep' | 'left' | 'left-seen' | 'forget'; session: 'away' | 'leave' | 'stand-down' | 'detach' | null; listing: 'stop' | 'keep' }> = {
  away: { seat: 'keep', session: 'away', listing: 'stop' },
  left: { seat: 'left-seen', session: 'away', listing: 'stop' },
  done: { seat: 'forget', session: 'away', listing: 'stop' },
  leave: { seat: 'forget', session: 'leave', listing: 'stop' },
  'stand-down': { seat: 'left', session: 'stand-down', listing: 'stop' },
  lost: { seat: 'forget', session: null, listing: 'stop' },
  drop: { seat: 'keep', session: 'detach', listing: 'keep' },
};

/** Going back to the menu (or into another match): how this one ends, by where it is. */
export function leaving(s: NetSession): MatchEnd {
  if (s.ended || s.isRejoining) return 'away'; // (not caught up yet: the match is still there to go back to)
  if (s.game && s.game.phase !== 'gameover') return 'left';
  if (s.game) return 'done';
  return 'leave';
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
  /** A rated match has ended here: against `opponent` (their key), and how it went (1 won, 0.5 drew, 0 lost). */
  ranked?: (opponent: string, score: 1 | 0.5 | 0) => void;
}

/** How often a match being played checks in on its seat (still playing, and the turn seen). */
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
    private readonly peer: Transport,
    seat: Omit<Seat, 'ts'>,
    private readonly opts: MatchLinkOptions,
  ) {
    const s = new NetSession(peer, seat.role);
    this.session = s;
    // Remembered as our seat (so this phone can rejoin if it drops out), and kept fresh while playing.
    this.seat = { code: seat.code, role: seat.role, id: seat.id, listed: seat.listed };
    saveSeat(this.seat);
    const timer = setInterval(() => {
      touchSeat(seat.code);
      if (s.game?.phase === 'aiming') updateSeat(seat.code, { seen: s.game.turn });
    }, SEAT_EVERY_MS);
    this.scope.onEnd(() => clearInterval(timer));
    if (peer instanceof RelayTransport) {
      // Publish the spectator feed for anyone watching, and keep the match's record.
      const pub = new ViewPublisher(peer.room);
      s.on('view', (v) => pub.push(v));
      // And a public match's replay (the host's game on the Games list; the guest's, if it starts one).
      const record = new RecordStore(peer.room);
      const replay = new ReplayRecorder(peer.room.db, opts.lobby);
      s.store = { save: (rec) => (record.save(rec), replay.save(rec)) };
      s.publicReplay = !!seat.listed;
      this.room = peer.room;
      if (opts.audience) this.scope.onEnd(opts.audience(peer.room));
      announceDevice(peer.room, seat.role, seat.id);
      // This player opening the match on another phone: that one plays, this one stands aside.
      const taken = watchSeat(peer.room, seat.role, seat.id, () => opts.taken?.(this));
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
    else if (e.seat === 'left-seen') updateSeat(code, { left: true, ...(s.game ? { seen: s.game.turn } : {}) });
    if (e.session === 'away') s.away();
    else if (e.session === 'leave') s.leave();
    else if (e.session === 'stand-down') s.standDown();
    else if (e.session === 'detach') this.peer.detach?.();
    this.scope.end();
    if (e.listing === 'stop') this.listing?.stop();
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
   * quiet later in it, then).
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
    void notifySeat(this.room, s.isHost ? 'guest' : 'host', 'your-turn');
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
      this.opts.ranked?.(theirs.key, w === null ? 0.5 : w === s.localSeat ? 1 : 0);
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

  open(peer: Transport, seat: Omit<Seat, 'ts'>, opts: MatchLinkOptions): MatchLink {
    this.close();
    this.current = new MatchLink(peer, seat, opts);
    return this.current;
  }

  /** End the match (`how`, else as if left from the menu) and let it go. */
  close(how?: MatchEnd): void {
    const link = this.current;
    this.current = null;
    link?.end(how ?? leaving(link.session));
  }
}

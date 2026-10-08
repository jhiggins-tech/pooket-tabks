import { getCharacter } from '../characters/roster';
import { roomLink } from '../net/links';
import { netLog } from '../net/log';
import { Listing, lobbySealer, watchCounts, type Advert } from '../net/lobby';
import { RelayTransport } from '../net/relay';
import { HostedRoom, joinRoom, normaliseRoomCode, randomId, rejoinRoom, RoomError, roomHost } from '../net/rooms';
import { Rtdb } from '../net/rtdb';
import { forfeitDue, loadRoomRecord, recordCompat, type OpenRecord, type StoredGame } from '../net/record';
import { findSeat, forgetSeat, saveSeat, updateSeat, type Seat } from '../net/seat';
import { loadReplay, ReplayPlayer, type Replay, type ReplayListing } from '../net/replay';
import type { Sealer } from '../net/seal';
import { brief, NetSession, type Outdated, type Pick } from '../net/session';
import { Spectator } from '../net/spectate';
import { watchRoom } from '../net/view';
import { announceDevice, notifySeat } from '../net/push';
import { checkIn } from '../net/watchers';
import type { Transport } from '../net/transport';
import { button, el } from './dom';
import { loadCharacter, saveCharacter } from './profile';
import { Audience } from './online/audience';
import { gameBrowser } from './online/browser';
import { hostScreen } from './online/hosting';
import { MatchSlot, type MatchEnd, type MatchLink } from './online/match';
import { listPublicly } from './online/prefs';
import { Scope } from './online/scope';
import { chooseTank, type TankUnlocks } from './online/tank';
import type { Rank } from '../stats/ranks';
import { insignia } from './insignia';
import { buttons, cancelButton, heading, linkButton, logsButton, message, status, text } from './online/widgets';

export interface OnlineOptions {
  /** This phone's pick (character and name). */
  pick: () => Pick;
  /** The Firebase Realtime Database rooms go through, or null if it isn't set up. */
  dbUrl: string | null;
  /** Which Games list to use (everyone shares one; tests use their own). */
  lobby: string;
  /** Relay timings (tests shorten them). */
  relay?: { pingMs?: number; lostMs?: number };
  /** Bring this phone's matches up to date from a signed-in player's account (before listing them). */
  syncSeats?: () => Promise<void>;
  /** A player's rank by their stats key (ui/ranks.ts), for the lobby. */
  rankOf?: (key: string | undefined) => Rank | null;
  /**
   * A rated match has ended here (both players signed in): this phone's player against `opponent` (their
   * key), how it went for them (1 won, 0.5 drew, 0 lost), and how many turns it went.
   */
  ranked?: (opponent: string, score: 1 | 0.5 | 0, turns: number) => void;
  /** What's open to this phone's player online, and spending unlock tokens (Choose your tank). */
  unlocks: TankUnlocks;
}

/**
 * Setting up a two-phone match through a room on Firebase: the host gets a 4-letter code and a link, and
 * (unless they make it private) their game goes on the live Games list, where anyone can tap to join it
 * or, once it's under way, to watch. The game's messages go through the room, so any network works.
 * Then both land in a little lobby where the host starts the battle.
 *
 * A match is live while both phones are there and turn by turn when they aren't: either can go back to
 * the menu (the match waits, up to three days a turn), and the Game browser lists this phone's matches to go
 * back to. Leaving in the lobby, before the match starts, ends it.
 *
 * Each way in (the Game browser, hosting, joining, rejoining, watching) is an attempt (`Scope`): starting
 * another, connecting, or leaving ends it, which runs what it registered to stop (streams, check-ins,
 * waiting for a guest); its async steps check `scope.alive` when they come back. Not everything it made
 * goes with it: leaving the host screen leaves the open game in the room (and on the Games list), and a
 * connection lives on as the match: a `MatchLink` (online/match.ts), which owns the session, the seat and
 * all that goes with them until it ends (one at a time: `match`). The screens themselves are in `online/`.
 */
export class OnlineScreen {
  private readonly root = el('div', 'overlay online');
  /** The current attempt (see above). */
  private attempt = new Scope();
  /** The match this phone is in (see online/match.ts). */
  private readonly match = new MatchSlot();
  /** Watching someone else's match, live or a replay (view only). */
  spectator: Spectator | ReplayPlayer | null = null;

  /** A session is connected and both picks can be exchanged. */
  onConnected: (s: NetSession) => void = () => {};
  /** Host pressed Start. */
  onHostStart: (s: NetSession) => void = () => {};
  onClosed: () => void = () => {};
  /** Started watching a match (or a replay): set `onStart` on it to build the game. */
  onSpectate: (sp: Spectator | ReplayPlayer) => void = () => {};

  private readonly pick: () => Pick;
  /** "Waiting for them to come back" while the other phone is away. */
  private readonly away = el('div', 'net-away');
  private awayKey = '';
  /** Who's watching (the 👁 chip and "just started watching"). */
  private readonly audience = new Audience();
  /** The match whose results this phone has filed (so it's done once). */
  private readonly resultsFiled = { key: '' };

  constructor(private readonly opts: OnlineOptions) {
    this.pick = opts.pick;
    this.root.id = 'online';
    this.root.hidden = true;
    this.away.id = 'net-away';
    this.away.hidden = true;
    this.away.setAttribute('role', 'status');
    document.body.append(this.root, this.away);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** The match's session (one that ended by itself stays until the screen's closed: its game is still there to look at). */
  get session(): NetSession | null {
    return this.match.link?.session ?? null;
  }

  /** The replay being watched, if it is one. */
  get replay(): ReplayPlayer | null {
    return this.spectator instanceof ReplayPlayer ? this.spectator : null;
  }

  /** The database matches go through (null: online play isn't set up). */
  get dbUrl(): string | null {
    return this.opts.dbUrl;
  }

  /** The topic of the room of the match this phone is in (a notification's `ref`), if it's in one. */
  get roomTopic(): string | null {
    const link = this.match.link;
    return link && !link.session.ended ? (link.room?.sealer.topic ?? null) : null;
  }

  /**
   * Host a game: a code to type, a link to open, and (unless private) a spot on the Games list. The game
   * stays open after you leave this screen: whoever joins first starts it (turn by turn if you're away).
   */
  host(): void {
    this.reset();
    netLog('ui: Host');
    if (!this.requireDb(PLAY_HERE)) return;
    this.pickTank('Hosting a game', 'Host', () => void this.openRoom());
  }

  /** Choose your tank (remembered: it's your online character from then on, `this.pick()`), then go. */
  private pickTank(note: string, action: string, go: () => void): void {
    chooseTank({
      note,
      action,
      id: loadCharacter() ?? this.pick().characterId,
      unlocks: this.opts.unlocks,
      show: (els) => this.show(els, 'browser'),
      go: (id) => {
        saveCharacter(id);
        go();
      },
      back: () => void this.join(),
    });
  }

  /** Open a room for an open game, as the tank just chosen. */
  private async openRoom(): Promise<void> {
    const db = this.database();
    if (!db) return;
    const scope = this.attempt;
    this.show([heading('Host a game'), status('Opening a room…')]);
    const pick = this.pick();
    const listed = listPublicly();
    const [lobby, opened] = await Promise.all([
      lobbySealer(this.opts.lobby),
      HostedRoom.open(db, { host: pick, listed }).catch((e: unknown) => e as Error),
    ]);
    if (opened instanceof Error) {
      netLog(`ui: couldn't open a room: ${opened.message}`);
      return this.fail(opened, () => void this.openRoom());
    }
    const room = opened;
    if (!scope.alive) return room.cancel(); // gone meanwhile: nobody knows its code yet
    saveSeat({ code: room.code, role: 'host', id: room.id, listed });
    const listing = listingFor(db, lobby, room.id, pick, room.code, { open: true });
    listing.list(listed);
    netLog(`ui: room ${room.code} open${listing.listed ? ', on the Games list' : ' (private)'}`);
    this.hosting(room, listing, pick);
  }

  /** Back to our open game that nobody has joined yet: its host screen again. */
  private async resumeHosting(seat: Seat, offer: OpenRecord['open']): Promise<void> {
    const db = this.database();
    if (!db) return;
    const scope = this.attempt;
    this.show([heading('Host a game'), status('Opening your game…')]);
    let room: HostedRoom;
    try {
      room = await HostedRoom.reclaim(db, seat.code, seat.id);
    } catch (e) {
      return this.fail(e, () => void this.resumeHosting(seat, offer));
    }
    const lobby = await lobbySealer(this.opts.lobby);
    if (!scope.alive) return room.stop(); // gone meanwhile: the game stays open
    saveSeat({ code: seat.code, role: 'host', id: seat.id, listed: offer.listed });
    const listing = listingFor(db, lobby, seat.id, offer.host, seat.code, { open: true });
    listing.list(offer.listed);
    this.hosting(room, listing, offer.host);
  }

  /** The host screen for an open room, waiting for someone to join. */
  private hosting(room: HostedRoom, listing: Listing, pick: Pick): void {
    announceDevice(room.ref, 'host', room.id); // so we hear when someone starts it
    const waiting = (scope: Scope) => {
      // Leaving the screen (not Cancel) leaves the game open.
      const keepOpen = scope.onEnd(() => {
        room.stop();
        listing.leave();
      });
      const render = () =>
        this.show(
          hostScreen(room.code, listing.listed, {
            toggleListed: () => {
              listing.list(!listing.listed);
              listPublicly(listing.listed);
              updateSeat(room.code, { listed: listing.listed });
              void room.offer({ host: pick, listed: listing.listed }).catch(() => {});
              render();
            },
            leave: () => {
              netLog(`ui: left ${room.code} open`);
              updateSeat(room.code, { left: true });
              this.close();
            },
            cancel: () => {
              netLog(`ui: cancelled ${room.code}`);
              keepOpen();
              room.cancel();
              listing.stop();
              forgetSeat(room.code);
              this.close();
            },
          }),
        );
      render();
      void room.waitForGuest(this.opts.relay).then((t) => {
        if (!scope.alive) return t.close(); // gone meanwhile
        keepOpen();
        listing.update({ playing: true, open: false }); // stays listed, for anyone who wants to watch
        room.stop();
        const link = this.startSession(t, { code: room.code, role: 'host', id: room.id, listed: listing.listed });
        link.listing = listing;
        const s = link.session;
        this.trackOpponent(link);
        // Someone who joins and goes quiet before the match starts was probably never there (a link
        // preview in a messaging app): free the seat and wait for a real player.
        s.on('peerAway', (away) => {
          if (!away || s.game || s.ended || this.match.link !== link) return;
          netLog('ui: the guest went quiet in the lobby: freeing the seat');
          this.endMatch('drop'); // (the listing stays: it's the host screen's again)
          listing.update({ playing: false, open: true, opponent: undefined });
          const again = this.attempt;
          // Leaving before it's reopened takes the game off the list.
          const unlist = again.onEnd(() => listing.stop());
          void room.reopen().then(
            () => {
              unlist();
              if (again.alive) return waiting(again);
              room.stop(); // left meanwhile: the game stays open
              listing.leave();
            },
            (e: unknown) => again.alive && this.fail(e, () => void this.host()),
          );
        });
      });
    };
    waiting(this.attempt);
  }

  /** The Game browser (see online/browser.ts). With a code, go straight in. */
  async join(code?: string): Promise<void> {
    const scope = this.reset();
    netLog(`ui: ${code ? `Join ${code}` : 'Game browser'}`);
    const db = this.requireDb(PLAY_HERE);
    if (!db) return;
    const typed = normaliseRoomCode(code ?? '');
    if (typed) return this.joinCode(db, typed);

    this.show([heading('Game browser'), status('Looking for games…')]);
    // (A signed-in player's matches from their other phones first; not waiting long for them.)
    const synced = this.opts.syncSeats ? Promise.race([this.opts.syncSeats(), new Promise((r) => setTimeout(r, 4000))]) : null;
    const [lobby, up] = await Promise.all([lobbySealer(this.opts.lobby), db.reachable(), synced]);
    if (!scope.alive) return;
    if (!up) return this.fail(new Error("Couldn't reach the game server. Is this phone online?"), () => void this.join());
    const browser = gameBrowser(db, lobby, this.opts.lobby, scope, {
      rejoin: (seat) => void this.rejoin(seat),
      join: (c, whose) => this.joinCode(db, c, whose),
      watch: (c) => void this.watch(c),
      replay: (r) => void this.watchReplay(r),
      host: () => this.host(),
      back: () => this.close(),
    });
    this.show(browser, 'browser');
  }

  /** A game picked from the list (or a code typed): our own match is rejoined; anyone else's, pick a tank and join. */
  private joinCode(db: Rtdb, code: string, whose?: string): void {
    const seat = findSeat(code);
    if (seat) return void this.rejoin(seat);
    this.reset();
    this.pickTank(whose ? `Joining ${whose}'s game` : `Joining game ${code}`, 'Join', () => this.enter(db, code));
  }

  /** Join someone's game (or watch it, if it already has two players). */
  private enter(db: Rtdb, code: string): void {
    const scope = this.attempt;
    netLog(`ui: joining room ${code}`);
    this.progress('Game browser', `Joining ${code}…`);
    const id = randomId();
    const room = Promise.all([roomHost(db, code), loadRoomRecord(db, code)]).catch(() => [null, null] as const);
    joinRoom(db, code, this.opts.relay, id).then(
      async (t) => {
        if (!scope.alive) return t.close();
        const link = this.startSession(t, { code, role: 'guest', id });
        const [host, rec] = await room;
        if (host && rec && 'offer' in rec) {
          if (rec.compat === 'newer') return this.outdated('us'); // hosted on a newer version
          this.startIfHostAway(db, link, code, host, rec.offer);
        }
      },
      (e) => {
        if (!scope.alive) return;
        // Already two players: watch instead.
        if (e instanceof RoomError && e.kind === 'full') void this.watch(code);
        else this.fail(e, () => void this.join());
      },
    );
  }

  /**
   * Joined an open game: if its host isn't there (or doesn't say hello soon), start the match ourselves,
   * as the second player; it carries on turn by turn until they're back.
   */
  private startIfHostAway(db: Rtdb, link: MatchLink, code: string, host: { id: string; here: boolean }, offer: OpenRecord['open']): void {
    const s = link.session;
    const go = async () => {
      if (this.match.link !== link || s.game || s.ended || s.remotePick) return;
      netLog(`ui: ${offer.host.name} isn't here: starting the match`);
      s.remotePick = offer.host;
      s.publicReplay = offer.listed;
      this.onHostStart(s);
      s.assumeAway();
      if (link.room) void notifySeat(link.room, 'host', 'joined');
      if (offer.listed && s.localPick) {
        // On the Games list as live now (the host isn't there to say so).
        const lobby = await lobbySealer(this.opts.lobby);
        if (this.match.link !== link || s.ended) return; // left meanwhile: nothing to list
        const listing = listingFor(db, lobby, host.id, offer.host, code, { playing: true, opponent: brief(s.localPick) });
        listing.list(true);
        link.listing = listing;
      }
    };
    if (host.here) setTimeout(() => void go(), JOIN_WAIT_MS);
    else void go();
  }

  /** Keep a count of the public games (waiting for a player, and live) for the landing screen. */
  watchCounts(onCounts: (waiting: number, live: number) => void): () => void {
    const db = this.database();
    return db ? watchCounts(db, this.opts.lobby, onCounts) : () => {};
  }

  /**
   * Opened from an invite link: ask before joining. (Messaging apps open links in a hidden browser to
   * build a preview; joining straight away would let that grab the seat and then vanish.)
   */
  invite(code: string): void {
    this.reset();
    netLog(`ui: invited to ${code}`);
    const seat = findSeat(code);
    if (seat) return void this.rejoin(seat); // our own match
    const go = button('Join game', () => void this.join(code), 'big');
    go.id = 'online-accept';
    this.show([heading('Join a game?'), text(`You've been invited to a Pooket Tabks game (room ${code}).`), go, cancelButton(() => this.close(), 'Not now')]);
  }

  /**
   * Back into one of this phone's matches (dropped out, or left for now): take the seat back and get
   * caught up, by the other phone if it's there, or else from the match's record (their last shot
   * replayed if we haven't seen it).
   */
  async rejoin(seat: Seat): Promise<void> {
    const scope = this.reset();
    netLog(`ui: Rejoin ${seat.code} as ${seat.role}`);
    const db = this.requireDb();
    if (!db) return;
    const waiting = (line: string) => this.progress(`Rejoining ${seat.code}`, line, 'Back');
    waiting('Getting your seat back…');
    let t: RelayTransport;
    let stored: StoredGame | null;
    try {
      const rec = await loadRoomRecord(db, seat.code);
      if (rec && 'offer' in rec && seat.role === 'host') {
        if (!scope.alive) return;
        return void this.resumeHosting(seat, rec.offer); // nobody's joined yet
      }
      stored = rec && 'game' in rec ? rec.game : null;
      const c = stored ? recordCompat(stored.rec) : 'ok';
      if (c !== 'ok') {
        if (!scope.alive) return;
        if (c === 'newer') return this.outdated('us'); // (the seat's kept: it's there after the reload)
        forgetSeat(seat.code);
        return this.fail(new Error(`That match (${seat.code}) was started on an older version of Pooket Tabks, so it can't carry on. Sorry!`));
      }
      t = await rejoinRoom(db, seat.code, seat.role, seat.id, this.opts.relay);
    } catch (e) {
      if (!scope.alive) return;
      const gone = e instanceof RoomError && (e.kind === 'ended' || e.kind === 'seat-taken');
      if (gone) forgetSeat(seat.code);
      return this.fail(e, gone ? undefined : () => void this.rejoin(seat));
    }
    if (!scope.alive) return void t.detach();
    const link = this.setupSession(t, seat);
    const s = link.session;
    if (stored) {
      // Nobody's moved for three days: once we're caught up, whoever's turn it is forfeits.
      s.on('resumed', (inMatch) => {
        if (inMatch && stored && forfeitDue(stored)) s.forfeit();
      });
    }
    if (seat.role === 'host' && seat.listed) {
      // Back on the Games list once we know who's playing.
      const lobby = await lobbySealer(this.opts.lobby);
      s.on('resumed', () => {
        if (this.match.link !== link || !s.localPick) return;
        const listing = listingFor(db, lobby, seat.id, s.localPick, seat.code, { playing: true });
        if (s.remotePick) listing.update({ opponent: brief(s.remotePick) });
        listing.list(true);
        link.listing = listing;
        this.trackOpponent(link);
      });
    }
    waiting(stored ? 'Catching up…' : 'Waiting for the other phone to catch you up…');
    const rec = stored?.rec;
    const replay = !!rec?.last && rec.last.owner !== s.localSeat && (seat.seen ?? 0) < rec.snap.turn;
    s.rejoin(rec ? { rec, replay } : undefined);
  }

  /** The in-match menu: back to the menu (the match waits), nudge them, or resign. */
  matchMenu(): void {
    const s = this.session;
    if (!s?.game || s.ended) return;
    const back = button('Back to menu', () => this.close(), 'big');
    back.id = 'menu-leave';
    let sure = false;
    const resign = button(
      '🏳 Resign',
      () => {
        if (!sure) {
          sure = true;
          resign.textContent = '🏳 Tap again to resign';
          return;
        }
        s.resign();
        this.hide();
      },
      'online-alt',
    );
    resign.id = 'menu-resign';
    const keep = cancelButton(() => this.hide(), 'Keep playing');
    keep.id = 'menu-keep';
    this.show([
      heading('Game menu'),
      text(`The match waits if you go: ${s.remotePick?.name ?? 'they'} can take their turn, and you yours when you're back (it's in the Game browser). Up to three days a turn.`),
      back,
      buttons(this.nudgeButton(), resign, keep),
    ]);
  }

  /** Watch a match in progress, view only. */
  async watch(code: string): Promise<void> {
    const scope = this.reset();
    netLog(`ui: Watch ${code}`);
    const db = this.requireDb();
    if (!db) return;
    this.progress(`Watching ${code}`, 'Tuning in…');
    const sp = new Spectator();
    this.spectator = sp;
    this.onSpectate(sp);
    try {
      const w = await watchRoom(db, code, (v) => sp.receive(v), () => this.watchEnded());
      scope.onEnd(() => w.stop()); // (now, if we've left meanwhile)
      if (scope.alive) {
        // Check in, so the players (and everyone else watching) see who's here.
        const me = randomId();
        scope.onEnd(checkIn(w.room, me, this.pick().name).stop);
        scope.onEnd(this.audience.follow(w.room, me));
      }
      if (scope.alive && !sp.game) this.progress(`Watching ${code}`, 'Waiting for the match to start…', 'Leave');
    } catch (e) {
      if (scope.alive) this.fail(e, () => void this.watch(code));
    }
  }

  /** Watch a past match, from its first shot to how it ended. */
  async watchReplay(listing: ReplayListing): Promise<void> {
    const scope = this.reset();
    const title = listing.players.map((p) => p.name).join(' vs ');
    netLog(`ui: Replay ${listing.id.slice(0, 6)}`);
    const db = this.requireDb();
    if (!db) return;
    this.progress(`Replay: ${title}`, 'Loading the replay…');
    try {
      const replay = await loadReplay(db, listing);
      if (!scope.alive) return;
      if (!replay.shots.length && !replay.end) throw new Error('That replay has gone (they’re kept for two weeks).');
      const player = new ReplayPlayer(replay);
      this.spectator = player;
      this.onSpectate(player); // the game shows once it's built (on its first tick)
    } catch (e) {
      if (scope.alive) this.fail(e, () => void this.watchReplay(listing));
    }
  }

  /** Watch a match this phone just played again, from its own recording (app/tape.ts). */
  watchTape(replay: Replay): void {
    this.reset();
    netLog(`ui: watching the match again (${replay.shots.length} shots)`);
    const player = new ReplayPlayer(replay);
    this.spectator = player;
    this.onSpectate(player); // the game shows once it's built (on its first tick)
  }

  private watchEnded(): void {
    netLog('ui: the watched match ended');
    this.cleanup();
    this.show([heading('The match has ended'), text('The host closed the room.'), cancelButton(() => this.close(), 'Back')]);
  }

  /** The lobby: who's playing as what (tanks were chosen before hosting or joining), and (host) the Start button. */
  lobby(): void {
    const s = this.session;
    if (!s) return;
    const me = s.localPick;
    const them = s.remotePick;
    const line = (label: string, p: Pick | null) => {
      const r = el('div', 'online-seat');
      const who = el('span', undefined, p ? `${p.name} (${getCharacter(p.characterId).name})` : '…');
      const rank = this.opts.rankOf?.(p?.key);
      if (rank) who.append(insignia(rank));
      r.append(el('b', undefined, label), who);
      return r;
    };
    const start = button('Start battle', () => this.onHostStart(s), 'big');
    start.id = 'online-start';
    start.disabled = !s.ready;
    this.show([
      heading('Connected!'),
      line(s.isHost ? 'You (host)' : 'Host', s.isHost ? me : them),
      line(s.isHost ? 'Them' : 'You', s.isHost ? them : me),
      s.isHost ? start : status(them ? 'Waiting for the host to start…' : 'Saying hello…', 'online-status'),
      cancelButton(() => this.close(), 'Leave'),
    ]);
  }

  /** The match is over for good: they left before it started, or the room has gone. */
  lost(): void {
    netLog('ui: connection lost');
    this.match.link?.end('lost'); // (its session stays, ended: the game's still there to look at)
    this.hideAway();
    this.cleanup();
    this.show([heading('Connection lost'), text('The other phone left the match.'), cancelButton(() => this.close(), 'Back')]);
  }

  /**
   * The other phone runs another version of the game. If it's this one that's behind, reload (the site
   * always has the latest, and the match is still there afterwards); if it's theirs, they have to.
   */
  private outdated(who: Outdated): void {
    netLog(`ui: ${who === 'us' ? 'this phone' : 'the other phone'} is on an older version`);
    this.endMatch('away'); // the seat and the room stay as they are
    this.cleanup();
    const reload = button('↻ Reload', () => location.reload(), 'big');
    reload.id = 'online-reload';
    this.show(
      who === 'us'
        ? [heading('Update needed'), text('Pooket Tabks has been updated since this page was loaded. Reload to play: your game will still be there.'), reload, cancelButton(() => this.close(), 'Back')]
        : [heading('The other phone needs an update'), text('Their Pooket Tabks is an older version. Once they reload the page, try again.'), cancelButton(() => this.close(), 'Back')],
    );
  }

  hide(): void {
    this.root.hidden = true;
  }

  /**
   * Leave: go back to setup. A match under way waits for us (turn by turn); one that's over is done with;
   * leaving the lobby ends it.
   */
  close(): void {
    this.endMatch(); // (match/leaving: by where it is)
    this.cleanup();
    this.spectator = null;
    this.hide();
    this.onClosed();
  }

  /** Connected through the room: the attempt has done its job; start the match session and show the lobby. */
  private startSession(peer: Transport, seat: Omit<Seat, 'ts'>): MatchLink {
    netLog(`ui: connected as ${seat.role}`);
    this.attempt.end();
    this.attempt = new Scope();
    const link = this.setupSession(peer, seat);
    link.session.setPick(this.pick());
    return link;
  }

  /**
   * The match on this pipe (a MatchLink: remembered as our seat, so this phone can rejoin if it drops out),
   * ending the one before, if any. The screens follow its session while it's this phone's match.
   */
  private setupSession(peer: Transport, seat: Omit<Seat, 'ts'>): MatchLink {
    if (this.match.link) this.endMatch();
    const link = this.match.open(peer, seat, {
      lobby: this.opts.lobby,
      pick: this.pick,
      audience: (room) => this.audience.follow(room),
      taken: (l) => {
        if (this.match.link === l) this.elsewhere(l);
      },
      filed: this.resultsFiled,
      ranked: this.opts.ranked,
    });
    const s = link.session;
    const here = () => this.match.link === link;
    s.on('lobby', () => here() && this.lobby());
    s.on('lost', () => here() && this.lost());
    s.on('outdated', (who) => here() && this.outdated(who));
    s.on('peerAway', () => here() && this.showAway());
    s.on('resumed', (inMatch) => {
      if (!here()) return;
      netLog(`ui: rejoined ${inMatch ? 'the match' : 'the lobby'}`);
      if (inMatch) return; // the game takes over (onStart)
      if (s.localPick) this.lobby();
      else s.setPick(this.pick());
    });
    this.onConnected(s);
    return link;
  }

  private showAway(): void {
    this.awayKey = '~'; // redraw
    this.tick();
  }

  /** Call once a frame: keeps the "they're not here" line right as turns come and go. */
  tick(): void {
    this.match.link?.tick();
    const s = this.session;
    const g = s?.game;
    const show = !!s && s.peerAway && !s.ended && !!g && g.phase === 'aiming';
    const mine = !!g && g.current === s?.localSeat;
    const key = show ? `${mine}` : '';
    this.away.hidden = !show;
    if (key === this.awayKey || !show) return;
    this.awayKey = key;
    const name = s.remotePick?.name ?? 'The other player';
    this.away.dataset.turn = mine ? 'yours' : 'theirs';
    this.away.replaceChildren(
      el('span', undefined, mine ? `${name} isn't here. Take your turn: they'll see it when they're back.` : `It's ${name}'s turn, and they're not here. The game waits (up to 3 days).`),
      ...(mine ? [] : [this.nudgeButton()]),
      button('Menu', () => this.close()),
    );
  }

  /** Nudge: send them the game's link (the phone's share sheet, or copied). */
  private nudgeButton(): HTMLElement {
    const link = this.match.link;
    const code = link && !link.ended ? link.seat.code : undefined;
    const b = button(
      '📣 Nudge',
      async () => {
        if (!code) return;
        const url = roomLink(code);
        const words = `Your turn in Pooket Tabks! (game ${code})`;
        netLog(`ui: nudge for ${code}`);
        try {
          if (typeof navigator.share === 'function') await navigator.share({ title: 'Pooket Tabks', text: words, url });
          else {
            await navigator.clipboard.writeText(`${words} ${url}`);
            b.textContent = '✓ Link copied: send it';
          }
        } catch {
          b.textContent = url;
        }
      },
      'nudge',
    );
    return b;
  }

  /** Hosting a listed game: show who's playing against us, once they've said hello. */
  private trackOpponent(link: MatchLink): void {
    const s = link.session;
    s.on('lobby', () => {
      if (s.remotePick) link.listing?.update({ opponent: brief(s.remotePick) });
    });
  }

  /** The match on this phone has finished (or a new one started): keeps a listed game's status right. */
  matchFinished(over: boolean): void {
    this.match.link?.listing?.update({ over });
  }

  /**
   * The match has been opened on this player's other phone, which has taken the seat: stop here quietly,
   * and offer to take it back (which makes that one stand aside in turn).
   */
  private elsewhere(link: MatchLink): void {
    if (link.ended) return;
    const { seat } = link;
    netLog('ui: this match was opened on another phone');
    this.endMatch('stand-down'); // (the seat marked left: no rejoining straight away on a reload here)
    this.cleanup();
    const back = button('Play here instead', () => {
      const mine = findSeat(seat.code);
      if (mine) void this.rejoin(mine);
      else this.close();
    }, 'big');
    back.id = 'online-play-here';
    this.show([heading('Playing on another phone'), text(`You've opened this match (${seat.code}) on another phone, so it carries on there.`), back, cancelButton(() => this.close(), 'Back')]);
  }

  /** Done with this phone's match (online/match.ts `MatchLink.end`): `how`, or by default as if left from the menu (`leaving`). */
  private endMatch(how?: MatchEnd): void {
    this.match.close(how);
    this.hideAway();
  }

  private hideAway(): void {
    this.away.hidden = true;
    this.awayKey = '';
  }

  /** The database matches go through (null: online play isn't set up). */
  private database(): Rtdb | null {
    return this.opts.dbUrl ? new Rtdb(this.opts.dbUrl) : null;
  }

  /** The database; or, if online play isn't set up, null, having said so (and `more`). */
  private requireDb(more = ''): Rtdb | null {
    const db = this.database();
    if (!db) this.fail(new Error(`Online play isn't switched on yet.${more}`));
    return db;
  }

  /** Something under way: what it is, how it's going, and a way out (`cancel`: the button's label). */
  private progress(title: string, line: string, cancel?: string): void {
    this.show([heading(title), status(line, 'online-status'), buttons(cancelButton(() => this.close(), cancel))]);
  }

  private fail(e: unknown, retry?: () => void): void {
    netLog(`ui: error shown: ${message(e)}`);
    this.cleanup();
    this.show([heading('Hmm'), text(message(e)), buttons(cancelButton(() => this.close(), 'Back'), ...(retry ? [linkButton('Try again', retry)] : []))]);
  }

  private show(children: HTMLElement[], layout: 'screen' | 'browser' = 'screen'): void {
    this.root.replaceChildren(...children, logsButton());
    this.root.dataset.layout = layout;
    this.root.hidden = false;
  }

  /** A new attempt, from scratch (leaving the match this phone is in, if any, as if from the menu): returns its scope. */
  private reset(): Scope {
    this.endMatch();
    this.cleanup();
    return this.attempt;
  }

  /** End the current attempt and start a fresh one. */
  private cleanup(): void {
    this.attempt.end();
    this.attempt = new Scope();
  }
}

/** Said when online play isn't set up, on the ways in that start a game. */
const PLAY_HERE = ' Play on this phone for now.';

/** This phone's game on the Games list: hosted by `hostId` (playing as `host`) in room `code`, and how it stands. */
function listingFor(db: Rtdb, lobby: Sealer, hostId: string, host: Pick, code: string, state: { open?: boolean; playing?: boolean; opponent?: Advert['opponent'] }): Listing {
  return new Listing(db, lobby, { hostId, ...brief(host), room: code, ...state });
}

/** Joined an open game whose host was here a moment ago: how long to wait for their hello before starting without them. */
const JOIN_WAIT_MS = 6000;

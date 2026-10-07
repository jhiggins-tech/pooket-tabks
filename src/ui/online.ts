import { getCharacter } from '../characters/roster';
import { roomLink } from '../net/links';
import { netLog } from '../net/log';
import { Listing, lobbySealer, watchLobby } from '../net/lobby';
import { RelayTransport } from '../net/relay';
import { HostedRoom, joinRoom, normaliseRoomCode, randomId, rejoinRoom, roomHost, watchSeat } from '../net/rooms';
import { Rtdb } from '../net/rtdb';
import { forfeitDue, loadRoomRecord, RecordStore, recordCompat, type OpenRecord, type StoredGame } from '../net/record';
import { findSeat, forgetSeat, loadSeats, saveSeat, touchSeat, updateSeat, type Seat } from '../net/seat';
import { loadReplay, ReplayPlayer, ReplayRecorder, type Replay, type ReplayListing } from '../net/replay';
import { NetSession, type Outdated, type Pick } from '../net/session';
import { Spectator } from '../net/spectate';
import { ViewPublisher, watchRoom } from '../net/view';
import { announceDevice, notifySeat } from '../net/push';
import { checkIn, type RoomRef } from '../net/watchers';
import type { Transport } from '../net/transport';
import { button, el } from './dom';
import { loadCharacter, saveCharacter } from './profile';
import { Audience } from './online/audience';
import { gameBrowser } from './online/browser';
import { hostScreen } from './online/hosting';
import { listPublicly } from './online/prefs';
import { Scope } from './online/scope';
import { chooseTank } from './online/tank';
import { endOfGame, reportMatch } from '../net/results';
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
   * key), and how it went for them (1 won, 0.5 drew, 0 lost).
   */
  ranked?: (opponent: string, score: 1 | 0.5 | 0) => void;
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
 * connection lives on as the match's session. The screens themselves are in `online/`.
 */
export class OnlineScreen {
  private readonly root = el('div', 'overlay online');
  /** The current attempt (see above). */
  private attempt = new Scope();
  private peer: Transport | null = null;
  /** This phone's game on the Games list while hosting (kept through the match, for spectators). */
  private listing: Listing | null = null;
  session: NetSession | null = null;
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
  private seatTimer: ReturnType<typeof setInterval> | null = null;
  /** The match whose results this phone has filed (so it's done once). */
  private resultsFiled = '';
  /** Stands this phone aside if the player opens the match on another phone (rooms.ts `watchSeat`). */
  private seatWatch: { close: () => void } | null = null;
  /** The seat of the match this phone is in, and its room. */
  private seat: Omit<Seat, 'ts'> | null = null;
  private room: RoomRef | null = null;
  /** For "your turn" notifications: the last turn seen (match and turn) and whose it was. */
  private turnSeen: { key: string; current: number; told: boolean } | null = null;

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
    return this.session && !this.session.lost ? (this.room?.sealer.topic ?? null) : null;
  }

  /**
   * Host a game: a code to type, a link to open, and (unless private) a spot on the Games list. The game
   * stays open after you leave this screen: whoever joins first starts it (turn by turn if you're away).
   */
  host(): void {
    this.reset();
    netLog('ui: Host');
    if (!this.opts.dbUrl) return this.fail(new Error("Online play isn't switched on yet. Play on this phone for now."));
    this.pickTank('Hosting a game', 'Host', () => void this.openRoom());
  }

  /** Choose your tank (remembered: it's your online character from then on, `this.pick()`), then go. */
  private pickTank(note: string, action: string, go: () => void): void {
    chooseTank({
      note,
      action,
      id: loadCharacter() ?? this.pick().characterId,
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
    if (!this.opts.dbUrl) return;
    const scope = this.attempt;
    this.show([heading('Host a game'), status('Opening a room…')]);
    const db = new Rtdb(this.opts.dbUrl);
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
    const listing = new Listing(db, lobby, { hostId: room.id, name: pick.name, characterId: pick.characterId, room: room.code, open: true });
    listing.list(listed);
    netLog(`ui: room ${room.code} open${listing.listed ? ', on the Games list' : ' (private)'}`);
    this.hosting(room, listing, pick);
  }

  /** Back to our open game that nobody has joined yet: its host screen again. */
  private async resumeHosting(seat: Seat, offer: OpenRecord['open']): Promise<void> {
    if (!this.opts.dbUrl) return;
    const scope = this.attempt;
    const db = new Rtdb(this.opts.dbUrl);
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
    const listing = new Listing(db, lobby, { hostId: seat.id, name: offer.host.name, characterId: offer.host.characterId, room: seat.code, open: true });
    listing.list(offer.listed);
    this.hosting(room, listing, offer.host);
  }

  /** The host screen for an open room, waiting for someone to join. */
  private hosting(room: HostedRoom, listing: Listing, pick: Pick): void {
    this.listing = listing;
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
        const s = this.startSession(t, { code: room.code, role: 'host', id: room.id, listed: listing.listed });
        this.trackOpponent(s);
        // Someone who joins and goes quiet before the match starts was probably never there (a link
        // preview in a messaging app): free the seat and wait for a real player.
        s.on('peerAway', (away) => {
          if (!away || s.game || s.lost || this.session !== s) return;
          netLog('ui: the guest went quiet in the lobby: freeing the seat');
          t.detach();
          this.session = null;
          this.peer = null;
          listing.update({ playing: false, open: true, opponent: undefined });
          const again = this.attempt;
          void room.reopen().then(
            () => {
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
    if (!this.opts.dbUrl) return this.fail(new Error("Online play isn't switched on yet. Play on this phone for now."));
    const db = new Rtdb(this.opts.dbUrl);
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
    this.show([heading('Game browser'), status(`Joining ${code}…`, 'online-status'), buttons(cancelButton(() => this.close()))]);
    const id = randomId();
    const room = Promise.all([roomHost(db, code), loadRoomRecord(db, code)]).catch(() => [null, null] as const);
    joinRoom(db, code, this.opts.relay, id).then(
      async (t) => {
        if (!scope.alive) return t.close();
        const s = this.startSession(t, { code, role: 'guest', id });
        const [host, rec] = await room;
        if (host && rec && 'offer' in rec) {
          if (rec.compat === 'newer') return this.outdated('us'); // hosted on a newer version
          this.startIfHostAway(db, s, code, host, rec.offer);
        }
      },
      (e) => {
        if (!scope.alive) return;
        // Already two players: watch instead.
        if (/two players/.test(message(e))) void this.watch(code);
        else this.fail(e, () => void this.join());
      },
    );
  }

  /**
   * Joined an open game: if its host isn't there (or doesn't say hello soon), start the match ourselves,
   * as the second player; it carries on turn by turn until they're back.
   */
  private startIfHostAway(db: Rtdb, s: NetSession, code: string, host: { id: string; here: boolean }, offer: OpenRecord['open']): void {
    const go = async () => {
      if (this.session !== s || s.game || s.lost || s.remotePick) return;
      netLog(`ui: ${offer.host.name} isn't here: starting the match`);
      s.remotePick = offer.host;
      s.publicReplay = offer.listed;
      this.onHostStart(s);
      s.assumeAway();
      if (this.room) void notifySeat(this.room, 'host', 'joined');
      if (offer.listed && s.localPick) {
        // On the Games list as live now (the host isn't there to say so).
        const lobby = await lobbySealer(this.opts.lobby);
        if (this.session !== s || s.lost) return; // left meanwhile: nothing to list
        const listing = new Listing(db, lobby, {
          hostId: host.id,
          name: offer.host.name,
          characterId: offer.host.characterId,
          room: code,
          playing: true,
          opponent: { name: s.localPick.name, characterId: s.localPick.characterId },
        });
        listing.list(true);
        this.listing = listing;
      }
    };
    if (host.here) setTimeout(() => void go(), JOIN_WAIT_MS);
    else void go();
  }

  /** Keep a count of the public games (waiting for a player, and live) for the landing screen. */
  watchCounts(onCounts: (waiting: number, live: number) => void): () => void {
    if (!this.opts.dbUrl) return () => {};
    const db = new Rtdb(this.opts.dbUrl);
    const scope = new Scope();
    void lobbySealer(this.opts.lobby).then((lobby) => {
      scope.onEnd(
        watchLobby(db, lobby, (games) => {
          const mine = new Set(loadSeats().map((x) => x.code));
          const others = games.filter((g) => !mine.has(g.room));
          onCounts(others.filter((g) => !g.playing).length, others.filter((g) => g.playing && !g.over).length);
        }).stop,
      );
    });
    return () => scope.end();
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
    if (!this.opts.dbUrl) return this.fail(new Error("Online play isn't switched on yet."));
    const db = new Rtdb(this.opts.dbUrl);
    const waiting = (line: string) => this.show([heading(`Rejoining ${seat.code}`), status(line, 'online-status'), buttons(cancelButton(() => this.close(), 'Back'))]);
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
      if (/ended|taken/.test(message(e))) forgetSeat(seat.code);
      return this.fail(e, /ended|taken/.test(message(e)) ? undefined : () => void this.rejoin(seat));
    }
    if (!scope.alive) return void t.detach();
    const s = this.setupSession(t, seat);
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
        if (this.session !== s || !s.localPick) return;
        const listing = new Listing(db, lobby, { hostId: seat.id, name: s.localPick.name, characterId: s.localPick.characterId, room: seat.code, playing: true });
        if (s.remotePick) listing.update({ opponent: { name: s.remotePick.name, characterId: s.remotePick.characterId } });
        listing.list(true);
        this.listing = listing;
        this.trackOpponent(s);
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
    if (!s?.game || s.lost) return;
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
    if (!this.opts.dbUrl) return this.fail(new Error("Online play isn't switched on yet."));
    const db = new Rtdb(this.opts.dbUrl);
    this.show([heading(`Watching ${code}`), status('Tuning in…', 'online-status'), buttons(cancelButton(() => this.close()))]);
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
      if (scope.alive && !sp.game) this.show([heading(`Watching ${code}`), status('Waiting for the match to start…', 'online-status'), buttons(cancelButton(() => this.close(), 'Leave'))]);
    } catch (e) {
      if (scope.alive) this.fail(e, () => void this.watch(code));
    }
  }

  /** Watch a past match, from its first shot to how it ended. */
  async watchReplay(listing: ReplayListing): Promise<void> {
    const scope = this.reset();
    const title = listing.players.map((p) => p.name).join(' vs ');
    netLog(`ui: Replay ${listing.id.slice(0, 6)}`);
    if (!this.opts.dbUrl) return this.fail(new Error("Online play isn't switched on yet."));
    this.show([heading(`Replay: ${title}`), status('Loading the replay…', 'online-status'), buttons(cancelButton(() => this.close()))]);
    try {
      const replay = await loadReplay(new Rtdb(this.opts.dbUrl), listing);
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
    if (this.seat) forgetSeat(this.seat.code);
    this.endSeat();
    this.cleanup();
    this.show([heading('Connection lost'), text('The other phone left the match.'), cancelButton(() => this.close(), 'Back')]);
  }

  /**
   * The other phone runs another version of the game. If it's this one that's behind, reload (the site
   * always has the latest, and the match is still there afterwards); if it's theirs, they have to.
   */
  private outdated(who: Outdated): void {
    netLog(`ui: ${who === 'us' ? 'this phone' : 'the other phone'} is on an older version`);
    if (this.session && !this.session.lost) this.session.away(); // the seat and the room stay as they are
    this.endSeat();
    this.cleanup();
    this.session = null;
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
    const s = this.session;
    if (s && this.seat && !s.lost) {
      if (s.isRejoining) {
        s.away(); // not caught up yet: the match is still there to go back to
      } else if (s.game && s.game.phase !== 'gameover') {
        updateSeat(this.seat.code, { left: true, seen: s.game.turn });
        s.away();
      } else if (s.game) {
        forgetSeat(this.seat.code);
        s.away();
      } else {
        forgetSeat(this.seat.code);
        s.leave();
      }
    }
    this.endSeat();
    this.cleanup();
    this.session = null;
    this.spectator = null;
    this.hide();
    this.onClosed();
  }

  /** Connected through the room: the attempt has done its job; start the match session and show the lobby. */
  private startSession(peer: Transport, seat: Omit<Seat, 'ts'>): NetSession {
    netLog(`ui: connected as ${seat.role}`);
    this.attempt.end();
    this.attempt = new Scope();
    const s = this.setupSession(peer, seat);
    s.setPick(this.pick());
    return s;
  }

  /** A session on this pipe, remembered as our seat (so this phone can rejoin if it drops out). */
  private setupSession(peer: Transport, seat: Omit<Seat, 'ts'>): NetSession {
    this.peer = peer;
    const s = new NetSession(peer, seat.role);
    this.session = s;
    this.seat = { code: seat.code, role: seat.role, id: seat.id, listed: seat.listed };
    saveSeat(this.seat);
    if (this.seatTimer) clearInterval(this.seatTimer);
    this.seatTimer = setInterval(() => {
      touchSeat(seat.code);
      if (s.game?.phase === 'aiming') updateSeat(seat.code, { seen: s.game.turn });
    }, 20_000);
    if (peer instanceof RelayTransport) {
      // Publish the spectator feed for anyone watching, and keep the match's record.
      const pub = new ViewPublisher(peer);
      s.on('view', (v) => pub.push(v));
      // And a public match's replay (the host's game on the Games list; the guest's, if it starts one).
      const record = new RecordStore(peer.db, peer.roomPath, peer.sealer);
      const replay = new ReplayRecorder(peer.db, this.opts.lobby);
      s.store = { save: (rec) => (record.save(rec), replay.save(rec)) };
      s.publicReplay = !!seat.listed;
      this.room = { db: peer.db, path: peer.roomPath, sealer: peer.sealer };
      this.audience.follow(this.room);
      announceDevice(this.room, seat.role, seat.id);
      // This player opening the match on another phone: that one plays, this one stands aside.
      const taken = watchSeat(peer.db, peer.roomPath, seat.role, seat.id, () => {
        if (this.session === s) this.elsewhere(s);
      });
      this.seatWatch = taken;
    }
    s.on('lobby', () => this.lobby());
    s.on('lost', () => this.lost());
    s.on('outdated', (who) => this.outdated(who));
    s.on('peerAway', () => this.showAway());
    s.on('resumed', (inMatch) => {
      netLog(`ui: rejoined ${inMatch ? 'the match' : 'the lobby'}`);
      if (inMatch) return; // the game takes over (onStart)
      if (s.localPick) this.lobby();
      else s.setPick(this.pick());
    });
    this.onConnected(s);
    return s;
  }

  private showAway(): void {
    this.awayKey = '~'; // redraw
    this.tick();
  }

  /** Call once a frame: keeps the "they're not here" line right as turns come and go. */
  tick(): void {
    this.tellTheirTurn();
    this.fileResults();
    const s = this.session;
    const g = s?.game;
    const show = !!s && s.peerAway && !s.lost && !!g && g.phase === 'aiming';
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

  /**
   * The turn has passed from us to them and they're not here: notify them (once a turn; if they only go
   * quiet later in it, then).
   */
  private tellTheirTurn(): void {
    const s = this.session;
    const g = s?.game;
    if (!s || !g || s.lost || !this.room || !this.seat || g.phase !== 'aiming') return;
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
    if (!s || !this.room || s.game?.phase !== 'gameover') return;
    const key = `${this.room.sealer.topic}:${s.matchSetup.seed}`;
    if (this.resultsFiled === key) return;
    this.resultsFiled = key;
    void reportMatch(this.room.db, this.room.sealer.topic, s.localSeat, s.matchSetup, endOfGame(s.game));
    // Both players signed in: a rated match (net rank changes and a rank-up are worked out at once).
    const [mine, theirs] = s.localSeat === 0 ? s.matchSetup.players : [...s.matchSetup.players].reverse();
    if (mine?.key && theirs?.key && mine.key !== theirs.key && mine.key === this.pick().key) {
      const w = s.game.winner?.id ?? null;
      this.opts.ranked?.(theirs.key, w === null ? 0.5 : w === s.localSeat ? 1 : 0);
    }
  }

  /** Nudge: send them the game's link (the phone's share sheet, or copied). */
  private nudgeButton(): HTMLElement {
    const code = this.seat?.code;
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
  private trackOpponent(s: NetSession): void {
    s.on('lobby', () => {
      if (s.remotePick) this.listing?.update({ opponent: { name: s.remotePick.name, characterId: s.remotePick.characterId } });
    });
  }

  /** The match on this phone has finished (or a new one started): keeps a listed game's status right. */
  matchFinished(over: boolean): void {
    this.listing?.update({ over });
  }

  /**
   * The match has been opened on this player's other phone, which has taken the seat: stop here quietly,
   * and offer to take it back (which makes that one stand aside in turn).
   */
  private elsewhere(s: NetSession): void {
    const seat = this.seat;
    if (!seat) return;
    netLog('ui: this match was opened on another phone');
    s.standDown();
    updateSeat(seat.code, { left: true }); // (no rejoining straight away on a reload here)
    this.endSeat();
    this.cleanup();
    this.session = null;
    const back = button('Play here instead', () => {
      const mine = findSeat(seat.code);
      if (mine) void this.rejoin(mine);
      else this.close();
    }, 'big');
    back.id = 'online-play-here';
    this.show([heading('Playing on another phone'), text(`You've opened this match (${seat.code}) on another phone, so it carries on there.`), back, cancelButton(() => this.close(), 'Back')]);
  }

  /** Done with this phone's seat for now (what to remember about it is up to the caller). */
  private endSeat(): void {
    this.seatWatch?.close();
    this.seatWatch = null;
    if (this.seatTimer) clearInterval(this.seatTimer);
    this.seatTimer = null;
    this.seat = null;
    this.room = null;
    this.turnSeen = null;
    this.audience.stop();
    this.away.hidden = true;
    this.awayKey = '';
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

  /** A new attempt, from scratch: returns its scope. */
  private reset(): Scope {
    this.cleanup();
    this.session = null;
    return this.attempt;
  }

  /** End the current attempt (and a connection or listing that no match took over) and start a fresh one. */
  private cleanup(): void {
    this.attempt.end();
    this.attempt = new Scope();
    this.listing?.stop();
    this.listing = null;
    if (!this.session) this.peer?.close();
    this.peer = null;
  }
}

/** Joined an open game whose host was here a moment ago: how long to wait for their hello before starting without them. */
const JOIN_WAIT_MS = 6000;

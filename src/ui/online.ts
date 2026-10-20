import { roomLink } from '../net/links';
import { netLog } from '../net/log';
import { Listing, lobbySealer, watchCounts, type Advert } from '../net/lobby';
import { RoomChannel, type MatchChannel } from '../net/channel';
import { HostedRoom, joinRoom, normaliseRoomCode, randomId, rejoinRoom, RoomError, type RoomRef } from '../net/rooms';
import { Rtdb } from '../net/rtdb';
import { forfeitDue, loadRoomRecord, recordCompat, type GameRecord, type OpenRecord } from '../net/record';
import { findSeat, forgetSeat, saveSeat, updateSeat, type Seat } from '../net/seat';
import { loadReplay, ReplayPlayer, type Replay, type ReplayListing } from '../net/replay';
import type { Sealer } from '../net/seal';
import { brief, NetSession, type Outdated, type Pick } from '../net/session';
import { Spectator } from '../net/spectate';
import { watchRoom } from '../net/view';
import { announceDevice } from '../net/push';
import { checkIn } from '../net/watchers';
import { button, el } from './dom';
import { loadCharacter, saveCharacter } from './profile';
import { Audience } from './online/audience';
import { gameBrowser } from './online/browser';
import { hostScreen } from './online/hosting';
import { MatchSlot, type MatchEnd, type MatchLink } from './online/match';
import { listPublicly } from './online/prefs';
import { Scope } from './online/scope';
import { chooseTank, type TankUnlocks } from './online/tank';
import { buttons, cancelButton, heading, linkButton, logsButton, message, status, text } from './online/widgets';

export interface OnlineOptions {
  /** This phone's pick (character and name). */
  pick: () => Pick;
  /** The Firebase Realtime Database rooms go through, or null if it isn't set up. */
  dbUrl: string | null;
  /** Which Games list to use (everyone shares one; tests use their own). */
  lobby: string;
  /** Bring this phone's matches up to date from a signed-in player's account (before listing them). */
  syncSeats?: () => Promise<void>;
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
 * or, once it's under way, to watch. Everything goes through the room, so any network works.
 *
 * A hosted game is open straight away: whoever joins starts the match as they join and has the first go,
 * host there or not (the host hears about it). From then on it's turn by turn: either player can go back
 * to the menu (the match waits, up to three days a turn), and the Game browser lists this phone's matches
 * to go back to. Opening a match replays the other player's moves you missed; with both of you in it, you
 * watch each other's turns as they happen (and a green dot says they're there).
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

  /** A match is being opened on this phone (set `onStart` on its session to build the game). */
  onConnected: (s: NetSession) => void = () => {};
  /** Start the match (the guest does, as it joins): these picks ([host, guest]) as players. */
  startMatch: (s: NetSession, picks: [Pick, Pick]) => void = () => {};
  onClosed: () => void = () => {};
  /** Started watching a match (or a replay): set `onStart` on it to build the game. */
  onSpectate: (sp: Spectator | ReplayPlayer) => void = () => {};

  private readonly pick: () => Pick;
  /** "They're not here" while the other player is away, and "catching up" (with Skip) while their moves replay. */
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
    const gameName = `${pick.name}'s game`;
    const offer = { host: pick, listed, gameName };
    const [lobby, opened] = await Promise.all([
      lobbySealer(this.opts.lobby),
      HostedRoom.open(db, offer).catch((e: unknown) => e as Error),
    ]);
    if (opened instanceof Error) {
      netLog(`ui: couldn't open a room: ${opened.message}`);
      return this.fail(opened, () => void this.openRoom());
    }
    const room = opened;
    if (!scope.alive) return room.cancel(); // gone meanwhile: nobody knows its code yet
    saveSeat({ code: room.code, role: 'host', id: room.id, listed });
    const listing = listingFor(db, lobby, room.id, pick, room.code, { open: true, gameName });
    listing.list(listed);
    netLog(`ui: room ${room.code} open${listing.listed ? ', on the Games list' : ' (private)'}`);
    this.hosting(room, listing, pick, gameName);
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
    const gameName = offer.gameName ?? `${offer.host.name}'s game`;
    const listing = listingFor(db, lobby, seat.id, offer.host, seat.code, { open: true, gameName });
    listing.list(offer.listed);
    this.hosting(room, listing, offer.host, gameName);
  }

  /** The host screen for an open room, waiting for someone to join. */
  private hosting(room: HostedRoom, listing: Listing, pick: Pick, initialGameName: string): void {
    let gameName = initialGameName;
    announceDevice(room.ref, 'host', room.id); // so we hear when someone starts it
    const scope = this.attempt;
    // Leaving the screen (not Cancel) leaves the game open.
    const keepOpen = scope.onEnd(() => {
      room.leave();
      listing.leave();
    });
    const render = () =>
      this.show(
        hostScreen(room.code, listing.listed, gameName, {
          rename: (name) => {
            if (!scope.alive) return;
            gameName = name;
            listing.update({ gameName });
            void room.offer({ host: pick, listed: listing.listed, gameName }).catch((e: unknown) => {
              if (scope.alive) this.fail(e);
            });
          },
          toggleListed: () => {
            listing.list(!listing.listed);
            listPublicly(listing.listed);
            updateSeat(room.code, { listed: listing.listed });
            void room.offer({ host: pick, listed: listing.listed, gameName }).catch((e: unknown) => {
              if (scope.alive) this.fail(e);
            });
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
    // Someone's joined and started the match (they have the first go): into it.
    void room.waitForMatch().then((stored) => {
      if (!scope.alive) return;
      keepOpen();
      const seat = { code: room.code, role: 'host' as const, id: room.id, listed: listing.listed };
      const link = this.openMatch(new RoomChannel(room.ref, 'host'), seat, stored.rec);
      listing.update({ playing: true, open: false, ...(link.session.remotePick ? { opponent: brief(link.session.remotePick) } : {}) }); // stays listed, for anyone who wants to watch
      link.listing = listing;
    });
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

  /** Join someone's game, starting the match (or watch it, if it already has two players). */
  private enter(db: Rtdb, code: string): void {
    const scope = this.attempt;
    netLog(`ui: joining room ${code}`);
    this.progress('Game browser', `Joining ${code}…`);
    const id = randomId();
    joinRoom(db, code, id).then(
      ({ room, offer, compat, hostId }) => {
        if (!scope.alive) return;
        if (compat === 'newer') return this.outdated('us'); // hosted on a newer version
        this.begin(db, room, { code, role: 'guest', id }, offer, hostId);
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
   * Joined an open game: start the match, as the second player, with the first go (the host hears about
   * it once it's their turn). A public game is on the Games list as live from now (in the host's place).
   */
  private begin(db: Rtdb, room: RoomRef, seat: Omit<Seat, 'ts'>, offer: OpenRecord['open'], hostId: string): void {
    netLog(`ui: starting the match against ${offer.host.name}`);
    const link = this.openMatch(new RoomChannel(room, 'guest'), { ...seat, listed: offer.listed });
    const s = link.session;
    this.startMatch(s, [offer.host, this.pick()]);
    if (!offer.listed || !s.localPick) return;
    void lobbySealer(this.opts.lobby).then((lobby) => {
      if (this.match.link !== link || s.ended || !s.localPick) return; // left meanwhile: nothing to list
      const listing = listingFor(db, lobby, hostId, offer.host, seat.code, { playing: true, opponent: brief(s.localPick) });
      listing.list(true);
      link.listing = listing;
    });
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
   * Back into one of this phone's matches (left it for now, or reloaded): take the seat back and open the
   * match from its record, with the other player's moves since this phone last saw it played out again.
   */
  async rejoin(seat: Seat): Promise<void> {
    const scope = this.reset();
    netLog(`ui: Rejoin ${seat.code} as ${seat.role}`);
    const db = this.requireDb();
    if (!db) return;
    this.progress(`Opening ${seat.code}`, 'Getting your seat back…', 'Back');
    let room: RoomRef;
    let rec: GameRecord;
    try {
      const stored = await loadRoomRecord(db, seat.code);
      if (stored && 'offer' in stored) {
        if (!scope.alive) return;
        if (seat.role === 'host') return void this.resumeHosting(seat, stored.offer); // nobody's joined yet
        // Our seat, but the match never got started (this phone went as it joined): start it now.
        room = await rejoinRoom(db, seat.code, 'guest', seat.id);
        const host = await db.get<{ id?: string }>(`${room.path}/host`);
        if (!scope.alive) return;
        return this.begin(db, room, seat, stored.offer, host?.id ?? '');
      }
      if (!stored) throw new RoomError('ended', `That match (${seat.code}) has ended.`);
      rec = stored.game.rec;
      const c = recordCompat(rec);
      if (c !== 'ok') {
        if (!scope.alive) return;
        if (c === 'newer') return this.outdated('us'); // (the seat's kept: it's there after the reload)
        forgetSeat(seat.code);
        return this.fail(new Error(`That match (${seat.code}) was started on an older version of Pooket Tabks, so it can't carry on. Sorry!`));
      }
      room = await rejoinRoom(db, seat.code, seat.role, seat.id);
      if (!scope.alive) return;
      const link = this.openMatch(new RoomChannel(room, seat.role), seat, rec, seat.seen);
      // Nobody's moved for three days: whoever's turn it is forfeits.
      if (forfeitDue(stored.game)) link.session.forfeit();
      if (seat.role === 'host' && seat.listed) {
        // Back on the Games list.
        const lobby = await lobbySealer(this.opts.lobby);
        const s = link.session;
        if (this.match.link !== link || !s.localPick) return;
        const listing = listingFor(db, lobby, seat.id, s.localPick, seat.code, { playing: true, ...(s.remotePick ? { opponent: brief(s.remotePick) } : {}) });
        listing.list(true);
        link.listing = listing;
      }
    } catch (e) {
      if (!scope.alive) return;
      const gone = e instanceof RoomError && (e.kind === 'ended' || e.kind === 'seat-taken');
      if (gone) forgetSeat(seat.code);
      return this.fail(e, gone ? undefined : () => void this.rejoin(seat));
    }
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

  /** The match is over for good: its room has gone. */
  lost(): void {
    netLog('ui: the room has gone');
    this.match.link?.end('lost'); // (its session stays, ended: the game's still there to look at)
    this.hideAway();
    this.cleanup();
    this.show([heading('Match closed'), text('This match’s room has gone.'), cancelButton(() => this.close(), 'Back')]);
  }

  /**
   * The match was last played on a newer version of the game: reload (the site always has the latest,
   * and the match is still there afterwards). ('them': theirs is behind, and they have to.)
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

  /** Leave: go back to setup. A match under way waits for us (turn by turn); one that's over is done with. */
  close(): void {
    this.endMatch(); // (match/leaving: by where it is)
    this.cleanup();
    this.spectator = null;
    this.hide();
    this.onClosed();
  }

  /**
   * Into a match through its room: the attempt has done its job. The match is this phone's (a MatchLink:
   * remembered as our seat, to go back to), ending the one before, if any; the screens follow its session
   * while it's this phone's match. With its record, it's opened from it (`seen`: the newest move this phone
   * has seen; the other player's since are replayed); without, it's about to be started.
   */
  private openMatch(channel: MatchChannel, seat: Omit<Seat, 'ts'>, rec?: GameRecord, seen?: number): MatchLink {
    netLog(`ui: into ${seat.code} as ${seat.role}`);
    this.attempt.end();
    this.attempt = new Scope();
    if (this.match.link) this.endMatch();
    const link = this.match.open(channel, seat, {
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
    s.on('lost', () => here() && this.lost());
    s.on('outdated', (who) => here() && this.outdated(who));
    s.on('peerAway', () => here() && this.showAway());
    this.onConnected(s);
    if (rec) s.open(rec, seen);
    return link;
  }

  private showAway(): void {
    this.awayKey = '~'; // redraw
    this.tick();
  }

  /** Call once a frame: keeps the "they're not here" (or "catching up") line right as turns come and go. */
  tick(): void {
    this.match.link?.tick();
    const s = this.session;
    const g = s?.game;
    const live = !!s && !s.ended && !!g;
    const replaying = live && s.replaying;
    const show = replaying || (live && s.peerAway && g.phase === 'aiming' && !s.awaitingSync);
    const mine = !!g && g.current === s?.localSeat;
    const key = !show ? '' : replaying ? 'replay' : `${mine}`;
    this.away.hidden = !show;
    if (key === this.awayKey || !show) return;
    this.awayKey = key;
    const name = s.remotePick?.name ?? 'The other player';
    this.away.dataset.turn = replaying ? 'replay' : mine ? 'yours' : 'theirs';
    if (replaying) {
      const skip = button('⏭ Skip', () => s.skip());
      skip.id = 'net-skip';
      return this.away.replaceChildren(el('span', undefined, `Catching up: ${name}'s go while you were away.`), skip);
    }
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
function listingFor(
  db: Rtdb,
  lobby: Sealer,
  hostId: string,
  host: Pick,
  code: string,
  state: { open?: boolean; playing?: boolean; gameName?: string; opponent?: Advert['opponent'] },
): Listing {
  return new Listing(db, lobby, { hostId, ...brief(host), room: code, ...state });
}

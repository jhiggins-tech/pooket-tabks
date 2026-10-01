import { getCharacter, ROSTER } from '../characters/roster';
import { roomLink } from '../net/links';
import { netLog, netLogText } from '../net/log';
import { Listing, lobbySealer, watchLobby, type Advert } from '../net/lobby';
import { RelayTransport } from '../net/relay';
import { HostedRoom, joinRoom, normaliseRoomCode, randomId, rejoinRoom, roomHost } from '../net/rooms';
import { Rtdb } from '../net/rtdb';
import { sealerFor } from '../net/seal';
import { characterDetails } from './info';
import { loadCharacter, saveCharacter } from './profile';
import { forfeitDue, gameStatus, loadRoomRecord, opponentName, RecordStore, type GameStatus, type OpenRecord, type StoredGame } from '../net/record';
import { findSeat, forgetSeat, loadSeats, saveSeat, touchSeat, updateSeat, type Seat } from '../net/seat';
import { NetSession, PROTOCOL, type Pick } from '../net/session';
import { Spectator } from '../net/spectate';
import { ViewPublisher, watchRoom } from '../net/view';
import type { Transport } from '../net/transport';

export interface OnlineOptions {
  /** This phone's pick (character and name). */
  pick: () => Pick;
  /** The Firebase Realtime Database rooms go through, or null if it isn't set up. */
  dbUrl: string | null;
  /** Which Games list to use (everyone shares one; tests use their own). */
  lobby: string;
  /** Relay timings (tests shorten them). */
  relay?: { pingMs?: number; lostMs?: number };
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
 */
export class OnlineScreen {
  private readonly root = el('div', 'overlay online');
  private stopRoom: (() => void) | null = null;
  private peer: Transport | null = null;
  /** This phone's game on the Games list while hosting (kept through the match, for spectators). */
  private listing: Listing | null = null;
  session: NetSession | null = null;
  /** Watching someone else's match (view only). */
  spectator: Spectator | null = null;

  /** A session is connected and both picks can be exchanged. */
  onConnected: (s: NetSession) => void = () => {};
  /** Host pressed Start. */
  onHostStart: (s: NetSession) => void = () => {};
  onClosed: () => void = () => {};
  /** Started watching a match: set `onStart` on it to build the game. */
  onSpectate: (sp: Spectator) => void = () => {};

  private readonly pick: () => Pick;
  /** "Waiting for them to come back" while the other phone is away. */
  private readonly away = el('div', 'net-away');
  private awayKey = '';
  private seatTimer: ReturnType<typeof setInterval> | null = null;
  /** The seat of the match this phone is in. */
  private seat: Omit<Seat, 'ts'> | null = null;

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

  /** The database matches go through (null: online play isn't set up). */
  get dbUrl(): string | null {
    return this.opts.dbUrl;
  }

  /**
   * Host a game: a code to type, a link to open, and (unless private) a spot on the Games list. The game
   * stays open after you leave this screen: whoever joins first starts it (turn by turn if you're away).
   */
  host(): void {
    this.reset();
    netLog('ui: Host');
    if (!this.opts.dbUrl) return this.fail(new Error("Online play isn't switched on yet. Play on this phone for now."));
    this.chooseTank('Hosting a game', 'Host', () => void this.openRoom());
  }

  /**
   * Choose your tank for this match (hosting, or joining someone's game): a character, what it does, then
   * go. The choice is remembered (it's your online character from then on: `this.pick()`).
   */
  private chooseTank(note: string, action: string, go: () => void): void {
    let id = loadCharacter() ?? this.pick().characterId;
    const render = () => {
      const c = getCharacter(id);
      const sel = el('select', 'tank-select') as HTMLSelectElement;
      sel.setAttribute('aria-label', 'Your tank');
      for (const r of ROSTER) sel.add(new Option(r.name, r.id, false, r.id === id));
      sel.addEventListener('change', () => {
        id = sel.value;
        render();
      });
      const ok = el('button', 'big', `${action} with ${c.name}`);
      ok.id = 'tank-go';
      ok.addEventListener('click', () => {
        netLog(`ui: ${action} with ${id}`);
        saveCharacter(id);
        go();
      });
      const bar = el('div', 'tank-bar');
      bar.append(el('span', 'online-label', 'Your tank:'), sel, ok);
      const details = el('div', 'tank-details');
      details.append(...characterDetails(c, c.colours[0]!));
      this.show([screenTop('Choose your tank', note, () => void this.join()), bar, details], 'browser');
    };
    render();
  }

  /** Open a room for an open game, as the tank just chosen. */
  private async openRoom(): Promise<void> {
    if (!this.opts.dbUrl) return;
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
    saveSeat({ code: room.code, role: 'host', id: room.id, listed });
    const listing = new Listing(db, lobby, { hostId: room.id, name: pick.name, characterId: pick.characterId, room: room.code, open: true });
    listing.list(listed);
    netLog(`ui: room ${room.code} open${listing.listed ? ', on the Games list' : ' (private)'}`);
    this.hosting(room, listing, pick);
  }

  /** Back to our open game that nobody has joined yet: its host screen again. */
  private async resumeHosting(seat: Seat, offer: OpenRecord['open']): Promise<void> {
    if (!this.opts.dbUrl) return;
    const db = new Rtdb(this.opts.dbUrl);
    this.show([heading('Host a game'), status('Opening your game…')]);
    let room: HostedRoom;
    try {
      room = await HostedRoom.reclaim(db, seat.code, seat.id);
    } catch (e) {
      return this.fail(e, () => void this.resumeHosting(seat, offer));
    }
    saveSeat({ code: seat.code, role: 'host', id: seat.id, listed: offer.listed });
    const listing = new Listing(db, await lobbySealer(this.opts.lobby), {
      hostId: seat.id,
      name: offer.host.name,
      characterId: offer.host.characterId,
      room: seat.code,
      open: true,
    });
    listing.list(offer.listed);
    this.hosting(room, listing, offer.host);
  }

  /** The host screen for an open room, waiting for someone to join. */
  private hosting(room: HostedRoom, listing: Listing, pick: Pick): void {
    this.listing = listing;
    const link = roomLink(room.code);
    const render = () => {
      const big = el('div', 'online-code', room.code);
      big.id = 'online-room-code';
      const toggle = el('button', 'online-listed', listing.listed ? '🌐 Listed in Games' : '🔒 Private') as HTMLButtonElement;
      toggle.id = 'online-listed';
      toggle.setAttribute('aria-pressed', String(listing.listed));
      toggle.addEventListener('click', () => {
        listing.list(!listing.listed);
        listPublicly(listing.listed);
        updateSeat(room.code, { listed: listing.listed });
        void room.offer({ host: pick, listed: listing.listed }).catch(() => {});
        render();
      });
      const leave = el('button', 'online-cancel', 'Back to menu');
      leave.id = 'online-host-leave';
      leave.addEventListener('click', () => {
        netLog(`ui: left ${room.code} open`);
        updateSeat(room.code, { left: true });
        this.close(); // stopRoom keeps it open
      });
      const cancel = el('button', 'online-alt', 'Cancel game');
      cancel.id = 'online-host-cancel';
      cancel.addEventListener('click', () => {
        netLog(`ui: cancelled ${room.code}`);
        this.stopRoom = null;
        room.cancel();
        listing.stop();
        forgetSeat(room.code);
        this.close();
      });
      this.show([
        heading('Host a game'),
        row(
          col(
            heading('Room code', 'h3'),
            big,
            text(
              listing.listed
                ? 'Your game is in the Game browser: anyone can pick it. Or they can type this code.'
                : 'Private: they type this code, or open the link you send them.',
            ),
          ),
          col(heading('Or send them the link', 'h3'), shareRow(link, 'Join my Pooket Tabks game'), toggle),
        ),
        status('Waiting for someone to join… You can go: the first to join starts it, and you take your turn when you’re back.', 'online-status'),
        buttons(leave, cancel),
      ]);
    };
    const waiting = () => {
      // Leaving the screen (not Cancel) leaves the game open.
      this.stopRoom = () => {
        room.stop();
        listing.leave();
      };
      render();
      void room.waitForGuest(this.opts.relay).then((t) => {
        if (this.stopRoom === null) return t.close(); // gone meanwhile
        listing.update({ playing: true, open: false }); // stays listed, for anyone who wants to watch
        room.stop();
        this.stopRoom = null;
        const s = this.startSession(t, { code: room.code, role: 'host', id: room.id, listed: listing.listed });
        this.trackOpponent(s);
        // Someone who joins and goes quiet before the match starts was probably never there (a link
        // preview in a messaging app): free the seat and wait for a real player.
        const onAway = s.onPeerAway;
        s.onPeerAway = (away) => {
          if (!away || s.game || s.lost || this.session !== s) return onAway(away);
          netLog('ui: the guest went quiet in the lobby: freeing the seat');
          t.detach();
          this.session = null;
          this.peer = null;
          listing.update({ playing: false, open: true, opponent: undefined });
          void room.reopen().then(waiting, (e: unknown) => this.fail(e, () => void this.host()));
        };
      });
    };
    waiting();
  }

  /**
   * The Game browser: a table of games (this phone's matches first, then everyone's, waiting for a player,
   * live or finished; updating live), with Host a game and a private game's code to the side. With a code,
   * go straight in.
   */
  async join(code?: string): Promise<void> {
    this.reset();
    netLog(`ui: ${code ? `Join ${code}` : 'Game browser'}`);
    if (!this.opts.dbUrl) return this.fail(new Error("Online play isn't switched on yet. Play on this phone for now."));
    const db = new Rtdb(this.opts.dbUrl);
    let stopWatch = () => {};
    let cancelled = false;
    this.stopRoom = () => {
      cancelled = true;
      stopWatch();
    };
    const joinCode = (c: string, whose?: string) => {
      stopWatch();
      // Our own match: take our seat back rather than watching.
      const seat = findSeat(c);
      if (seat) return void this.rejoin(seat);
      // Someone else's: pick a tank first.
      this.chooseTank(whose ? `Joining ${whose}'s game` : `Joining game ${c}`, 'Join', () => enter(c));
    };
    const enter = (c: string) => {
      netLog(`ui: joining room ${c}`);
      this.show([heading('Game browser'), status(`Joining ${c}…`, 'online-status'), buttons(cancelButton(() => this.close()))]);
      const id = randomId();
      const room = Promise.all([roomHost(db, c), loadRoomRecord(db, c)]).catch(() => [null, null] as const);
      joinRoom(db, c, this.opts.relay, id).then(
        async (t) => {
          if (cancelled) return t.close();
          const s = this.startSession(t, { code: c, role: 'guest', id });
          const [host, rec] = await room;
          if (host && rec && 'offer' in rec) this.startIfHostAway(db, s, c, host, rec.offer);
        },
        (e) => {
          if (cancelled) return;
          // Already two players: watch instead.
          if (/two players/.test(message(e))) void this.watch(c);
          else this.fail(e, () => void this.join());
        },
      );
    };
    const typed = normaliseRoomCode(code ?? '');
    if (typed) return joinCode(typed);

    this.show([heading('Game browser'), status('Looking for games…')]);
    const [lobby, up] = await Promise.all([lobbySealer(this.opts.lobby), db.reachable()]);
    if (cancelled) return;
    if (!up) return this.fail(new Error("Couldn't reach the game server. Is this phone online?"), () => void this.join());

    const table = el('div', 'games-table');
    table.id = 'online-games';
    let mine: MatchSummary[] = [];
    let adverts: Advert[] = [];
    let lastCounts = '';
    const who = (name: string, characterId: string) => `${name} (${getCharacter(characterId).name})`;
    const row = (kind: string, room: string, title: string, detail: string, pill: [string, string], action: [string, string], go: () => void) => {
      const r = el('div', `games-row ${kind}`);
      r.dataset.room = room;
      r.dataset.kind = kind;
      const name = el('span', 'games-name', title);
      name.append(el('small', undefined, detail));
      const b = el('button', `games-go ${action[1]}`, action[0]);
      b.addEventListener('click', go);
      r.append(name, el('span', `pill ${pill[1]}`, pill[0]), b);
      return r;
    };
    const mineLabel: Record<MatchSummary['status'], [string, string]> = {
      'your-turn': ['Your turn', 'mine'],
      'their-turn': ['Their turn', 'done'],
      won: ['You won', 'done'],
      lost: ['You lost', 'done'],
      draw: ['A draw', 'done'],
      old: ['Older version', 'done'],
      lobby: ['Not started', 'done'],
      open: ['Waiting for a player', 'waiting'],
    };
    const render = () => {
      const codes = new Set(mine.map((m) => m.seat.code));
      const others = adverts.filter((g) => !codes.has(g.room));
      const waiting = others.filter((g) => !g.playing);
      const playing = others.filter((g) => g.playing);
      const counts = `${mine.length} yours, ${waiting.length} waiting, ${playing.length} live`;
      if (counts !== lastCounts) netLog(`ui: Game browser shows ${counts}`);
      lastCounts = counts;
      const rows = [
        ...mine.map((m) =>
          row('mine', m.seat.code, m.status === 'open' ? '↩ Your game' : `↩ You vs ${m.opponent}`, m.detail, mineLabel[m.status], m.status === 'your-turn' ? ['Play', 'go'] : ['Open', ''], () =>
            void this.rejoin(m.seat),
          ),
        ),
        ...waiting.map((g) => row('open', g.room, `${g.name}'s game`, getCharacter(g.characterId).name, ['Needs a player', 'waiting'], ['Join', 'go'], () => joinCode(g.room, g.name))),
        ...playing.map((g) =>
          row(
            'live',
            g.room,
            `${g.name} vs ${g.opponent?.name ?? '…'}`,
            g.opponent ? `${getCharacter(g.characterId).name} vs ${getCharacter(g.opponent.characterId).name}` : who(g.name, g.characterId),
            g.over ? ['Finished', 'done'] : ['Live', 'live'],
            ['👁 Watch', ''],
            () => void this.watch(g.room),
          ),
        ),
      ];
      const head = el('div', 'games-head');
      head.append(el('span', undefined, mine.length ? 'Your games, then everyone’s' : 'Games'), el('span', undefined, 'Status'), el('span'));
      table.replaceChildren(
        head,
        ...(rows.length ? rows : [el('p', 'online-none', 'No games right now. Host one, and it shows up here for everyone.')]),
      );
    };
    stopWatch = watchLobby(db, lobby, (games) => {
      adverts = games;
      render();
    }).stop;
    void matchesOf(db).then((m) => {
      if (cancelled) return;
      mine = m;
      render();
    });
    render();

    const host = el('button', 'games-host', '📶 Host a game');
    host.id = 'online-host';
    host.addEventListener('click', () => void this.host());
    const input = el('input', 'online-code-input') as HTMLInputElement;
    input.placeholder = 'CODE';
    input.maxLength = 6;
    input.autocomplete = 'off';
    input.autocapitalize = 'characters';
    input.enterKeyHint = 'go';
    input.setAttribute('aria-label', 'Room code');
    const go = el('button', undefined, 'Join');
    const submit = () => {
      const c = normaliseRoomCode(input.value);
      if (c) joinCode(c);
      else input.focus();
    };
    go.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
    const side = el('div', 'games-side');
    const priv = el('div', 'games-private');
    const label = el('p', undefined);
    label.append(el('b', undefined, 'Private game?'), ' Enter its code:');
    priv.append(label, input, go);
    side.append(host, el('span', 'games-hint', 'Share a code or a link'), priv);
    const body = el('div', 'games-body');
    body.append(table, side);
    this.show([screenTop('Game browser', 'Updates live', () => this.close()), body], 'browser');
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
      this.onHostStart(s);
      s.assumeAway();
      if (offer.listed && s.localPick) {
        // On the Games list as live now (the host isn't there to say so).
        const listing = new Listing(db, await lobbySealer(this.opts.lobby), {
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
    let stop: (() => void) | null = null;
    let stopped = false;
    void lobbySealer(this.opts.lobby).then((lobby) => {
      if (stopped) return;
      stop = watchLobby(db, lobby, (games) => {
        const mine = new Set(loadSeats().map((x) => x.code));
        const others = games.filter((g) => !mine.has(g.room));
        onCounts(others.filter((g) => !g.playing).length, others.filter((g) => g.playing && !g.over).length);
      }).stop;
    });
    return () => {
      stopped = true;
      stop?.();
    };
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
    const go = el('button', 'big', 'Join game');
    go.id = 'online-accept';
    go.addEventListener('click', () => void this.join(code));
    this.show([heading('Join a game?'), text(`You've been invited to a Pooket Tabks game (room ${code}).`), go, cancelButton(() => this.close(), 'Not now')]);
  }

  /**
   * Back into one of this phone's matches (dropped out, or left for now): take the seat back and get
   * caught up, by the other phone if it's there, or else from the match's record (their last shot
   * replayed if we haven't seen it).
   */
  async rejoin(seat: Seat): Promise<void> {
    this.reset();
    netLog(`ui: Rejoin ${seat.code} as ${seat.role}`);
    if (!this.opts.dbUrl) return this.fail(new Error("Online play isn't switched on yet."));
    const db = new Rtdb(this.opts.dbUrl);
    let cancelled = false;
    this.stopRoom = () => (cancelled = true);
    const waiting = (line: string) =>
      this.show([
        heading(`Rejoining ${seat.code}`),
        status(line, 'online-status'),
        buttons(cancelButton(() => this.close(), 'Back')),
      ]);
    waiting('Getting your seat back…');
    let t: RelayTransport;
    let stored: StoredGame | null;
    try {
      const rec = await loadRoomRecord(db, seat.code);
      if (rec && 'offer' in rec && seat.role === 'host') {
        if (cancelled) return;
        this.stopRoom = null;
        return void this.resumeHosting(seat, rec.offer); // nobody's joined yet
      }
      stored = rec && 'game' in rec ? rec.game : null;
      t = await rejoinRoom(db, seat.code, seat.role, seat.id, this.opts.relay);
    } catch (e) {
      if (cancelled) return;
      if (/ended|taken/.test(message(e))) forgetSeat(seat.code);
      return this.fail(e, /ended|taken/.test(message(e)) ? undefined : () => void this.rejoin(seat));
    }
    if (cancelled) return void t.detach();
    this.stopRoom = null;
    if (stored && stored.rec.v !== PROTOCOL) {
      t.detach();
      forgetSeat(seat.code);
      return this.fail(new Error(`That match (${seat.code}) was started on an older version of Pooket Tabks, so it can't carry on. Sorry!`));
    }
    const s = this.setupSession(t, seat);
    if (stored) {
      // Nobody's moved for three days: once we're caught up, whoever's turn it is forfeits.
      const onResumed = s.onResumed;
      s.onResumed = (inMatch) => {
        onResumed(inMatch);
        if (inMatch && stored && forfeitDue(stored)) s.forfeit();
      };
    }
    if (seat.role === 'host' && seat.listed) {
      // Back on the Games list once we know who's playing.
      const lobby = await lobbySealer(this.opts.lobby);
      const onResumed = s.onResumed;
      s.onResumed = (inMatch) => {
        if (this.session === s && s.localPick) {
          const listing = new Listing(db, lobby, { hostId: seat.id, name: s.localPick.name, characterId: s.localPick.characterId, room: seat.code, playing: true });
          if (s.remotePick) listing.update({ opponent: { name: s.remotePick.name, characterId: s.remotePick.characterId } });
          listing.list(true);
          this.listing = listing;
          this.trackOpponent(s);
        }
        onResumed(inMatch);
      };
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
    const back = el('button', 'big', 'Back to menu');
    back.id = 'menu-leave';
    back.addEventListener('click', () => this.close());
    const resign = el('button', 'online-alt', '🏳 Resign');
    resign.id = 'menu-resign';
    let sure = false;
    resign.addEventListener('click', () => {
      if (!sure) {
        sure = true;
        resign.textContent = '🏳 Tap again to resign';
        return;
      }
      s.resign();
      this.hide();
    });
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
    this.reset();
    netLog(`ui: Watch ${code}`);
    if (!this.opts.dbUrl) return this.fail(new Error("Online play isn't switched on yet."));
    const db = new Rtdb(this.opts.dbUrl);
    this.show([heading(`Watching ${code}`), status('Tuning in…', 'online-status'), buttons(cancelButton(() => this.close()))]);
    const sp = new Spectator();
    this.spectator = sp;
    this.onSpectate(sp);
    try {
      const w = await watchRoom(db, code, (v) => sp.receive(v), () => this.watchEnded());
      if (this.spectator !== sp) return w.stop();
      this.stopRoom = () => w.stop();
      if (!sp.game) this.show([heading(`Watching ${code}`), status("Waiting for the match to start…", 'online-status'), buttons(cancelButton(() => this.close(), 'Leave'))]);
    } catch (e) {
      this.fail(e, () => void this.watch(code));
    }
  }

  private watchEnded(): void {
    netLog('ui: the watched match ended');
    this.cleanup();
    this.show([heading('The match has ended'), text('The host closed the room.'), cancelButton(() => this.close(), 'Back')]);
  }

  /** The lobby: both picks, and (host) the Start button. */
  lobby(): void {
    const s = this.session;
    if (!s) return;
    const me = s.localPick;
    const them = s.remotePick;
    const line = (label: string, p: Pick | null, mine: boolean) => {
      const r = el('div', 'online-seat');
      r.append(el('b', undefined, label));
      if (mine && p) {
        // You can still change character here.
        const sel = el('select') as HTMLSelectElement;
        sel.setAttribute('aria-label', 'Your character');
        for (const c of ROSTER) sel.add(new Option(c.name, c.id, false, c.id === p.characterId));
        sel.addEventListener('change', () => {
          saveCharacter(sel.value); // your character online from now on
          s.setPick({ name: p.name, characterId: sel.value });
        });
        r.append(el('span', undefined, p.name), sel);
      } else {
        r.append(el('span', undefined, p ? `${p.name} (${getCharacter(p.characterId).name})` : '…'));
      }
      return r;
    };
    const start = el('button', 'big', 'Start battle') as HTMLButtonElement;
    start.id = 'online-start';
    start.disabled = !s.ready;
    start.addEventListener('click', () => this.onHostStart(s));
    this.show([
      heading('Connected!'),
      line(s.isHost ? 'You (host)' : 'Host', s.isHost ? me : them, s.isHost),
      line(s.isHost ? 'Them' : 'You', s.isHost ? them : me, !s.isHost),
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

  /** Connected through the room: start the match session and show the lobby. */
  private startSession(peer: Transport, seat: Omit<Seat, 'ts'>): NetSession {
    netLog(`ui: connected as ${seat.role}`);
    this.stopRoom?.();
    this.stopRoom = null;
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
      s.onView = (v) => pub.push(v);
      s.store = new RecordStore(peer.db, peer.roomPath, peer.sealer);
    }
    s.onLobby = () => this.lobby();
    s.onLost = () => this.lost();
    s.onPeerAway = () => this.showAway();
    s.onResumed = (inMatch) => {
      netLog(`ui: rejoined ${inMatch ? 'the match' : 'the lobby'}`);
      if (inMatch) return; // the game takes over (onStart)
      if (s.localPick) this.lobby();
      else s.setPick(this.pick());
    };
    this.onConnected(s);
    return s;
  }

  private showAway(): void {
    this.awayKey = '~'; // redraw
    this.tick();
  }

  /** Call once a frame: keeps the "they're not here" line right as turns come and go. */
  tick(): void {
    const s = this.session;
    const g = s?.game;
    const show = !!s && s.peerAway && !s.lost && !!g && g.phase === 'aiming';
    const mine = !!g && g.current === s?.localSeat;
    const key = show ? `${mine}` : '';
    this.away.hidden = !show;
    if (key === this.awayKey || !show) return;
    this.awayKey = key;
    const name = s.remotePick?.name ?? 'The other player';
    const menu = el('button', undefined, 'Menu');
    menu.addEventListener('click', () => this.close());
    this.away.dataset.turn = mine ? 'yours' : 'theirs';
    this.away.replaceChildren(
      el('span', undefined, mine ? `${name} isn't here. Take your turn: they'll see it when they're back.` : `It's ${name}'s turn, and they're not here. The game waits (up to 3 days).`),
      ...(mine ? [] : [this.nudgeButton()]),
      menu,
    );
  }

  /** Nudge: send them the game's link (the phone's share sheet, or copied). */
  private nudgeButton(): HTMLElement {
    const b = el('button', 'nudge', '📣 Nudge');
    const code = this.seat?.code;
    b.addEventListener('click', async () => {
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
    });
    return b;
  }

  /** Hosting a listed game: show who's playing against us, once they've said hello. */
  private trackOpponent(s: NetSession): void {
    const onLobby = s.onLobby;
    s.onLobby = () => {
      if (s.remotePick) this.listing?.update({ opponent: { name: s.remotePick.name, characterId: s.remotePick.characterId } });
      onLobby();
    };
  }

  /** The match on this phone has finished (or a new one started): keeps a listed game's status right. */
  matchFinished(over: boolean): void {
    this.listing?.update({ over });
  }

  /** Done with this phone's seat for now (what to remember about it is up to the caller). */
  private endSeat(): void {
    if (this.seatTimer) clearInterval(this.seatTimer);
    this.seatTimer = null;
    this.seat = null;
    this.away.hidden = true;
    this.awayKey = '';
  }

  private fail(e: unknown, retry?: () => void): void {
    netLog(`ui: error shown: ${message(e)}`);
    this.cleanup();
    this.show([
      heading('Hmm'),
      text(message(e)),
      buttons(cancelButton(() => this.close(), 'Back'), ...(retry ? [linkButton('Try again', retry)] : [])),
    ]);
  }

  private show(children: HTMLElement[], layout: 'screen' | 'browser' = 'screen'): void {
    this.root.replaceChildren(...children, logsButton());
    this.root.dataset.layout = layout;
    this.root.hidden = false;
  }

  private reset(): void {
    this.cleanup();
    this.session = null;
  }

  private cleanup(): void {
    this.stopRoom?.();
    this.stopRoom = null;
    this.listing?.stop();
    this.listing = null;
    if (!this.session) this.peer?.close();
    this.peer = null;
  }
}

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
        if (rec && 'offer' in rec) return { seat, status: 'open', opponent: '…', detail: `${charName(rec.offer.host.characterId)} · waiting for a player` };
        const stored = rec && 'game' in rec ? rec.game : null;
        if (!stored) {
          const sealer = await sealerFor('room', seat.code);
          if (!(await db.get(`rooms/${sealer.topic}/host`))) return (forgetSeat(seat.code), null);
          return { seat, status: 'lobby', opponent: '…', detail: 'your match' };
        }
        const seatNo = seat.role === 'host' ? 0 : 1;
        const [me, them] = seatNo === 0 ? stored.rec.setup.players : [...stored.rec.setup.players].reverse();
        const detail = me && them ? `${charName(me.characterId)} vs ${charName(them.characterId)} · your match` : 'your match';
        return { seat, status: gameStatus(stored, seatNo, PROTOCOL), opponent: opponentName(stored, seatNo), detail };
      } catch {
        return null; // can't tell right now: leave it be
      }
    }),
  );
  return out.filter((m): m is MatchSummary => m !== null);
}

/** Joined an open game whose host was here a moment ago: how long to wait for their hello before starting without them. */
const JOIN_WAIT_MS = 6000;

const LISTED_KEY = 'pooket.listPublicly';

/** Whether to put hosted games on the public Games list (remembered; yes unless the player said no). */
function listPublicly(set?: boolean): boolean {
  try {
    if (set !== undefined) localStorage.setItem(LISTED_KEY, set ? 'yes' : 'no');
    return localStorage.getItem(LISTED_KEY) !== 'no';
  } catch {
    return set ?? true;
  }
}

function charName(id: string): string {
  try {
    return getCharacter(id).name;
  } catch {
    return id;
  }
}

/** A screen's header: Back, the title, a note on the right. */
function screenTop(title: string, note: string, back: () => void): HTMLElement {
  const r = el('div', 'screen-top');
  const b = el('button', 'back', '‹ Back');
  b.addEventListener('click', back);
  r.append(b, el('h2', undefined, title), el('span', 'screen-note', note));
  return r;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function el(tag: string, className?: string, textContent?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (textContent !== undefined) e.textContent = textContent;
  return e;
}

function heading(t: string, tag = 'h2'): HTMLElement {
  return el(tag, undefined, t);
}

function text(t: string): HTMLElement {
  return el('p', undefined, t);
}

function status(t: string, cls = ''): HTMLElement {
  return el('p', `online-status-line ${cls}`.trim(), t);
}

function row(...cols: HTMLElement[]): HTMLElement {
  const r = el('div', 'online-row');
  r.append(...cols);
  return r;
}

function col(...children: HTMLElement[]): HTMLElement {
  const c = el('div', 'online-col');
  c.append(...children);
  return c;
}

/** Copy the network log (to paste into a bug report); shows it to select by hand if copying isn't allowed. */
function logsButton(): HTMLElement {
  const b = el('button', 'online-logs', '📋 Copy logs');
  b.id = 'online-logs';
  b.addEventListener('click', async () => {
    const text = netLogText();
    try {
      await navigator.clipboard.writeText(text);
      b.textContent = '✓ Logs copied';
    } catch {
      const area = document.createElement('textarea');
      area.className = 'online-logs-text';
      area.readOnly = true;
      area.value = text;
      b.replaceWith(area);
      area.focus();
      area.select();
    }
  });
  return b;
}

function buttons(...bs: HTMLElement[]): HTMLElement {
  const r = el('div', 'online-buttons');
  r.append(...bs);
  return r;
}

function linkButton(label: string, onClick: () => void): HTMLElement {
  const b = el('button', 'online-alt', label);
  b.addEventListener('click', onClick);
  return b;
}

function cancelButton(onClick: () => void, label = 'Cancel'): HTMLElement {
  const b = el('button', 'online-cancel', label);
  b.addEventListener('click', onClick);
  return b;
}

/** The link as selectable text, with Copy (and Share where the phone supports it). */
function shareRow(link: string, title: string, share = true): HTMLElement {
  const r = el('div', 'online-share');
  const input = el('input', 'online-link') as HTMLInputElement;
  input.readOnly = true;
  input.value = link;
  input.addEventListener('focus', () => input.select());
  const copy = el('button', undefined, 'Copy');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(link);
      copy.textContent = 'Copied!';
    } catch {
      input.select();
    }
  });
  r.append(input, copy);
  if (share && typeof navigator.share === 'function') {
    const s = el('button', undefined, 'Share');
    s.addEventListener('click', () => void navigator.share({ title, url: link }).catch(() => {}));
    r.append(s);
  }
  return r;
}

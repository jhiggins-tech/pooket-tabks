import { getCharacter, ROSTER } from '../characters/roster';
import { roomLink } from '../net/links';
import { netLog, netLogText } from '../net/log';
import { Listing, lobbySealer, watchLobby, type Advert } from '../net/lobby';
import { RelayTransport } from '../net/relay';
import { HostedRoom, joinRoom, normaliseRoomCode, randomId, rejoinRoom } from '../net/rooms';
import { Rtdb } from '../net/rtdb';
import { clearSeat, loadSeat, saveSeat, touchSeat, type Seat } from '../net/seat';
import { NetSession, type Pick } from '../net/session';
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
  private seatTimer: ReturnType<typeof setInterval> | null = null;

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

  /** Host a room: a code to type, a link to open, and (unless private) a spot on the Games list. */
  async host(): Promise<void> {
    this.reset();
    netLog('ui: Host');
    if (!this.opts.dbUrl) return this.fail(new Error("Online play isn't switched on yet. Play on this phone for now."));
    this.show([heading('Host a game'), status('Opening a room…')]);
    const db = new Rtdb(this.opts.dbUrl);
    const [lobby, opened] = await Promise.all([lobbySealer(this.opts.lobby), HostedRoom.open(db).catch((e: unknown) => e as Error)]);
    if (opened instanceof Error) {
      netLog(`ui: couldn't open a room: ${opened.message}`);
      return this.fail(opened, () => void this.host());
    }
    const room = opened;
    const pick = this.pick();
    const listing = new Listing(db, lobby, { hostId: room.id, name: pick.name, characterId: pick.characterId, room: room.code });
    listing.list(listPublicly());
    this.listing = listing;
    netLog(`ui: room ${room.code} open${listing.listed ? ', on the Games list' : ' (private)'}`);
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
        render();
      });
      this.show([
        heading('Host a game'),
        row(
          col(
            heading('Room code', 'h3'),
            big,
            text(
              listing.listed
                ? 'Your game is in the Games list: on the other phone tap Join and pick it. Or type this code.'
                : 'Private: on the other phone tap Join and type this code, or send them the link.',
            ),
          ),
          col(heading('Or send them the link', 'h3'), shareRow(link, 'Join my Pooket Tabks game'), toggle),
        ),
        status('Waiting for someone to join…', 'online-status'),
        buttons(cancelButton(() => this.close())),
      ]);
    };
    const waiting = () => {
      this.stopRoom = () => room.cancel();
      render();
      void room.waitForGuest(this.opts.relay).then((t) => {
        if (this.stopRoom === null) return t.close(); // cancelled meanwhile
        listing.update({ playing: true }); // stays listed, for anyone who wants to watch
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
          clearSeat();
          listing.update({ playing: false, opponent: undefined });
          void room.reopen().then(waiting, (e: unknown) => this.fail(e, () => void this.host()));
        };
      });
    };
    waiting();
  }

  /** Join: the live Games list (tap to join or watch), or type a room code. With a code, go straight in. */
  async join(code?: string): Promise<void> {
    this.reset();
    netLog(`ui: Join${code ? ` ${code}` : ''}`);
    if (!this.opts.dbUrl) return this.fail(new Error("Online play isn't switched on yet. Play on this phone for now."));
    const db = new Rtdb(this.opts.dbUrl);
    let stopWatch = () => {};
    let cancelled = false;
    this.stopRoom = () => {
      cancelled = true;
      stopWatch();
    };
    const joinCode = (c: string) => {
      stopWatch();
      // Our own match, that we dropped out of: take our seat back rather than watching.
      const seat = loadSeat();
      if (seat?.code === c) return void this.rejoin(seat);
      netLog(`ui: joining room ${c}`);
      this.show([heading('Games'), status(`Joining ${c}…`, 'online-status'), buttons(cancelButton(() => this.close()))]);
      const id = randomId();
      joinRoom(db, c, this.opts.relay, id).then(
        (t) => (cancelled ? t.close() : this.startSession(t, { code: c, role: 'guest', id })),
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

    this.show([heading('Games'), status('Looking for games…')]);
    const [lobby, up] = await Promise.all([lobbySealer(this.opts.lobby), db.reachable()]);
    if (cancelled) return;
    if (!up) return this.fail(new Error("Couldn't reach the game server. Is this phone online?"), () => void this.join());
    const open = el('div', 'online-games');
    open.id = 'online-open';
    const live = el('div', 'online-games');
    live.id = 'online-live';
    let lastCounts = '';
    const game = (g: Advert, label: string, detail: string, go: () => void) => {
      const b = el('button', 'online-game', label);
      b.dataset.room = g.room;
      b.append(el('small', undefined, ` ${detail}`));
      b.addEventListener('click', go);
      return b;
    };
    const render = (games: Advert[]) => {
      const mine = loadSeat()?.code;
      const waiting = games.filter((g) => !g.playing);
      const playing = games.filter((g) => g.playing);
      const counts = `${waiting.length} waiting, ${playing.length} live`;
      if (counts !== lastCounts) netLog(`ui: Games list shows ${counts}`);
      lastCounts = counts;
      const who = (name: string, characterId: string) => `${name} (${getCharacter(characterId).name})`;
      open.replaceChildren(
        ...(waiting.length
          ? waiting.map((g) =>
              g.room === mine
                ? game(g, `↩ ${g.name}'s game`, 'your match · rejoin', () => joinCode(g.room))
                : game(g, g.name, `${getCharacter(g.characterId).name} · tap to join`, () => joinCode(g.room)),
            )
          : [el('p', 'online-none', "No one's waiting. Tap Host to start a game.")]),
      );
      live.replaceChildren(
        ...(playing.length
          ? playing.map((g) =>
              g.room === mine
                ? game(g, `↩ ${g.name}'s game`, 'your match · rejoin', () => joinCode(g.room))
                : game(
                    g,
                    `👁 ${who(g.name, g.characterId)} vs ${g.opponent ? who(g.opponent.name, g.opponent.characterId) : '…'}`,
                    g.over ? 'finished · watch' : 'playing · watch',
                    () => void this.watch(g.room),
                  ),
            )
          : [el('p', 'online-none', 'No games on right now.')]),
      );
    };
    stopWatch = watchLobby(db, lobby, render).stop;
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
    const codeRow = el('div', 'online-paste');
    codeRow.append(input, go);
    this.show([
      heading('Games'),
      lists(col(heading('Waiting for a player', 'h3'), open), col(heading('Live now', 'h3'), live)),
      row(el('span', 'online-label', 'Private game? Type its code:'), codeRow),
      buttons(cancelButton(() => this.close())),
    ]);
  }

  /**
   * Opened from an invite link: ask before joining. (Messaging apps open links in a hidden browser to
   * build a preview; joining straight away would let that grab the seat and then vanish.)
   */
  invite(code: string): void {
    this.reset();
    netLog(`ui: invited to ${code}`);
    const seat = loadSeat();
    if (seat?.code === code) return void this.rejoin(seat); // our own match
    const go = el('button', 'big', 'Join game');
    go.id = 'online-accept';
    go.addEventListener('click', () => void this.join(code));
    this.show([heading('Join a game?'), text(`You've been invited to a Pooket Tabks game (room ${code}).`), go, cancelButton(() => this.close(), 'Not now')]);
  }

  /** Back into a match this phone dropped out of: take the seat back and get caught up. */
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
        buttons(
          cancelButton(() => {
            clearSeat();
            this.close();
          }, 'Leave match'),
        ),
      ]);
    waiting('Getting your seat back…');
    let t: RelayTransport;
    try {
      t = await rejoinRoom(db, seat.code, seat.role, seat.id, this.opts.relay);
    } catch (e) {
      if (cancelled) return;
      if (/ended|taken/.test(message(e))) clearSeat();
      return this.fail(e, /ended|taken/.test(message(e)) ? undefined : () => void this.rejoin(seat));
    }
    if (cancelled) return void t.close();
    this.stopRoom = null;
    const s = this.setupSession(t, seat);
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
    waiting('Waiting for the other phone to catch you up…');
    s.rejoin();
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
          const name = p.name === getCharacter(p.characterId).name ? getCharacter(sel.value).name : p.name;
          s.setPick({ name, characterId: sel.value });
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

  /** The match is over for good: they left, or the room closed. */
  lost(): void {
    netLog('ui: connection lost');
    this.endSeat();
    this.cleanup();
    this.show([heading('Connection lost'), text('The other phone left the match.'), cancelButton(() => this.close(), 'Back')]);
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** Leave: tear everything down and go back to setup. */
  close(): void {
    this.session?.leave();
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
    saveSeat(seat);
    if (this.seatTimer) clearInterval(this.seatTimer);
    this.seatTimer = setInterval(() => touchSeat(), 20_000);
    // Publish the spectator feed for anyone watching.
    if (peer instanceof RelayTransport) {
      const pub = new ViewPublisher(peer);
      s.onView = (v) => pub.push(v);
    }
    s.onLobby = () => this.lobby();
    s.onLost = () => this.lost();
    s.onPeerAway = (away) => this.showAway(away);
    s.onResumed = (inMatch) => {
      netLog(`ui: rejoined ${inMatch ? 'the match' : 'the lobby'}`);
      if (inMatch) return; // the game takes over (onStart)
      if (s.localPick) this.lobby();
      else s.setPick(this.pick());
    };
    this.onConnected(s);
    return s;
  }

  private showAway(away: boolean): void {
    const s = this.session;
    if (!away || !s || s.lost) {
      this.away.hidden = true;
      return;
    }
    const leave = el('button', undefined, 'Leave');
    leave.addEventListener('click', () => this.close());
    this.away.replaceChildren(el('span', undefined, `Lost touch with ${s.remotePick?.name ?? 'the other phone'}. Waiting for them to come back…`), leave);
    this.away.hidden = false;
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

  /** This phone's seat is done with: forget it. */
  private endSeat(): void {
    if (this.seatTimer) clearInterval(this.seatTimer);
    this.seatTimer = null;
    this.away.hidden = true;
    if (this.session) clearSeat();
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

  private show(children: HTMLElement[]): void {
    this.root.replaceChildren(...children, logsButton());
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

/** Side-by-side lists, tops level. */
function lists(...cols: HTMLElement[]): HTMLElement {
  const r = row(...cols);
  r.classList.add('online-lists');
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

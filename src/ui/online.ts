import { getCharacter, ROSTER } from '../characters/roster';
import { roomLink } from '../net/links';
import { netLog, netLogText } from '../net/log';
import { advertise, HostedRoom, joinRoom, lobbySealer, normaliseRoomCode, watchLobby, type Advert } from '../net/rooms';
import { Rtdb } from '../net/rtdb';
import { NetSession, type Pick } from '../net/session';
import type { Transport } from '../net/transport';

export interface OnlineOptions {
  /** This phone's pick (character and name). */
  pick: () => Pick;
  /** The Firebase Realtime Database rooms go through, or null if it isn't set up. */
  dbUrl: string | null;
  /** Something the phones on one Wi-Fi share (their public address), or null if unknown. */
  lanId: () => Promise<string | null>;
}

/**
 * Setting up a two-phone match through a room on Firebase: the host gets a 4-letter code (also shown to
 * phones on the same Wi-Fi as a game to tap, and as a link to send), and the game's messages go through
 * the room, so any network works. Then both land in a little lobby where the host starts the battle.
 */
export class OnlineScreen {
  private readonly root = el('div', 'overlay online');
  private stopRoom: (() => void) | null = null;
  private peer: Transport | null = null;
  session: NetSession | null = null;

  /** A session is connected and both picks can be exchanged. */
  onConnected: (s: NetSession) => void = () => {};
  /** Host pressed Start. */
  onHostStart: (s: NetSession) => void = () => {};
  onClosed: () => void = () => {};

  private readonly pick: () => Pick;

  constructor(private readonly opts: OnlineOptions) {
    this.pick = opts.pick;
    this.root.id = 'online';
    this.root.hidden = true;
    document.body.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Host a room: a code to type, a link to open, and a spot on the nearby game list. */
  async host(): Promise<void> {
    this.reset();
    netLog('ui: Host');
    if (!this.opts.dbUrl) return this.fail(new Error("Online play isn't switched on yet. Play on this phone for now."));
    this.show([heading('Host a game'), status('Opening a room…')]);
    const db = new Rtdb(this.opts.dbUrl);
    const [lan, opened] = await Promise.all([this.opts.lanId(), HostedRoom.open(db).catch((e: unknown) => e as Error)]);
    if (opened instanceof Error) {
      netLog(`ui: couldn't open a room: ${opened.message}`);
      return this.fail(new Error("Couldn't reach the game server. Is this phone online?"), () => void this.host());
    }
    const room = opened;
    const nearby = lan ? await lobbySealer(lan) : null;
    const pick = this.pick();
    const ad = nearby ? advertise(db, nearby, { hostId: room.id, name: pick.name, characterId: pick.characterId, room: room.code }) : null;
    netLog(`ui: room ${room.code} open${nearby ? ', on the nearby list' : ' (no nearby list: public address unknown)'}`);
    this.stopRoom = () => {
      room.cancel();
      ad?.stop();
    };
    void room.waitForGuest().then((t) => {
      ad?.stop();
      room.stop();
      this.stopRoom = null;
      this.startSession(t, 'host');
    });
    const link = roomLink(room.code);
    const big = el('div', 'online-code', room.code);
    big.id = 'online-room-code';
    this.show([
      heading('Host a game'),
      row(
        col(
          heading('Room code', 'h3'),
          big,
          text(nearby ? 'On the other phone tap Join: on the same Wi-Fi your game is right there to tap. Or type the code (any network).' : 'On the other phone tap Join and type this code.'),
        ),
        col(heading('Or send them the link', 'h3'), shareRow(link, 'Join my Pooket Tabks game')),
      ),
      status('Waiting for someone to join…', 'online-status'),
      buttons(cancelButton(() => this.close())),
    ]);
  }

  /** Join: nearby games to tap, or type a room code. With a code (from a link), go straight in. */
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
      netLog(`ui: joining room ${c}`);
      stopWatch();
      this.show([heading('Join a game'), status(`Joining ${c}…`, 'online-status'), buttons(cancelButton(() => this.close()))]);
      joinRoom(db, c).then(
        (t) => (cancelled ? t.close() : this.startSession(t, 'guest')),
        (e) => !cancelled && this.fail(e, () => void this.join()),
      );
    };
    const typed = normaliseRoomCode(code ?? '');
    if (typed) return joinCode(typed);

    this.show([heading('Join a game'), status('Looking for games…')]);
    const [lan, up] = await Promise.all([this.opts.lanId(), db.reachable()]);
    if (cancelled) return;
    if (!up) return this.fail(new Error("Couldn't reach the game server. Is this phone online?"), () => void this.join());
    const nearby = lan ? await lobbySealer(lan) : null;
    const list = el('div', 'online-games');
    list.id = 'online-games';
    let lastCount = -1;
    const render = (games: Advert[]) => {
      if (games.length !== lastCount) netLog(`ui: nearby list shows ${games.length} game(s)`);
      lastCount = games.length;
      list.replaceChildren(
        ...(games.length
          ? games.map((g) => {
              const b = el('button', 'online-game', `${g.name}'s game`);
              b.append(el('small', undefined, ` ${getCharacter(g.characterId).name} · ${g.room}`));
              b.addEventListener('click', () => joinCode(g.room));
              return b;
            })
          : [el('p', 'online-none', 'No games yet. Ask the other phone to tap Host.')]),
      );
    };
    if (nearby) stopWatch = watchLobby(db, nearby, render).stop;
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
      heading('Join a game'),
      row(
        ...(nearby ? [col(heading('Games on your Wi-Fi', 'h3'), list)] : []),
        col(heading(nearby ? 'Or type the room code' : 'Type the room code', 'h3'), codeRow),
      ),
      buttons(cancelButton(() => this.close())),
    ]);
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
      line(s.isHost ? 'You (host, first to fire)' : 'Host', s.isHost ? me : them, s.isHost),
      line(s.isHost ? 'Them' : 'You', s.isHost ? them : me, !s.isHost),
      s.isHost ? start : status(them ? 'Waiting for the host to start…' : 'Saying hello…', 'online-status'),
      cancelButton(() => this.close(), 'Leave'),
    ]);
  }

  /** The connection dropped (or they left). */
  lost(): void {
    netLog('ui: connection lost');
    this.cleanup();
    this.show([heading('Connection lost'), text('The other phone left or the Wi-Fi dropped.'), cancelButton(() => this.close(), 'Back')]);
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** Leave: tear everything down and go back to setup. */
  close(): void {
    this.session?.leave();
    this.cleanup();
    this.session = null;
    this.hide();
    this.onClosed();
  }

  /** Connected through the room: start the match session and show the lobby. */
  private startSession(peer: Transport, role: 'host' | 'guest'): void {
    netLog(`ui: connected as ${role}`);
    this.stopRoom?.();
    this.stopRoom = null;
    this.peer = peer;
    const s = new NetSession(peer, role);
    this.session = s;
    s.onLobby = () => this.lobby();
    s.onLost = () => this.lost();
    this.onConnected(s);
    s.setPick(this.pick());
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
    if (!this.session) this.peer?.close();
    this.peer = null;
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

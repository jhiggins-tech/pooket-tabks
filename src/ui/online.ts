import { getCharacter, ROSTER } from '../characters/roster';
import { answerLink, canScanInApp, extractCode, joinLink, listenForAnswer, relayAnswer, roomLink, scanQr } from '../net/links';
import { netLog, netLogText } from '../net/log';
import { Peer } from '../net/peer';
import { encodeQr } from '../net/qr';
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
 * Setting up a two-phone match. Normally through a room on Firebase: the host gets a 4-letter code (also
 * shown to phones on the same Wi-Fi as a game to tap), and the game's messages go through the room, so
 * any network works. If Firebase isn't set up or reachable, the phones swap direct WebRTC codes instead
 * (QR / link, both ways; same Wi-Fi). Then both land in a little lobby where the host starts the battle.
 */
export class OnlineScreen {
  private readonly root = el('div', 'overlay online');
  private stopRoom: (() => void) | null = null;
  private stopListening: (() => void) | null = null;
  private stopScan: (() => void) | null = null;
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
    if (!this.opts.dbUrl) return this.hostDirect("Online rooms aren't switched on yet, so swap direct codes instead.");
    this.show([heading('Host a game'), status('Opening a room…')]);
    const db = new Rtdb(this.opts.dbUrl);
    const [lan, opened] = await Promise.all([this.opts.lanId(), HostedRoom.open(db).catch((e: unknown) => e as Error)]);
    if (opened instanceof Error) {
      netLog(`ui: couldn't open a room: ${opened.message}`);
      return this.hostDirect("Couldn't reach the game server, so swap direct codes instead.");
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
        col(heading('Or scan this / send the link', 'h3'), qrCanvas(link), shareRow(link, 'Join my Pooket Tabks game')),
      ),
      status('Waiting for someone to join…', 'online-status'),
      buttons(cancelButton(() => this.close()), linkButton('No internet? Use direct codes', () => void this.hostDirect())),
    ]);
  }

  /** Join: nearby games to tap, or type a room code. With a code (from a link), go straight in. */
  async join(code?: string): Promise<void> {
    this.reset();
    netLog(`ui: Join${code ? ` ${code}` : ''}`);
    if (!this.opts.dbUrl) return this.joinDirect(undefined, "Online rooms aren't switched on yet, so scan or paste the host's direct code instead.");
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
    if (!up) return this.joinDirect(undefined, "Couldn't reach the game server, so scan or paste the host's direct code instead.");
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
      buttons(cancelButton(() => this.close()), linkButton('Have a direct code instead?', () => void this.joinDirect())),
    ]);
  }

  /** Direct codes (no game server): the host shows a code, the other phone replies with its own. */
  async hostDirect(note?: string): Promise<void> {
    this.reset();
    netLog(`ui: Host with direct codes${note ? ` (${note})` : ''}`);
    this.show([heading('Host a game'), status('Making a code…')]);
    try {
      const { peer, code } = await Peer.host();
      this.peer = peer;
      this.watch(peer, 'host');
      const link = joinLink(code);
      const reply = el('div', 'online-reply');
      const paste = pasteBox("Paste the other phone's reply", async (text) => this.accept(text));
      reply.append(heading('2. Then get their reply', 'h3'), ...(await this.scanButton("Scan their reply", (t) => this.accept(t))), paste);
      this.show([
        heading('Host a game'),
        ...(note ? [text(note)] : []),
        row(
          col(heading('1. On the other phone, scan this', 'h3'), qrCanvas(link), shareRow(link, 'Join my Pooket Tabks game')),
          col(reply, status('Waiting for their reply…', 'online-status')),
        ),
        cancelButton(() => this.close()),
      ]);
      // A reply scanned with the camera app opens in another tab, which passes it back here.
      this.stopListening = listenForAnswer((c) => void this.accept(c));
    } catch (e) {
      this.fail(e);
    }
  }

  /** Join with a direct code: with one already (from a link), or ask for one. */
  async joinDirect(code?: string, note?: string): Promise<void> {
    this.reset();
    netLog(`ui: Join with direct codes${note ? ` (${note})` : ''}${code ? ' (code given)' : ''}`);
    if (!code) {
      this.show([
        heading('Join a game'),
        ...(note ? [text(note)] : []),
        text("Scan the host's QR code with your phone's camera, or paste their code or link here."),
        ...(await this.scanButton("Scan the host's code", (t) => this.joinAny(t))),
        pasteBox("Host's code or link", async (t) => this.joinAny(t)),
        cancelButton(() => this.close()),
      ]);
      return;
    }
    this.show([heading('Join a game'), status('Answering…')]);
    try {
      const { peer, code: reply } = await Peer.join(extractCode(code).code);
      this.peer = peer;
      this.watch(peer, 'guest');
      const link = answerLink(reply);
      this.show([
        heading('Join a game'),
        row(
          col(heading('Now show this to the host', 'h3'), qrCanvas(link), shareRow(link, 'My Pooket Tabks reply')),
          col(text('On the host phone: scan it with the camera (or in the game), or paste it in.'), status('Waiting for the host…', 'online-status')),
        ),
        cancelButton(() => this.close()),
      ]);
    } catch (e) {
      this.fail(e);
    }
  }

  /** This tab was opened from a reply QR by the camera app: hand the code to the game tab. */
  relay(code: string): void {
    relayAnswer(code);
    this.show([
      heading('Reply sent'),
      text('Switch back to the Pooket Tabks tab that showed the QR code; it connects from there.'),
      text("If nothing happens there, copy this and paste it into that tab's reply box:"),
      shareRow(answerLink(code), 'Pooket Tabks reply', false),
      cancelButton(() => this.hide(), 'OK'),
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

  private async accept(text: string): Promise<void> {
    const { code } = extractCode(text);
    try {
      await (this.peer as Peer | null)?.accept(code); // direct codes: always a WebRTC peer
      this.setStatus('Connecting…');
    } catch (e) {
      this.setStatus(message(e));
    }
  }

  /** Whatever was scanned or pasted: a room link, a direct code/link, or a bare room code. */
  private joinAny(text: string): void {
    const found = extractCode(text);
    const room = found.kind === 'room' ? found.code : found.kind === 'bare' ? normaliseRoomCode(found.code) : null;
    if (room) void this.join(room);
    else void this.joinDirect(found.code);
  }

  /** The data channel is open: start the match session and show the lobby. */
  private startSession(peer: Transport, role: 'host' | 'guest'): void {
    netLog(`ui: connected as ${role}`);
    this.stopRoom?.();
    this.stopRoom = null;
    this.stopListening?.();
    this.stopScan?.();
    this.peer = peer;
    const s = new NetSession(peer, role);
    this.session = s;
    s.onLobby = () => this.lobby();
    s.onLost = () => this.lost();
    this.onConnected(s);
    s.setPick(this.pick());
  }

  private watch(peer: Peer, role: 'host' | 'guest'): void {
    peer.onOpen = () => this.startSession(peer, role);
    peer.onClose = () => {
      if (!this.session) this.fail(new Error("Couldn't connect. Are both phones on the same Wi-Fi?"));
    };
  }

  private async scanButton(label: string, onText: (text: string) => void): Promise<HTMLElement[]> {
    if (!(await canScanInApp())) return [];
    const btn = el('button', undefined, `📷 ${label}`);
    const video = el('video', 'online-video') as HTMLVideoElement;
    video.hidden = true;
    video.muted = true;
    btn.addEventListener('click', () => {
      this.stopScan?.();
      video.hidden = false;
      const { result, cancel } = scanQr(video);
      this.stopScan = cancel;
      result.then(
        (t) => {
          video.hidden = true;
          onText(t);
        },
        (e) => {
          video.hidden = true;
          if (message(e) !== 'cancelled') this.setStatus("Couldn't use the camera. Paste the code instead.");
        },
      );
    });
    return [btn, video];
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

  private setStatus(msg: string): void {
    const s = this.root.querySelector('.online-status');
    if (s) s.textContent = msg;
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
    this.stopListening?.();
    this.stopListening = null;
    this.stopScan?.();
    this.stopScan = null;
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

/** Draw a link as a QR code on a canvas (dark on white, with a quiet zone). */
function qrCanvas(link: string): HTMLElement {
  const m = encodeQr(link, 'M');
  const quiet = 3;
  const n = m.length + quiet * 2;
  const scale = Math.max(3, Math.floor(420 / n));
  const c = document.createElement('canvas');
  c.className = 'online-qr';
  c.width = c.height = n * scale;
  c.dataset.link = link;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#000';
  m.forEach((r, y) => r.forEach((dark, x) => dark && g.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale)));
  return c;
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

function pasteBox(placeholder: string, onSubmit: (text: string) => Promise<void> | void): HTMLElement {
  const r = el('div', 'online-paste');
  const input = el('input') as HTMLInputElement;
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', placeholder);
  const go = el('button', undefined, 'Connect');
  const submit = () => input.value.trim() && void onSubmit(input.value);
  go.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  r.append(input, go);
  return r;
}

import { getCharacter, ROSTER } from '../characters/roster';
import { answerLink, canScanInApp, extractCode, joinLink, listenForAnswer, relayAnswer, scanQr } from '../net/links';
import { Peer } from '../net/peer';
import { encodeQr } from '../net/qr';
import { NetSession, type Pick } from '../net/session';

/**
 * Setting up a match over Wi-Fi: the host shows a code (QR / link), the other phone replies with its
 * own, then both land in a little lobby where the host starts the battle.
 */
export class OnlineScreen {
  private readonly root = el('div', 'overlay online');
  private stopListening: (() => void) | null = null;
  private stopScan: (() => void) | null = null;
  private peer: Peer | null = null;
  session: NetSession | null = null;

  /** A session is connected and both picks can be exchanged. */
  onConnected: (s: NetSession) => void = () => {};
  /** Host pressed Start. */
  onHostStart: (s: NetSession) => void = () => {};
  onClosed: () => void = () => {};

  constructor(private readonly pick: () => Pick) {
    this.root.id = 'online';
    this.root.hidden = true;
    document.body.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  async host(): Promise<void> {
    this.reset();
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

  /** Join: with a code already (from a link), or ask for one. */
  async join(code?: string): Promise<void> {
    this.reset();
    if (!code) {
      this.show([
        heading('Join a game'),
        text("Scan the host's QR code with your phone's camera, or paste their code or link here."),
        ...(await this.scanButton("Scan the host's code", (t) => void this.join(extractCode(t).code))),
        pasteBox("Host's code or link", async (t) => this.join(extractCode(t).code)),
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
      await this.peer?.accept(code);
      this.setStatus('Connecting…');
    } catch (e) {
      this.setStatus(message(e));
    }
  }

  private watch(peer: Peer, role: 'host' | 'guest'): void {
    peer.onOpen = () => {
      this.stopListening?.();
      this.stopScan?.();
      const s = new NetSession(peer, role);
      this.session = s;
      s.onLobby = () => this.lobby();
      s.onLost = () => this.lost();
      this.onConnected(s);
      s.setPick(this.pick());
    };
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

  private fail(e: unknown): void {
    this.cleanup();
    this.show([heading('Hmm'), text(message(e)), cancelButton(() => this.close(), 'Back')]);
  }

  private setStatus(msg: string): void {
    const s = this.root.querySelector('.online-status');
    if (s) s.textContent = msg;
  }

  private show(children: HTMLElement[]): void {
    this.root.replaceChildren(...children);
    this.root.hidden = false;
  }

  private reset(): void {
    this.cleanup();
    this.session = null;
  }

  private cleanup(): void {
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

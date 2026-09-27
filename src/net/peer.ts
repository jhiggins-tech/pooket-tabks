import { compressSdp, expandCode } from './sdp';
import type { Transport } from './transport';
import { decodeMsg, encodeMsg } from './wire';

/** Free public STUN only: no relay (TURN), so the baseline is two phones on the same Wi-Fi. */
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
/** Stop waiting for more candidates after this long (STUN can be slow or unreachable on a LAN). */
const GATHER_TIMEOUT_MS = 2500;
/** Messages bigger than this go in pieces (Safari's data channels cap message size). */
const CHUNK = 12_000;
/** A connection that stays "disconnected" this long (the other phone vanished) counts as lost. */
const DISCONNECT_GRACE_MS = 6000;

/**
 * One WebRTC data channel to the other phone, set up by swapping two short codes (offer, then answer)
 * by QR, link or copy-paste. No signalling server.
 */
export class Peer implements Transport {
  onMessage: (msg: unknown) => void = () => {};
  onOpen: () => void = () => {};
  onClose: () => void = () => {};
  private channel: RTCDataChannel | null = null;
  private readonly partial = new Map<number, string[]>();
  private chunkId = 0;
  private closed = false;

  private constructor(private readonly pc: RTCPeerConnection) {
    let grace: ReturnType<typeof setTimeout> | null = null;
    pc.addEventListener('connectionstatechange', () => {
      const st = pc.connectionState;
      if (grace) clearTimeout(grace);
      grace = null;
      if (st === 'failed' || st === 'closed') this.handleClose();
      // A Wi-Fi blip can recover; a phone that's gone won't.
      else if (st === 'disconnected') grace = setTimeout(() => pc.connectionState !== 'connected' && this.handleClose(), DISCONNECT_GRACE_MS);
    });
  }

  /** Host: make an offer. Returns the peer and the code to hand to the other phone. */
  static async host(): Promise<{ peer: Peer; code: string }> {
    const peer = new Peer(new RTCPeerConnection({ iceServers: ICE_SERVERS }));
    peer.attach(peer.pc.createDataChannel('pooket', { ordered: true }));
    await peer.pc.setLocalDescription(await peer.pc.createOffer());
    await peer.gathered();
    return { peer, code: compressSdp('offer', peer.pc.localDescription!.sdp) };
  }

  /** Joiner: take the host's code and make an answer to send back. */
  static async join(offerCode: string): Promise<{ peer: Peer; code: string }> {
    const offer = expandCode(offerCode);
    if (offer.kind !== 'offer') throw new Error("That's an answer code; scan the host's code instead");
    const peer = new Peer(new RTCPeerConnection({ iceServers: ICE_SERVERS }));
    peer.pc.addEventListener('datachannel', (e) => peer.attach(e.channel));
    await peer.pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
    await peer.pc.setLocalDescription(await peer.pc.createAnswer());
    await peer.gathered();
    return { peer, code: compressSdp('answer', peer.pc.localDescription!.sdp) };
  }

  /** Host: take the joiner's answer code; the channel opens shortly after. */
  async accept(answerCode: string): Promise<void> {
    const answer = expandCode(answerCode);
    if (answer.kind !== 'answer') throw new Error("That's the host's code; scan the other phone's reply code");
    await this.pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
  }

  get open(): boolean {
    return this.channel?.readyState === 'open';
  }

  send(msg: unknown): void {
    if (!this.channel || this.channel.readyState !== 'open') return;
    const text = encodeMsg(msg);
    if (text.length <= CHUNK) {
      this.channel.send(text);
      return;
    }
    const id = ++this.chunkId;
    const n = Math.ceil(text.length / CHUNK);
    for (let i = 0; i < n; i++) this.channel.send(JSON.stringify({ k: '~chunk', id, i, n, d: text.slice(i * CHUNK, (i + 1) * CHUNK) }));
  }

  close(): void {
    this.closed = true;
    this.channel?.close();
    this.pc.close();
  }

  private attach(ch: RTCDataChannel): void {
    this.channel = ch;
    ch.addEventListener('open', () => this.onOpen());
    ch.addEventListener('close', () => this.handleClose());
    ch.addEventListener('message', (e) => this.receive(String(e.data)));
  }

  private receive(text: string): void {
    let msg: { k?: string; id?: number; i?: number; n?: number; d?: string };
    try {
      msg = decodeMsg(text) as typeof msg;
    } catch {
      return;
    }
    if (msg.k !== '~chunk') {
      this.onMessage(msg);
      return;
    }
    const parts = this.partial.get(msg.id!) ?? [];
    parts[msg.i!] = msg.d!;
    this.partial.set(msg.id!, parts);
    if (parts.filter((p) => p !== undefined).length === msg.n) {
      this.partial.delete(msg.id!);
      this.receive(parts.join(''));
    }
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose();
  }

  /** Wait for ICE gathering to finish (codes are sent whole, not trickled), with a timeout. */
  private gathered(): Promise<void> {
    const pc = this.pc;
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') return resolve();
      const done = () => {
        if (pc.iceGatheringState === 'complete') resolve();
      };
      pc.addEventListener('icegatheringstatechange', done);
      setTimeout(resolve, GATHER_TIMEOUT_MS);
    });
  }
}

/**
 * This network's public address, as STUN sees it (phones on the same Wi-Fi usually share one), used
 * to find games on the same Wi-Fi. Null if STUN can't be reached in time.
 */
export async function publicAddress(timeoutMs = 3000): Promise<string | null> {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  try {
    pc.createDataChannel('probe');
    return await new Promise<string | null>((resolve) => {
      let v6: string | null = null;
      const timer = setTimeout(() => resolve(v6), timeoutMs);
      pc.addEventListener('icecandidate', (e) => {
        const c = e.candidate?.candidate;
        if (!c) {
          clearTimeout(timer);
          resolve(v6);
          return;
        }
        const f = c.split(' ');
        if (f[7] !== 'srflx') return;
        const ip = f[4]!;
        if (ip.includes(':')) v6 ??= ip.split(':').slice(0, 4).join(':'); // an IPv6 /64 is the network
        else {
          clearTimeout(timer);
          resolve(ip); // IPv4 preferred: the whole Wi-Fi shares it
        }
      });
      void pc.createOffer().then((o) => pc.setLocalDescription(o));
    });
  } finally {
    pc.close();
  }
}

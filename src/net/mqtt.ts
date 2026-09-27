/**
 * A minimal MQTT 3.1.1 client over WebSocket: just enough to use free public brokers as a signalling
 * relay. QoS 0 only; supports retained messages and a "last will" (sent by the broker if we vanish).
 */

export interface MqttOptions {
  clientId: string;
  /** Published by the broker if this client disconnects without saying goodbye. */
  will?: { topic: string; payload: Uint8Array; retain: boolean };
  keepAlive?: number;
}

const CONNECT = 1;
const CONNACK = 2;
const PUBLISH = 3;
const SUBSCRIBE = 8;
const PINGREQ = 12;
const DISCONNECT = 14;

export class MqttClient {
  onMessage: (topic: string, payload: Uint8Array) => void = () => {};
  onClose: () => void = () => {};
  private ws: WebSocket | null = null;
  private buf = new Uint8Array(0);
  private ping: ReturnType<typeof setInterval> | null = null;
  private nextId = 1;
  private connected = false;
  private closed = false;

  constructor(
    readonly url: string,
    private readonly opts: MqttOptions,
  ) {}

  get isConnected(): boolean {
    return this.connected;
  }

  /** Connect; resolves once the broker accepts us. */
  connect(timeoutMs = 6000): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (why: string) => {
        if (settled) return;
        settled = true;
        this.teardown();
        reject(new Error(why));
      };
      const timer = setTimeout(() => fail(`No answer from ${this.url}`), timeoutMs);
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url, 'mqtt');
      } catch (e) {
        clearTimeout(timer);
        fail(String(e));
        return;
      }
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => ws.send(this.connectPacket());
      ws.onerror = () => {
        clearTimeout(timer);
        fail(`Couldn't reach ${this.url}`);
      };
      ws.onclose = () => {
        clearTimeout(timer);
        if (!settled) fail(`${this.url} closed`);
        else this.teardown();
      };
      ws.onmessage = (e) => {
        this.feed(new Uint8Array(e.data as ArrayBuffer), (ok) => {
          clearTimeout(timer);
          if (settled) return;
          settled = true;
          if (!ok) {
            this.teardown();
            reject(new Error(`${this.url} refused the connection`));
            return;
          }
          this.connected = true;
          const ka = this.opts.keepAlive ?? 30;
          this.ping = setInterval(() => this.send(packet(PINGREQ, 0, [])), ka * 600);
          resolve();
        });
      };
    });
  }

  subscribe(filter: string): void {
    const id = this.nextId++ & 0xffff || 1;
    this.send(packet(SUBSCRIBE, 2, [u16(id), str(filter), Uint8Array.of(0)]));
  }

  publish(topic: string, payload: Uint8Array, retain = false): void {
    this.send(packet(PUBLISH, retain ? 1 : 0, [str(topic), payload]));
  }

  /** Say goodbye (the broker won't publish our will). */
  close(): void {
    if (this.closed) return;
    this.send(packet(DISCONNECT, 0, []));
    this.closed = true;
    this.teardown();
  }

  private send(bytes: Uint8Array<ArrayBuffer>): void {
    if (this.ws?.readyState === 1) this.ws.send(bytes);
  }

  private teardown(): void {
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
    const wasConnected = this.connected;
    this.connected = false;
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= 1) {
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    if (wasConnected) this.onClose();
  }

  private connectPacket(): Uint8Array<ArrayBuffer> {
    const { clientId, will } = this.opts;
    let flags = 0x02; // clean session
    if (will) flags |= 0x04 | (will.retain ? 0x20 : 0);
    const parts = [str('MQTT'), Uint8Array.of(4, flags), u16(this.opts.keepAlive ?? 30), str(clientId)];
    if (will) parts.push(str(will.topic), u16(will.payload.length), will.payload);
    return packet(CONNECT, 0, parts);
  }

  /** Parse whatever complete packets have arrived. */
  private feed(chunk: Uint8Array, onConnack: (ok: boolean) => void): void {
    const b = new Uint8Array(this.buf.length + chunk.length);
    b.set(this.buf);
    b.set(chunk, this.buf.length);
    let p = 0;
    while (p + 2 <= b.length) {
      const type = b[p]! >> 4;
      const flags = b[p]! & 0x0f;
      // Remaining length: a base-128 varint.
      let len = 0;
      let mul = 1;
      let q = p + 1;
      let complete = false;
      while (q < b.length) {
        const byte = b[q++]!;
        len += (byte & 0x7f) * mul;
        mul *= 128;
        if (!(byte & 0x80)) {
          complete = true;
          break;
        }
      }
      if (!complete || q + len > b.length) break; // wait for the rest
      const body = b.subarray(q, q + len);
      p = q + len;
      if (type === CONNACK) onConnack(body[1] === 0);
      else if (type === PUBLISH) {
        const tlen = (body[0]! << 8) | body[1]!;
        const topic = new TextDecoder().decode(body.subarray(2, 2 + tlen));
        const qos = (flags >> 1) & 3;
        const start = 2 + tlen + (qos > 0 ? 2 : 0);
        this.onMessage(topic, body.slice(start));
      }
      // SUBACK and PINGRESP need no action.
    }
    this.buf = b.slice(p);
  }
}

function packet(type: number, flags: number, parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const len = parts.reduce((n, x) => n + x.length, 0);
  const head = [(type << 4) | flags];
  let n = len;
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) d |= 0x80;
    head.push(d);
  } while (n > 0);
  const out = new Uint8Array(head.length + len);
  out.set(head);
  let o = head.length;
  for (const x of parts) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}

function u16(n: number): Uint8Array {
  return Uint8Array.of((n >> 8) & 0xff, n & 0xff);
}

function str(s: string): Uint8Array {
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(bytes.length + 2);
  out.set(u16(bytes.length));
  out.set(bytes, 2);
  return out;
}

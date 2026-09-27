/**
 * A tiny MQTT 3.1.1 broker over WebSocket for tests (the real game uses free public brokers). QoS 0,
 * `+`/`#` wildcards, retained messages (empty payload clears), last wills on abrupt disconnects.
 */
import { WebSocketServer, type WebSocket } from 'ws';

interface Client {
  id: string;
  ws: WebSocket;
  subs: string[];
  will: { topic: string; payload: Buffer; retain: boolean } | null;
  graceful: boolean;
  buf: Buffer;
}

export interface TestBroker {
  url: string;
  published: { topic: string; payload: Buffer }[];
  close(): Promise<void>;
  /** Drop connections abruptly (as if the network vanished): one client, or all. */
  kill(clientId?: string): void;
}

export function matches(filter: string, topic: string): boolean {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

function packet(type: number, flags: number, body: Buffer): Buffer {
  const head = [(type << 4) | flags];
  let n = body.length;
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) d |= 0x80;
    head.push(d);
  } while (n > 0);
  return Buffer.concat([Buffer.from(head), body]);
}

function str(s: string): Buffer {
  const b = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(b.length);
  return Buffer.concat([len, b]);
}

export async function startBroker(): Promise<TestBroker> {
  const wss = new WebSocketServer({ port: 0, handleProtocols: () => 'mqtt' });
  await new Promise<void>((r) => wss.once('listening', () => r()));
  const port = (wss.address() as { port: number }).port;
  const clients = new Set<Client>();
  const retained = new Map<string, Buffer>();
  const published: TestBroker['published'] = [];

  const deliver = (topic: string, payload: Buffer, retain: boolean) => {
    published.push({ topic, payload });
    if (retain) {
      if (payload.length === 0) retained.delete(topic);
      else retained.set(topic, payload);
    }
    const pkt = packet(3, 0, Buffer.concat([str(topic), payload]));
    for (const c of clients) if (c.subs.some((f) => matches(f, topic))) c.ws.send(pkt);
  };

  wss.on('connection', (ws) => {
    const c: Client = { id: '', ws, subs: [], will: null, graceful: false, buf: Buffer.alloc(0) };
    clients.add(c);
    ws.on('message', (data: Buffer) => {
      c.buf = Buffer.concat([c.buf, data]);
      for (;;) {
        if (c.buf.length < 2) return;
        let len = 0;
        let mul = 1;
        let q = 1;
        let done = false;
        while (q < c.buf.length) {
          const b = c.buf[q++]!;
          len += (b & 0x7f) * mul;
          mul *= 128;
          if (!(b & 0x80)) {
            done = true;
            break;
          }
        }
        if (!done || c.buf.length < q + len) return;
        const type = c.buf[0]! >> 4;
        const flags = c.buf[0]! & 0x0f;
        const body = c.buf.subarray(q, q + len);
        c.buf = c.buf.subarray(q + len);
        if (type === 1) {
          // CONNECT: protocol name, level, flags, keepalive, client id, [will topic, will payload]
          let p = 2 + body.readUInt16BE(0);
          const cflags = body[p + 1]!;
          p += 4;
          const idLen = body.readUInt16BE(p);
          c.id = body.subarray(p + 2, p + 2 + idLen).toString('utf8');
          p += 2 + idLen;
          if (cflags & 0x04) {
            const tl = body.readUInt16BE(p);
            const topic = body.subarray(p + 2, p + 2 + tl).toString('utf8');
            p += 2 + tl;
            const pl = body.readUInt16BE(p);
            c.will = { topic, payload: Buffer.from(body.subarray(p + 2, p + 2 + pl)), retain: !!(cflags & 0x20) };
          }
          ws.send(Buffer.from([0x20, 0x02, 0x00, 0x00]));
        } else if (type === 8) {
          const id = body.readUInt16BE(0);
          let p = 2;
          const granted: number[] = [];
          const filters: string[] = [];
          while (p < body.length) {
            const l = body.readUInt16BE(p);
            filters.push(body.subarray(p + 2, p + 2 + l).toString('utf8'));
            p += 3 + l;
            granted.push(0);
          }
          c.subs.push(...filters);
          ws.send(packet(9, 0, Buffer.from([id >> 8, id & 0xff, ...granted])));
          for (const [topic, payload] of retained) {
            if (filters.some((f) => matches(f, topic))) ws.send(packet(3, 1, Buffer.concat([str(topic), payload])));
          }
        } else if (type === 3) {
          const tl = body.readUInt16BE(0);
          const topic = body.subarray(2, 2 + tl).toString('utf8');
          const qos = (flags >> 1) & 3;
          deliver(topic, Buffer.from(body.subarray(2 + tl + (qos ? 2 : 0))), !!(flags & 1));
        } else if (type === 12) {
          ws.send(Buffer.from([0xd0, 0x00]));
        } else if (type === 14) {
          c.graceful = true;
          ws.close();
        }
      }
    });
    ws.on('close', () => {
      clients.delete(c);
      if (!c.graceful && c.will) deliver(c.will.topic, c.will.payload, c.will.retain);
    });
  });

  return {
    url: `ws://127.0.0.1:${port}/mqtt`,
    published,
    kill: (clientId?: string) => {
      for (const c of clients) if (clientId === undefined || c.id === clientId) c.ws.terminate();
    },
    close: () =>
      new Promise<void>((r) => {
        for (const c of clients) c.ws.terminate();
        wss.close(() => r());
      }),
  };
}

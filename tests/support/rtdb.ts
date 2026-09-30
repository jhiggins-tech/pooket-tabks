/**
 * A stand-in for the Firebase Realtime Database REST API, for tests: JSON tree at `/<path>.json`
 * (GET/PUT/POST/PATCH/DELETE), Server-Sent Events streaming with `put` events, push keys, server
 * timestamps, CORS, and the seat rules from `firebase/database.rules.json` that matter (first host /
 * first guest wins).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export interface FakeRtdb {
  url: string;
  tree: () => Record<string, unknown>;
  requests: { method: string; path: string }[];
  /** Answer every write this much later (a slow network). */
  latency: number;
  close(): Promise<void>;
}

type Json = unknown;

export async function startRtdb(): Promise<FakeRtdb> {
  let root: Record<string, Json> = {};
  const listeners = new Set<{ segs: string[]; res: ServerResponse }>();
  const requests: FakeRtdb['requests'] = [];
  let pushN = 0;
  const fake = { latency: 0 } as FakeRtdb;

  const segsOf = (path: string) => path.split('/').filter(Boolean);
  const getAt = (segs: string[]): Json => {
    let v: Json = root;
    for (const s of segs) {
      if (v === null || typeof v !== 'object') return null;
      v = (v as Record<string, Json>)[s] ?? null;
    }
    return v ?? null;
  };
  const prune = (v: Json): Json => {
    if (v === null || typeof v !== 'object') return v;
    const o: Record<string, Json> = {};
    for (const [k, c] of Object.entries(v as Record<string, Json>)) {
      const p = prune(c);
      if (p !== null && p !== undefined) o[k] = p;
    }
    return Object.keys(o).length ? o : null;
  };
  const serverValues = (v: Json): Json => {
    if (v === null || typeof v !== 'object') return v;
    if ((v as Record<string, Json>)['.sv'] === 'timestamp') return Date.now();
    return Object.fromEntries(Object.entries(v as Record<string, Json>).map(([k, c]) => [k, serverValues(c)]));
  };
  const setAt = (segs: string[], value: Json) => {
    if (!segs.length) {
      root = (prune(value) as Record<string, Json>) ?? {};
    } else {
      let node = root as Record<string, Json>;
      for (const s of segs.slice(0, -1)) {
        if (!node[s] || typeof node[s] !== 'object') node[s] = {};
        node = node[s] as Record<string, Json>;
      }
      const v = prune(value);
      if (v === null) delete node[segs.at(-1)!];
      else node[segs.at(-1)!] = v;
      root = (prune(root) as Record<string, Json>) ?? {};
    }
    // Tell streams.
    for (const l of listeners) {
      const isUnder = segs.length >= l.segs.length && l.segs.every((s, i) => segs[i] === s);
      const isAbove = l.segs.length > segs.length && segs.every((s, i) => l.segs[i] === s);
      if (isUnder) sse(l.res, 'put', { path: `/${segs.slice(l.segs.length).join('/')}`, data: getAt(segs) });
      else if (isAbove) sse(l.res, 'put', { path: '/', data: getAt(l.segs) });
    }
  };
  const sse = (res: ServerResponse, event: string, data: Json) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  /**
   * The seat rules: a host or guest seat, once taken, can't be taken by someone else (unless the host is
   * an hour stale and the room has no match record from the last four days).
   */
  const allowed = (segs: string[], value: Json): boolean => {
    if (segs[0] !== 'rooms' || segs.length !== 3 || value === null) return true;
    const existing = getAt(segs) as { id?: string; ts?: number } | null;
    if (!existing) return true;
    if ((value as { id?: string }).id === existing.id) return true;
    if (segs[2] !== 'host') return false;
    const game = getAt([...segs.slice(0, 2), 'game']) as { ts?: number } | null;
    return (existing.ts ?? 0) < Date.now() - 3_600_000 && (!game || (game.ts ?? 0) < Date.now() - 4 * 24 * 3_600_000);
  };

  const cors = (res: ServerResponse) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  };
  const reply = (res: ServerResponse, status: number, body: Json) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage) =>
    new Promise<Json>((resolve) => {
      let s = '';
      req.on('data', (c) => (s += c));
      req.on('end', () => resolve(s ? JSON.parse(s) : null));
    });

  const server = createServer(async (req, res) => {
    cors(res);
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    const url = new URL(req.url!, 'http://x');
    if (!url.pathname.endsWith('.json')) return reply(res, 404, { error: 'not found' });
    const segs = segsOf(decodeURIComponent(url.pathname.slice(0, -5)));
    requests.push({ method: req.method!, path: segs.join('/') });
    if (req.method === 'GET' && req.headers.accept?.includes('text/event-stream')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const l = { segs, res };
      listeners.add(l);
      sse(res, 'put', { path: '/', data: getAt(segs) });
      req.on('close', () => listeners.delete(l));
      return;
    }
    if (req.method === 'GET') return reply(res, 200, getAt(segs));
    const body = serverValues(await readBody(req));
    if (fake.latency > 0) await new Promise((r) => setTimeout(r, fake.latency));
    if (req.method === 'PUT') {
      if (!allowed(segs, body)) return reply(res, 401, { error: 'Permission denied' });
      setAt(segs, body);
      return reply(res, 200, body);
    }
    if (req.method === 'POST') {
      const key = `-N${Date.now().toString(36).padStart(9, '0')}${(pushN++).toString(36).padStart(5, '0')}`;
      setAt([...segs, key], body);
      return reply(res, 200, { name: key });
    }
    if (req.method === 'PATCH') {
      for (const [k, v] of Object.entries(body as Record<string, Json>)) {
        const child = [...segs, ...segsOf(k)];
        if (!allowed(child, v)) return reply(res, 401, { error: 'Permission denied' });
      }
      for (const [k, v] of Object.entries(body as Record<string, Json>)) setAt([...segs, ...segsOf(k)], v);
      return reply(res, 200, body);
    }
    if (req.method === 'DELETE') {
      setAt(segs, null);
      return reply(res, 200, null);
    }
    reply(res, 405, { error: 'method' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  return Object.assign(fake, {
    url: `http://127.0.0.1:${port}`,
    tree: () => root,
    requests,
    close: () =>
      new Promise<void>((r) => {
        for (const l of listeners) l.res.end();
        listeners.clear();
        server.closeAllConnections?.();
        server.close(() => r());
      }),
  });
}

/**
 * A stand-in for the Firebase Realtime Database REST API, for tests: JSON tree at `/<path>.json`
 * (GET/PUT/POST/PATCH/DELETE), Server-Sent Events streaming with `put` events, push keys, server
 * timestamps, CORS, and the seat rules from `firebase/database.rules.json` that matter (first host /
 * first guest wins). Also a stand-in for Google sign-in and Firebase Auth (see `tokenLifetime`):
 * "Google" credentials are `fake:NAME` (account uid `uid-NAME`), and `users/<uid>/…` needs that account's
 * token as `?auth=`, as the rules say.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export interface FakeRtdb {
  url: string;
  tree: () => Record<string, unknown>;
  /** What's stored at `path` (null: nothing). */
  at: (path: string) => unknown;
  /** How many streams are open on `path` (each has had its first `put`, so writes after this reach them). */
  streams: (path: string) => number;
  requests: { method: string; path: string }[];
  /** Answer every write this much later (a slow network). */
  latency: number;
  /** How long a token from the sign-in stand-in lasts (seconds; default an hour). */
  tokenLifetime: number;
  /** Accounts whose refresh token is dead (refreshing signs them out). */
  revoked: Set<string>;
  /** How many tokens it has handed out (sign-ins and refreshes). */
  tokens: number;
  close(): Promise<void>;
}

type Json = unknown;

export async function startRtdb(): Promise<FakeRtdb> {
  let root: Record<string, Json> = {};
  const listeners = new Set<{ segs: string[]; res: ServerResponse; where?: { child: string; value: Json } }>();
  const requests: FakeRtdb['requests'] = [];
  let pushN = 0;
  const fake = { latency: 0, tokenLifetime: 3600, revoked: new Set<string>(), tokens: 0 } as FakeRtdb;
  const issued = new Map<string, { uid: string; expires: number }>();
  const issue = (uid: string) => {
    const token = `tok:${uid}:${fake.tokens++}`;
    issued.set(token, { uid, expires: Date.now() + fake.tokenLifetime * 1000 });
    return token;
  };
  /** Whether this token is a live one for this account. */
  const signedInAs = (token: string | null, uid: string | undefined) => {
    const t = token ? issued.get(token) : undefined;
    return !!t && t.uid === uid && t.expires > Date.now();
  };

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
      // A filtered stream (orderBy / equalTo) gets the whole filtered value again on any change under it.
      if (l.where) {
        if (segs.length >= l.segs.length && l.segs.every((s, i) => segs[i] === s)) sse(l.res, 'put', { path: '/', data: filtered(l) });
        continue;
      }
      const isUnder = segs.length >= l.segs.length && l.segs.every((s, i) => segs[i] === s);
      const isAbove = l.segs.length > segs.length && segs.every((s, i) => l.segs[i] === s);
      if (isUnder) sse(l.res, 'put', { path: `/${segs.slice(l.segs.length).join('/')}`, data: getAt(segs) });
      else if (isAbove) sse(l.res, 'put', { path: '/', data: getAt(l.segs) });
    }
  };
  const filtered = (l: { segs: string[]; where?: { child: string; value: Json } }): Json => {
    const all = getAt(l.segs);
    if (!l.where || !all || typeof all !== 'object') return all;
    const w = l.where;
    const kept = Object.entries(all as Record<string, Json>).filter(([, v]) => (v as Record<string, Json> | null)?.[w.child] === w.value);
    return kept.length ? Object.fromEntries(kept) : null;
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
    if (req.method === 'POST' && url.pathname === '/identitytoolkit/signInWithIdp') {
      const body = (await readBody(req)) as { postBody?: string } | null;
      const credential = new URLSearchParams(body?.postBody ?? '').get('id_token') ?? '';
      if (!credential.startsWith('fake:')) return reply(res, 400, { error: { message: 'INVALID_IDP_RESPONSE' } });
      const uid = `uid-${credential.slice(5)}`;
      return reply(res, 200, { localId: uid, idToken: issue(uid), refreshToken: `ref:${uid}`, expiresIn: String(fake.tokenLifetime) });
    }
    if (req.method === 'POST' && url.pathname === '/securetoken/token') {
      const form = new URLSearchParams(await new Promise<string>((resolve) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => resolve(s)); }));
      const uid = (form.get('refresh_token') ?? '').replace(/^ref:/, '');
      if (!uid || fake.revoked.has(uid)) return reply(res, 400, { error: { message: 'TOKEN_EXPIRED' } });
      return reply(res, 200, { id_token: issue(uid), refresh_token: `ref:${uid}`, expires_in: String(fake.tokenLifetime), user_id: uid });
    }
    if (!url.pathname.endsWith('.json')) return reply(res, 404, { error: 'not found' });
    const segs = segsOf(decodeURIComponent(url.pathname.slice(0, -5)));
    requests.push({ method: req.method!, path: segs.join('/') });
    // The rules: a person's own data is theirs alone.
    if (segs[0] === 'users' && !signedInAs(url.searchParams.get('auth'), segs[1])) return reply(res, 401, { error: 'Permission denied' });
    if (req.method === 'GET' && req.headers.accept?.includes('text/event-stream')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const orderBy = url.searchParams.get('orderBy');
      const equalTo = url.searchParams.get('equalTo');
      const l = { segs, res, where: orderBy && equalTo ? { child: JSON.parse(orderBy) as string, value: JSON.parse(equalTo) as Json } : undefined };
      listeners.add(l);
      sse(res, 'put', { path: '/', data: filtered(l) });
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
    at: (path: string) => getAt(segsOf(path)),
    streams: (path: string) => [...listeners].filter((l) => l.segs.join('/') === segsOf(path).join('/')).length,
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

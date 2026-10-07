import { errText, netLog } from './log';

/**
 * A tiny client for the Firebase Realtime Database REST API (no SDK): read/write JSON at a path, and
 * stream changes with Server-Sent Events. Works the same in browsers and Node (tests).
 *
 * Signed-in data (`users/<uid>/…`, see net/account.ts) is the one part that needs a token: those calls
 * carry the Firebase ID token from `token` as `?auth=` (and are refused, as 401, when there isn't one).
 * Every other path goes without it, on purpose: an expired token is turned away even where the rules are open.
 */

export class RtdbError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
  get denied(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** A change under a streamed path: `path` is relative to it ("/" = the whole value). */
export interface RtdbEvent {
  path: string;
  data: unknown;
  kind: 'put' | 'patch';
}

/** Firebase fills this in with its own clock. */
export const SERVER_TIME = { '.sv': 'timestamp' } as const;

export class Rtdb {
  readonly base: string;

  constructor(
    url: string,
    private readonly token?: () => Promise<string | null>,
  ) {
    this.base = url.replace(/\/+$/, '');
  }

  private url(path: string, query = ''): string {
    return `${this.base}/${path.replace(/^\/+/, '')}.json${query}`;
  }

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    let query = '';
    if (/^\/*users\//.test(path)) {
      const t = await this.token?.();
      if (!t) throw new RtdbError(401, 'Permission denied');
      query = `?auth=${encodeURIComponent(t)}`;
    }
    const res = await fetch(this.url(path, query), {
      method,
      signal: AbortSignal.timeout(10_000),
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      netLog(`db: ${method} ${short(path)} -> ${res.status}`);
      throw new RtdbError(res.status, res.status === 401 || res.status === 403 ? 'Permission denied' : `Database error ${res.status}`);
    }
    return text ? JSON.parse(text) : null;
  }

  /** Can we reach the database at all? (Reads a harmless path.) */
  async reachable(): Promise<boolean> {
    try {
      await this.get('lobby/ping');
      return true;
    } catch (e) {
      netLog(`db: unreachable (${errText(e)})`);
      return false;
    }
  }

  async get<T = unknown>(path: string): Promise<T | null> {
    return (await this.call('GET', path)) as T | null;
  }

  async put(path: string, value: unknown): Promise<void> {
    await this.call('PUT', path, value);
  }

  /** Append under a new, time-ordered key; returns the key. */
  async post(path: string, value: unknown): Promise<string> {
    return ((await this.call('POST', path, value)) as { name: string }).name;
  }

  async patch(path: string, value: Record<string, unknown>): Promise<void> {
    await this.call('PATCH', path, value);
  }

  async remove(path: string): Promise<void> {
    await this.call('DELETE', path);
  }

  /**
   * Stream a path: first the whole value (path "/"), then every change. Reconnects by itself (and so
   * may repeat the whole value), so handlers must cope with seeing things twice. `where` narrows it to
   * the children whose `child` equals `value` (the rules need an `.indexOn` for it).
   */
  stream(path: string, onEvent: (e: RtdbEvent) => void, where?: { child: string; value: string }): { close: () => void } {
    const query = where ? `?orderBy=${encodeURIComponent(JSON.stringify(where.child))}&equalTo=${encodeURIComponent(JSON.stringify(where.value))}` : '';
    const abort = new AbortController();
    let closed = false;
    const run = async (): Promise<void> => {
      while (!closed) {
        try {
          const res = await fetch(this.url(path, query), { headers: { Accept: 'text/event-stream' }, signal: abort.signal });
          if (!res.ok || !res.body) throw new RtdbError(res.status, `stream ${res.status}`);
          netLog(`db: streaming ${short(path)}`);
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          let event = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, nl).replace(/\r$/, '');
              buf = buf.slice(nl + 1);
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) {
                const data = line.slice(5).trim();
                if ((event === 'put' || event === 'patch') && data !== 'null') {
                  const msg = JSON.parse(data) as { path: string; data: unknown };
                  onEvent({ path: msg.path, data: msg.data, kind: event });
                } else if (event === 'cancel' || event === 'auth_revoked') {
                  netLog(`db: stream ${short(path)} ${event}: ${data}`);
                }
              } else if (line === '') event = '';
            }
          }
        } catch (e) {
          if (closed) return;
          netLog(`db: stream ${short(path)} dropped: ${errText(e)}`);
        }
        if (!closed) await new Promise((r) => setTimeout(r, 1000)); // then reconnect
      }
    };
    void run();
    return {
      close: () => {
        closed = true;
        abort.abort();
      },
    };
  }
}

/** Paths are mostly hashes: keep enough to tell them apart in a log. */
function short(path: string): string {
  return path.replace(/[0-9a-f]{24}/g, (h) => `${h.slice(0, 6)}…`);
}

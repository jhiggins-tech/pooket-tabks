/**
 * A small in-memory log of what the online code does (lobby servers, room messages, WebRTC states),
 * for the "Copy logs" button. Addresses are masked so a log is safe to paste into a chat.
 */

const MAX_LINES = 600;
const lines: string[] = [];
const started = Date.now();

export function netLog(...parts: unknown[]): void {
  const t = ((Date.now() - started) / 1000).toFixed(2).padStart(7);
  lines.push(`${t}  ${parts.map((p) => (typeof p === 'string' ? p : safeJson(p))).join(' ')}`);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
}

export function netLogText(): string {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const conn = (nav as unknown as { connection?: { effectiveType?: string; type?: string } } | undefined)?.connection;
  const head = [
    `Pooket Tabks network log — ${new Date().toISOString()}`,
    `page: ${typeof location !== 'undefined' ? location.origin + location.pathname + location.search : '?'}`,
    `browser: ${nav?.userAgent ?? '?'}`,
    `online: ${nav?.onLine ?? '?'}${conn ? `, connection: ${conn.type ?? '?'} / ${conn.effectiveType ?? '?'}` : ''}`,
    `webrtc: ${typeof RTCPeerConnection !== 'undefined'}, websocket: ${typeof WebSocket !== 'undefined'}, crypto: ${!!globalThis.crypto?.subtle}`,
    '',
  ];
  return [...head, ...lines].join('\n');
}

/** Hide most of an address: keep its kind and enough to tell two apart. */
export function maskAddress(a: string): string {
  if (a.endsWith('.local')) return `mdns:${a.slice(0, 4)}…`;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(a)) {
    const [x, y] = a.split('.');
    const priv = x === '10' || x === '192' || (x === '172' && +y! >= 16 && +y! <= 31) || x === '100';
    return `${x}.${y}.x.x${priv ? ' (private)' : ''}`;
  }
  if (a.includes(':')) return `${a.split(':').slice(0, 2).join(':')}:…(v6)`;
  return '?';
}

/** A WebRTC candidate line, summarised: type, protocol, masked address. */
export function describeCandidate(c: string): string {
  const f = c.replace(/^a=/, '').replace(/^candidate:/, '').split(' ');
  return `${f[7] ?? '?'}/${(f[2] ?? '?').toLowerCase()} ${maskAddress(f[4] ?? '')}`;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => netLog('page error:', e.message));
  window.addEventListener('unhandledrejection', (e) => netLog('unhandled rejection:', String((e as PromiseRejectionEvent).reason)));
}

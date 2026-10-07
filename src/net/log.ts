/**
 * A small in-memory log of what the online code does (database calls and streams, rooms, the relay,
 * the match session), for the "Copy logs" button.
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
    `crypto: ${!!globalThis.crypto?.subtle}`,
    '',
  ];
  return [...head, ...lines].join('\n');
}

/** An error's message (or whatever was thrown, as text), for a log line or the screen. */
export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
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

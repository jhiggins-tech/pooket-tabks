/** Room links: `…/pooket-tabks/#room=CODE` opens the game and joins that room. */

export function roomLink(code: string): string {
  return `${location.origin}${location.pathname}#room=${code}`;
}

/** A room code this page was opened with (`#room=`), removed from the address bar. */
export function takeRoomCode(): string | null {
  const m = /#room=([A-Za-z0-9]+)/.exec(location.hash);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return m[1]!;
}

/**
 * A match a notification opened (`#play=<the room's topic>`, see push/templates.ts), from the address
 * bar (removed from it) or a URL the service worker passed on.
 */
export function takePlayRef(url = location.href): string | null {
  const m = /#play=([0-9a-f]{24})/.exec(url);
  if (!m) return null;
  if (url === location.href) history.replaceState(null, '', location.pathname + location.search);
  return m[1]!;
}

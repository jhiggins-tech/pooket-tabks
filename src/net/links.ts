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

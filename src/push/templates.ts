/**
 * What each notification says, from an outbox entry's `type` and `ref` (a room's topic: never its code,
 * which is the key to everything in it). Shared by the page (notified while it's open) and the sender
 * (`notifier/`, run by Node as is: plain TypeScript with nothing to compile away, no imports), so a
 * notification reads the same whichever way it arrives. Entries carry no text of their own: nobody can
 * push words of their choosing to someone else's phone.
 */

export const PUSH_TYPES = ['your-turn', 'joined'] as const;
export type PushType = (typeof PUSH_TYPES)[number];

export interface Rendered {
  title: string;
  body: string;
  /** Relative to the site (GitHub Pages serves it under /pooket-tabks/): opens that match. */
  url: string;
}

/** A room's topic (24 hex digits), as the outbox's `ref`. */
export const REF_PATTERN = /^[0-9a-f]{24}$/;

export function isPushType(type: unknown): type is PushType {
  return typeof type === 'string' && (PUSH_TYPES as readonly string[]).includes(type);
}

/** The notification for an outbox entry, or null if it isn't one we know. */
export function render(type: unknown, ref: unknown): Rendered | null {
  if (!isPushType(type) || typeof ref !== 'string' || !REF_PATTERN.test(ref)) return null;
  const url = `./#play=${ref}`;
  switch (type) {
    case 'your-turn':
      return { title: '🎯 Your turn!', body: 'Your move in Pooket Tabks. Tap to play.', url };
    case 'joined':
      return { title: '🎮 Someone joined your game', body: 'Your game in Pooket Tabks has started. Tap to play.', url };
  }
}

/**
 * What a push carries (JSON, from the sender to the service worker), and what the open page shows: the
 * notification for outbox entry `eventId`. public/sw.js (a classic service worker: no imports) reads it
 * with its own copy of `PUSH_ICON` and `showOptions`; keep them in step.
 */
export interface PushPayload {
  eventId: string;
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** The notifications' icon and badge, relative to the site. */
export const PUSH_ICON = './icon.svg';

/** A notification's tag: one per outbox entry, so the open page's alert and the push are the same notification. */
export const pushTag = (eventId: string): string => `evt-${eventId}`;

export function pushPayload(eventId: string, shown: Rendered): PushPayload {
  return { eventId, title: shown.title, body: shown.body, url: shown.url, tag: pushTag(eventId) };
}

/** The options a payload is shown with (`showNotification(p.title, showOptions(p))`). */
export function showOptions(p: PushPayload): { body: string; tag: string; icon: string; badge: string; data: { url: string; eventId: string } } {
  return { body: p.body, tag: p.tag, icon: PUSH_ICON, badge: PUSH_ICON, data: { url: p.url, eventId: p.eventId } };
}

/**
 * A phone's push subscription, as stored at `pushSubscriptions/<id>` (push/client.ts writes it, with the
 * server's time as `createdAt`; the sender reads it).
 */
export interface SubscriptionRecord<Time = number> {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** The device it's for (net/push.ts `clientId`): outbox entries are addressed by it. */
  clientId: string;
  createdAt: Time;
}

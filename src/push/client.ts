import { netLog } from '../net/log';
import { clientId, wantsPush } from '../net/push';
import { SERVER_TIME, type Rtdb } from '../net/rtdb';
import type { SubscriptionRecord } from './templates';

/**
 * Push notifications on this phone: the service worker (public/sw.js), asking permission (only ever
 * from a tap: a "no" is for good), the subscription and its record in the database
 * (`pushSubscriptions/<the first 32 hex digits of SHA-256(endpoint)>`: a `SubscriptionRecord`,
 * push/templates.ts), which the sender (notifier/) pushes to. Re-synced on every load, as subscriptions can
 * change under us. Off when the VAPID key isn't set (config.ts).
 *
 * On iPhone (any browser: they're all Safari underneath) push only works in the app added to the Home
 * Screen and opened from there; in a browser tab we say how.
 */

/** How notifications stand on this phone, for the 🔔 button. */
export type PushState =
  /** No service workers or push here: the button is hidden. */
  | 'unsupported'
  /** An iPhone or iPad in a browser tab: add to Home Screen first. */
  | 'install'
  /** Not asked yet (or turned off): "Turn on". */
  | 'off'
  | 'on'
  /** Said no: only the browser's site settings can undo it. */
  | 'blocked';

export class PushClient {
  constructor(
    private readonly db: Rtdb | null,
    private readonly vapidKey: string,
  ) {}

  private get supported(): boolean {
    return !!this.db && !!this.vapidKey && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  state(): PushState {
    if (!this.supported) return isIos() && !standalone() && !!this.vapidKey && !!this.db ? 'install' : 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    return Notification.permission === 'granted' && wantsPush() ? 'on' : 'off';
  }

  /** Register the service worker, and (notifications on) make sure the subscription is still there and on record. */
  async start(): Promise<void> {
    if (!this.supported) return;
    try {
      await navigator.serviceWorker.register('./sw.js', { scope: './' });
      if (this.state() === 'on') await this.subscribe();
    } catch (e) {
      netLog(`push: couldn't start (${e instanceof Error ? e.message : e})`);
    }
  }

  /** Turn notifications on. Call straight from a tap (iOS won't ask otherwise). Returns the state after. */
  async enable(): Promise<PushState> {
    if (!this.supported) return this.state();
    const answer = await Notification.requestPermission();
    netLog(`push: permission ${answer}`);
    if (answer !== 'granted') return this.state();
    try {
      await this.subscribe();
      wantsPush(true);
    } catch (e) {
      netLog(`push: couldn't subscribe (${e instanceof Error ? e.message : e})`);
    }
    return this.state();
  }

  async disable(): Promise<PushState> {
    wantsPush(false);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await this.db?.remove(`pushSubscriptions/${await subId(sub.endpoint)}`);
        await sub.unsubscribe();
      }
      netLog('push: turned off');
    } catch (e) {
      netLog(`push: couldn't turn off cleanly (${e instanceof Error ? e.message : e})`);
    }
    return this.state();
  }

  private async subscribe(): Promise<void> {
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64Url(this.vapidKey) }));
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('subscription without keys');
    const record: SubscriptionRecord<typeof SERVER_TIME> = {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      clientId: clientId(),
      createdAt: SERVER_TIME,
    };
    await this.db!.put(`pushSubscriptions/${await subId(json.endpoint)}`, record);
    netLog('push: subscribed');
  }
}

/** A subscription's key in the database: the first 32 hex digits of SHA-256(endpoint). */
export async function subId(endpoint: string): Promise<string> {
  const h = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)));
  return [...h.subarray(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromB64Url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function isIos(): boolean {
  return /iPhone|iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/** Opened from the Home Screen (the manifest asks for fullscreen; iOS may say standalone). */
function standalone(): boolean {
  return (navigator as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
}

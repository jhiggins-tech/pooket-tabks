import { fromB64, toB64 } from './b64';
import { netLog } from './log';
import type { RelayTransport } from './relay';
import type { Rtdb } from './rtdb';
import { seal, sealerFor, unseal } from './seal';
import type { ViewMsg } from './session';

/**
 * A player's spectator feed, written to the room (`view/state`: the latest full state; `view/aim`: the
 * live aim, at most a few times a second). One write at a time per slot, always the newest.
 */
export class ViewPublisher {
  private readonly latest: { state?: ViewMsg; aim?: ViewMsg } = {};
  private readonly busy = { state: false, aim: false };
  private lastAim = 0;
  private aimTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly relay: RelayTransport) {}

  push(v: ViewMsg): void {
    const slot = v.k === 'state' ? 'state' : 'aim';
    this.latest[slot] = v;
    if (slot === 'aim') {
      const wait = 250 - (Date.now() - this.lastAim);
      if (wait > 0) {
        this.aimTimer ??= setTimeout(() => {
          this.aimTimer = null;
          void this.write('aim');
        }, wait);
        return;
      }
    }
    void this.write(slot);
  }

  private async write(slot: 'state' | 'aim'): Promise<void> {
    const v = this.latest[slot];
    if (!v || this.busy[slot]) return;
    this.busy[slot] = true;
    delete this.latest[slot];
    if (slot === 'aim') this.lastAim = Date.now();
    try {
      await this.relay.db.put(`${this.relay.roomPath}/view/${slot}`, toB64(await seal(this.relay.sealer, v)));
    } catch (e) {
      netLog(`view: couldn't publish ${slot} (${e instanceof Error ? e.message : e})`);
    } finally {
      this.busy[slot] = false;
    }
    if (this.latest[slot]) void this.write(slot);
  }
}

/** Watch a room's spectator feed. Resolves once watching; `onEnd` when the room closes. */
export async function watchRoom(db: Rtdb, code: string, onView: (v: ViewMsg) => void, onEnd: () => void): Promise<{ stop: () => void }> {
  const sealer = await sealerFor('room', code);
  const path = `rooms/${sealer.topic}`;
  const host = await db.get<{ id: string; ts: number }>(`${path}/host`);
  if (!host) throw new Error(`No game with code ${code}.`);
  netLog(`watch: watching ${code}`);
  let seen = false;
  let ended = false;
  const take = (v: unknown) => {
    if (typeof v !== 'string') return;
    void unseal(sealer, fromB64(v)).then((m) => {
      if (m && !ended) onView(m as ViewMsg);
    });
  };
  const stream = db.stream(`${path}/view`, (e) => {
    if (e.path === '/') {
      const d = e.data as { state?: unknown; aim?: unknown } | null;
      if (!d) {
        if (seen && !ended) {
          ended = true;
          onEnd();
        }
        return;
      }
      seen = true;
      take(d.state);
      take(d.aim);
    } else if (e.path === '/state') {
      if (e.data === null) {
        if (!ended) {
          ended = true;
          onEnd();
        }
        return;
      }
      seen = true;
      take(e.data);
    } else if (e.path === '/aim') take(e.data);
  });
  return { stop: () => stream.close() };
}

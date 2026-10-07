import { fromB64, toB64 } from './b64';
import { errText, netLog } from './log';
import type { RelayTransport } from './relay';
import { Rtdb } from './rtdb';
import { seal, sealerFor, unseal } from './seal';
import type { ViewMsg } from './session';
import type { RoomRef } from './watchers';
import { LatestWriter } from './writer';

/**
 * A player's spectator feed, written to the room (`view/state`: the latest full state; `view/aim`: the
 * live aim, at most a few times a second). One write at a time per slot, always the newest.
 */
export class ViewPublisher {
  private readonly state: LatestWriter<ViewMsg>;
  private readonly aim: LatestWriter<ViewMsg>;
  /** The newest aim, waiting for its turn (the aim goes out at most every AIM_EVERY_MS). */
  private nextAim: ViewMsg | null = null;
  private lastAim = 0;
  private aimTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(relay: RelayTransport) {
    const writer = (slot: 'state' | 'aim') =>
      new LatestWriter<ViewMsg>(async (v) => relay.db.put(`${relay.roomPath}/view/${slot}`, toB64(await seal(relay.sealer, v))), {
        failed: (e) => netLog(`view: couldn't publish ${slot} (${errText(e)})`),
      });
    this.state = writer('state');
    this.aim = writer('aim');
  }

  push(v: ViewMsg): void {
    if (v.k === 'state') return this.state.save(v);
    this.nextAim = v;
    this.aimTimer ??= setTimeout(() => this.sendAim(), Math.max(0, AIM_EVERY_MS - (Date.now() - this.lastAim)));
  }

  private sendAim(): void {
    this.aimTimer = null;
    if (!this.nextAim) return;
    this.lastAim = Date.now();
    this.aim.save(this.nextAim);
    this.nextAim = null;
  }
}

const AIM_EVERY_MS = 250;

/** Watch a room's spectator feed. Resolves once watching (with the room, for checking in); `onEnd` when the room closes. */
export async function watchRoom(db: Rtdb, code: string, onView: (v: ViewMsg) => void, onEnd: () => void): Promise<{ stop: () => void; room: RoomRef }> {
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
  return { stop: () => stream.close(), room: { db, path, sealer } };
}

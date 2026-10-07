import { byId } from './dom';

/** What's on screen, for the page's flags and the watching buttons. */
export interface Viewing {
  /** Watching someone else's match (live or a replay). */
  spectating: boolean;
  /** The replay being watched, if it's one. */
  replay: { speed: number } | null;
  /** Playing an online match (one that hasn't ended). */
  online: boolean;
}

/**
 * The page's flags for what's on screen (`body[data-spectating]`, `[data-replay]`, `[data-online]`: style.css
 * shows the controls that go with each), and the buttons for watching: 👁 Watching · Leave (▶ Replay · Leave)
 * and a replay's speed (1×, 2×, 4×).
 */
export class ViewingBar {
  private readonly leave = byId('spectate-leave');
  private readonly speed = byId('replay-speed');

  constructor(on: { leave: () => void; replay: () => { speed: number } | null }) {
    this.leave.addEventListener('click', on.leave);
    // A replay can run faster: 1×, 2×, 4×.
    this.speed.addEventListener('click', () => {
      const r = on.replay();
      if (!r) return;
      r.speed = r.speed >= 4 ? 1 : r.speed * 2;
      this.speed.textContent = `${r.speed}×`;
    });
  }

  /** Every frame (it only touches the buttons when a replay starts or stops). */
  update(v: Viewing): void {
    const body = document.body;
    body.dataset.spectating = String(v.spectating);
    const replay = v.replay;
    if (body.dataset.replay !== String(!!replay)) {
      body.dataset.replay = String(!!replay);
      this.leave.textContent = replay ? '▶ Replay · Leave' : '👁 Watching · Leave';
      this.leave.setAttribute('aria-label', replay ? 'Stop the replay' : 'Stop watching');
      this.speed.textContent = `${replay?.speed ?? 1}×`;
    }
    body.dataset.online = String(v.online);
  }
}

/** Waiting in tests: for promises to settle, for a condition, for a networked match's turn to come up. */
import type { NetSession } from '../../src/net/session';

/** Let queued promise callbacks run (a loopback message, a sealed write's next step). */
export async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

/** Wait until `cond` holds (checked every 10 ms), or fail after `ms`. */
export async function until(cond: () => boolean, ms = 8000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** The session's match has reached `turn` and it's aiming (the shot before it has played out). */
export const settled = (s: NetSession, turn: number) => () => !!s.game && s.game.turn === turn && s.game.phase === 'aiming';

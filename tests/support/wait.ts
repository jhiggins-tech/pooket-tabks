/** Waiting in tests: for promises to settle, for a condition (or an async one), for a networked match's turn to come up. */
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

/** Wait until the async `cond` holds (checked every 20 ms, e.g. a read of the database), or fail after `ms`. */
export async function untilAsync(cond: () => Promise<boolean>, ms = 5000): Promise<void> {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** The session's match has reached `turn` and it's aiming (the shot before it has played out). */
export const settled = (s: NetSession, turn: number) => () => !!s.game && s.game.turn === turn && s.game.phase === 'aiming';

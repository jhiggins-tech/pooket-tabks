/** Shared scaffolding for networked-match tests: two phones over a loopback, running phones along, comparing their matches. */
import { expect } from 'vitest';
import { FIXED_DT } from '../../src/game/constants';
import { step } from '../../src/game/game';
import type { GameState, PlayerConfig } from '../../src/game/state';
import { NetSession } from '../../src/net/session';
import { takeSnapshot } from '../../src/net/snapshot';
import { loopback } from '../../src/net/transport';
import { flush } from './wait';

/**
 * Two phones over a loopback, in a match that has started: the host and the guest pick `players[0]` and
 * `players[1]` (their names and characters), and the host starts on `seed` with `players`. `setup` runs on
 * each session first (a store, a listener).
 */
export async function connectedPair(opts: {
  seed: number;
  players: PlayerConfig[];
  onStart: (seed: number, players: PlayerConfig[]) => GameState;
  setup?: (s: NetSession, role: 'host' | 'guest') => void;
}): Promise<{ a: NetSession; b: NetSession; A: GameState; B: GameState }> {
  const [ta, tb] = loopback();
  const a = new NetSession(ta, 'host');
  const b = new NetSession(tb, 'guest');
  for (const [s, role] of [[a, 'host'], [b, 'guest']] as const) {
    s.onStart = opts.onStart;
    opts.setup?.(s, role);
  }
  const [host, guest] = opts.players as [PlayerConfig, PlayerConfig];
  a.setPick({ name: host.name, characterId: host.characterId });
  b.setPick({ name: guest.name, characterId: guest.characterId });
  await flush();
  expect(a.ready && b.ready).toBe(true);
  a.start(opts.seed, opts.players);
  await flush();
  return { a, b, A: a.game!, B: b.game! };
}

/**
 * A phone to run: a session (stepping whatever match it has at each tick), or a session and the match to
 * step alongside it (`null`: none).
 */
export type Phone = NetSession | [NetSession, GameState | null];

/**
 * Tick the phones (and step their matches) until `done`, or fail. `{ seconds }` (the default: 60) counts
 * game time and lets queued promises run between ticks (for a loopback); `{ ms }` counts real time and
 * yields to the event loop between ticks (for the fake Firebase).
 */
export async function runPhones(phones: Phone[], done: () => boolean, limit: { seconds: number } | { ms: number } = { seconds: 60 }): Promise<void> {
  const tick = () => {
    for (const phone of phones) {
      const [s, game] = Array.isArray(phone) ? phone : [phone, phone.game];
      if (game) step(game, FIXED_DT);
      s.tick(FIXED_DT);
    }
  };
  if ('seconds' in limit) {
    for (let t = 0; t < limit.seconds && !done(); t += FIXED_DT) {
      tick();
      await flush();
    }
    if (!done()) throw new Error(`not done after ${limit.seconds}s of play`);
    return;
  }
  const t0 = Date.now();
  while (!done()) {
    tick();
    await new Promise((r) => setTimeout(r, 1));
    if (Date.now() - t0 > limit.ms) throw new Error(`not done after ${limit.ms}ms`);
  }
}

/**
 * Both phones have the same match: the whole snapshot (cosmetics and sound cues are local to each phone and
 * left out of it) and the ground. `ignoreHologramAge`: holograms' ages may differ (the other phone snaps to
 * the result as it was when the shooter's turn ended, while the shooter's own animations kept going).
 */
export function expectSameMatch(a: GameState, b: GameState, opts: { ignoreHologramAge?: boolean } = {}): void {
  const snap = (s: GameState) => {
    const out = takeSnapshot(s) as Record<string, unknown>;
    if (opts.ignoreHologramAge) out.holograms = (out.holograms as Record<string, unknown>[]).map(({ age: _age, ...h }) => h);
    return out;
  };
  expect(snap(b)).toEqual(snap(a));
  expect(b.terrain.solid).toEqual(a.terrain.solid);
}

/**
 * Versions, for online play: two phones playing live must run the same game, and stored matches and
 * replays outlive the build that wrote them.
 *
 * - `WIRE`: the shape of the messages between phones and of what's stored (records, replays). Bump it
 *   when they change in a way an older build can't read.
 * - `RULES`: the game itself (the simulation). Bump it on every gameplay change, balance tweaks included:
 *   two phones playing live must agree on it exactly.
 * - `OLDEST_RULES`: the oldest rules a stored match or replay can carry on under (playing on by this build's
 *   rules). A balance tweak leaves it alone, so matches in progress carry on with the new numbers. When
 *   the state's shape changes, add a fill-in to `upgradeSnapshot` (snapshot.ts) for stored matches; raise
 *   `OLDEST_RULES` to `RULES` only when older matches really can't carry on.
 */
export const WIRE = 7;
export const RULES = 8;
export const OLDEST_RULES = 7;

/** How this build stands with something from another: fine, too old to carry on, or from a newer build (reload). */
export type Compat = 'ok' | 'old' | 'newer';

/**
 * Something written under `wire` by a build on `rules`, about a match started on `startRules` (the same,
 * for a live phone saying hello).
 */
export function compat(wire: number, rules: number | undefined, startRules = rules): Compat {
  if (wire > WIRE || (rules ?? 0) > RULES) return 'newer';
  if (wire < WIRE || rules === undefined || startRules === undefined || startRules < OLDEST_RULES) return 'old';
  return 'ok';
}

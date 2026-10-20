/**
 * Versions, for online play: matches (their records, net/record.ts) and replays outlive the build that
 * wrote them, and the two phones in a match may be on different builds.
 *
 * - `WIRE`: the shape of what's stored (records, replays, the spectator feed). Bump it when it changes in a
 *   way an older build can't read.
 * - `RULES`: the game itself (the simulation). Bump it on every gameplay change, balance tweaks included: a
 *   phone that opens (or is following) a match last written by newer rules is told to reload first, so a
 *   match only ever moves forward onto newer rules.
 * - `OLDEST_RULES`: the oldest rules a stored match or replay can carry on under (playing on by this build's
 *   rules). A balance tweak leaves it alone, so matches in progress carry on with the new numbers. When
 *   the state's shape changes, add a fill-in to `upgradeSnapshot` (snapshot.ts) for stored matches; raise
 *   `OLDEST_RULES` to `RULES` only when older matches really can't carry on.
 */
export const WIRE = 8;
/** Replays' own format (replay.ts): it didn't change when the records did (wire 8), so older replays still play. */
export const REPLAY_WIRE = 7;
export const RULES = 42;
export const OLDEST_RULES = 7;

/** How this build stands with something from another: fine, too old to carry on, or from a newer build (reload). */
export type Compat = 'ok' | 'old' | 'newer';

/** Something written under `wire` (of this build's `current`) by a build on `rules`, about a match started on `startRules`. */
export function compat(wire: number, rules: number | undefined, startRules = rules, current = WIRE): Compat {
  if (wire > current || (rules ?? 0) > RULES) return 'newer';
  if (wire < current || rules === undefined || startRules === undefined || startRules < OLDEST_RULES) return 'old';
  return 'ok';
}

/**
 * Career XP, for signed-in players: earned from rated online matches (both players signed in: the verified
 * matches the ranks go by) and spent unlocking characters (characters/access.ts). Plain TypeScript, shared
 * by the phones and the stats sender: aggregate.ts works out each verified player's XP into the hourly
 * totals, and a phone adds a match it's just played straight away (ui/xp.ts) until the totals catch up.
 *
 * Counted in units: a loss earns 1, a draw 1, a win 2, and every 6 is an unlock. Players see each unit
 * as `shown` XP (+100 a loss, +200 a win, 600 an unlock). A match counts only if it got to turn
 * `minTurns`, so quick resignations can't be farmed for XP. The tuning is all here: change a number and
 * everyone's XP is worked out again from their matches (unlocks already chosen stay chosen).
 */
export const XP = { loss: 1, draw: 1, win: 2, unlock: 6, minTurns: 4, shown: 100 } as const;

/** The XP (units) a match earns a player who scored `score` (1 a win, 0.5 a draw, 0 a loss) over `turns` turns. */
export function xpEarned(score: number, turns: number): number {
  if (turns < XP.minTurns) return 0;
  return score === 1 ? XP.win : score === 0.5 ? XP.draw : XP.loss;
}

/** Where `xp` (units) stands: whole unlocks earned, and how far into the next one (units). */
export function xpProgress(xp: number): { unlocks: number; into: number } {
  const units = Math.max(0, Math.floor(xp));
  return { unlocks: Math.floor(units / XP.unlock), into: units % XP.unlock };
}

/** XP as players see it (units × `shown`). */
export function xpShown(xp: number): number {
  return Math.max(0, Math.floor(xp)) * XP.shown;
}

/**
 * A finished online match, as the stats see it: who played as what, how it ended, and each player's tally
 * (game/tally.ts). Shared by the phones (net/results.ts writes these) and the stats sender
 * (`notifier/stats.ts`, run by Node as is: plain TypeScript, no imports), so both read it the same way.
 *
 * Stored as a JSON string (Firebase would drop empty objects, which would change the fingerprint).
 * `digest` is the fingerprint a signed-in player's phone files in their own account to vouch for it.
 */

export const SUMMARY_VERSION = 1;

/** One player's numbers (the same shape as the game's PlayerTally). */
export interface Tally {
  shots: Record<string, number>;
  hits: Record<string, number>;
  dealt: Record<string, number>;
  taken: number;
  self: number;
  kills: number;
}

export interface MatchSummary {
  v: number;
  /** The match: the room's topic and the map's seed (both phones agree on it). */
  id: string;
  /** The rules it started on (tallies began with rules 15). */
  rules: number;
  turns: number;
  /** How it ended: destroyed, outOfAmmo, resigned, timeout, … (null: the guns decided it). */
  endReason: string | null;
  /** The winning seat (0 host, 1 guest), or null for a draw. */
  winner: number | null;
  players: { name: string; characterId: string; tally: Tally }[];
}

/** A match's id: its room's topic and its seed. */
export function matchId(topic: string, seed: number): string {
  return `${topic}-${Math.abs(Math.trunc(seed)).toString(36)}`;
}

export const MATCH_ID = /^[0-9a-f]{24}-[0-9a-z]{1,16}$/;

/** JSON with every object's keys sorted, so the same summary always reads the same. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** The summary's fingerprint: SHA-256 of its canonical form, in hex. */
export async function digest(s: MatchSummary): Promise<string> {
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(s))));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A tally with whole numbers (damage is counted in fractions along the way). */
export function roundTally(t: Tally): Tally {
  const whole = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).map(([k, n]) => [k, Math.round(n)]));
  return { shots: whole(t.shots), hits: whole(t.hits), dealt: whole(t.dealt), taken: Math.round(t.taken), self: Math.round(t.self), kills: Math.round(t.kills) };
}

/** A stored summary, checked (null if it isn't one). */
export function parseSummary(text: unknown): MatchSummary | null {
  if (typeof text !== 'string' || text.length > 16_000) return null;
  try {
    const s = JSON.parse(text) as MatchSummary;
    const nums = (r: unknown) => !!r && typeof r === 'object' && Object.values(r).every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0);
    const ok =
      s && s.v === SUMMARY_VERSION && typeof s.id === 'string' && MATCH_ID.test(s.id) && typeof s.rules === 'number' && typeof s.turns === 'number' &&
      (s.winner === null || s.winner === 0 || s.winner === 1) && (s.endReason === null || typeof s.endReason === 'string') &&
      Array.isArray(s.players) && s.players.length === 2 &&
      s.players.every((p) => p && typeof p.name === 'string' && p.name.length <= 32 && typeof p.characterId === 'string' && p.tally && nums(p.tally.shots) && nums(p.tally.hits) && nums(p.tally.dealt) && [p.tally.taken, p.tally.self, p.tally.kills].every((n) => typeof n === 'number' && n >= 0));
    return ok ? s : null;
  } catch {
    return null;
  }
}

/** A signed-in player's key in the stats: a hash of their account (never the account itself). */
export async function playerKey(uid: string): Promise<string> {
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`pooket-tabks/stats/${uid}`)));
  return `a:${[...bytes.subarray(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** A player who wasn't signed in: grouped by name. */
export function nameKey(name: string): string {
  return `n:${name.trim().replace(/\s+/g, ' ').toLowerCase()}`;
}

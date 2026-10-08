import { XP, xpShown } from '../stats/xp';
import { getCharacter, isCharacterId, ROSTER } from './roster';

/**
 * Who can play which character where. In a hotseat match on one phone: anyone, betas included. Online:
 * - a character in beta (`CharacterDef.beta`) is hotseat only, for everyone, until it leaves beta;
 * - the starter set (`STARTERS`) is everyone's;
 * - the rest are earned: a signed-in player unlocks them with career XP (stats/xp.ts: an unlock token
 *   every 600 XP, spent on the character they choose; ui/progress.ts), and keeps any they'd already played
 *   in rated matches before unlocks came in. Without signing in there's no XP, so just the starter set.
 *
 * Choose your tank (ui/online/tank.ts) shows a locked one with why (and, with a token, a way to unlock
 * it); the online pick (main.ts) never falls back to one. The app enforces this, not the database.
 */

/** The characters everyone has online, signed in or not. */
export const STARTERS: readonly string[] = ['tones', 'kie', 'kcaj'];

/** What this phone's player has online: whether they're signed in, and the characters that are theirs. */
export interface Access {
  signedIn: boolean;
  /** Characters unlocked (or played in rated matches before unlocks came in), beyond the starter set. */
  owned: ReadonlySet<string>;
  /** Testing: every character open, betas included (app/unlockall.ts). */
  everything?: boolean;
}

/** Not signed in: the starter set. */
export const GUEST: Access = { signedIn: false, owned: new Set() };

/** Why a character can't be played online: in beta (hotseat only), sign in to unlock it, or not unlocked yet. */
export type Lock = 'beta' | 'sign-in' | 'locked';

/** What a lock says, on the tank picker's button and beside the character. */
export const LOCK_TEXT: Record<Lock, { short: string; long: (name: string) => string }> = {
  beta: { short: 'Beta: hotseat only', long: (name) => `${name} is in beta: play them in Local hotseat for now.` },
  'sign-in': { short: 'Sign in to unlock', long: (name) => `Sign in (on the first screen) to earn XP in online matches and unlock ${name}. Everyone can play them in Local hotseat.` },
  locked: {
    short: 'Locked',
    long: (name) => `Unlock ${name} with an unlock token: you earn one every ${xpShown(XP.unlock)} XP from online matches (+${xpShown(XP.win)} a win, +${xpShown(XP.loss)} a loss).`,
  },
};

/** Why `id` can't be played online by a player with `access` (null: it can). */
export function onlineLock(id: string, access: Access): Lock | null {
  if (access.everything) return null;
  if (getCharacter(id).beta) return 'beta';
  if (STARTERS.includes(id)) return null;
  if (!access.signedIn) return 'sign-in';
  return access.owned.has(id) ? null : 'locked';
}

/** `id` if it's a character `access` can play online; else the first one it can (in setup order). */
export function openOnline(id: string | null | undefined, access: Access): string {
  if (id && isCharacterId(id) && !onlineLock(id, access)) return id;
  return ROSTER.find((c) => !onlineLock(c.id, access))!.id;
}

/** The characters `access` could unlock with a token (not in beta, not theirs yet), in setup order. */
export function unlockable(access: Access): string[] {
  return ROSTER.filter((c) => onlineLock(c.id, access) === 'locked').map((c) => c.id);
}

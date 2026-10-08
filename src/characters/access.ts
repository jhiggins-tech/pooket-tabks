import { getCharacter, isCharacterId, ROSTER } from './roster';

/**
 * Who can play which character where. In a hotseat match on one phone, anyone (betas included). Online,
 * a character in beta (`CharacterDef.beta`) is hotseat only, for everyone, until it leaves beta: its
 * stand-in moves are being tried out locally. Choose your tank (ui/online/tank.ts) shows a locked one,
 * with why, and won't go with it; the online pick (main.ts) never falls back to one.
 */

/** Why a character can't be played online: in beta (hotseat only). */
export type Lock = 'beta';

/** What a lock says, on the tank picker's button and beside the character. */
export const LOCK_TEXT: Record<Lock, { short: string; long: (name: string) => string }> = {
  beta: { short: 'Beta: hotseat only', long: (name) => `${name} is in beta: play them in Local hotseat for now.` },
};

/** Why `id` can't be played online (null: it can). */
export function onlineLock(id: string): Lock | null {
  return getCharacter(id).beta ? 'beta' : null;
}

/** `id` if it's a character that can be played online; else the first one that can (in setup order). */
export function openOnline(id: string | null | undefined): string {
  if (id && isCharacterId(id) && !onlineLock(id)) return id;
  return ROSTER.find((c) => !onlineLock(c.id))!.id;
}

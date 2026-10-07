import { readStore, writeStore } from '../../core/storage';
import { profileChanges } from '../profile';

/** The Game browser's remembered settings (localStorage, best effort; they follow a signed-in player). */

export const LISTED_KEY = 'pooket.listPublicly';
export const PAST_KEY = 'pooket.showPast';

/** Whether to put hosted games on the public Games list (remembered; yes unless the player said no). */
export function listPublicly(set?: boolean): boolean {
  if (set !== undefined) {
    if (!writeStore(LISTED_KEY, set ? 'yes' : 'no')) return set; // (storage unavailable: just this once)
    profileChanges.emit('saved');
  }
  return readStore(LISTED_KEY) !== 'no';
}

/** Whether the Game browser shows past matches (remembered; no unless ticked). */
export function showPast(set?: boolean): boolean {
  if (set !== undefined) {
    if (!writeStore(PAST_KEY, set ? 'yes' : 'no')) return set; // (storage unavailable: just this once)
    profileChanges.emit('saved');
  }
  return readStore(PAST_KEY) === 'yes';
}

import { profileChanges } from '../profile';

/** The Game browser's remembered settings (localStorage, best effort; they follow a signed-in player). */

export const LISTED_KEY = 'pooket.listPublicly';
export const PAST_KEY = 'pooket.showPast';

/** Whether to put hosted games on the public Games list (remembered; yes unless the player said no). */
export function listPublicly(set?: boolean): boolean {
  try {
    if (set !== undefined) {
      localStorage.setItem(LISTED_KEY, set ? 'yes' : 'no');
      profileChanges.emit('saved');
    }
    return localStorage.getItem(LISTED_KEY) !== 'no';
  } catch {
    return set ?? true;
  }
}

/** Whether the Game browser shows past matches (remembered; no unless ticked). */
export function showPast(set?: boolean): boolean {
  try {
    if (set !== undefined) {
      localStorage.setItem(PAST_KEY, set ? 'yes' : 'no');
      profileChanges.emit('saved');
    }
    return localStorage.getItem(PAST_KEY) === 'yes';
  } catch {
    return set ?? false;
  }
}

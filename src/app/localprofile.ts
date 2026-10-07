import { isCharacterId } from '../characters/roster';
import { readStore, writeStore } from '../core/storage';
import type { LocalProfile, ProfileData } from '../net/account';
import { LISTED_KEY, PAST_KEY } from '../ui/online/prefs';
import { CHARACTER_KEY, cleanName, USERNAME_KEY } from '../ui/profile';
import { SOUND_KEY } from './sound';

/**
 * This phone's copy of what follows a signed-in player (net/account.ts), straight from and to
 * localStorage. Writing goes round the usual `save…` functions on purpose: those announce a change
 * (to be sent up), and what comes down from the account isn't one.
 */

const read = (key: string): string | undefined => readStore(key) ?? undefined;
const write = (key: string, value: string): void => void writeStore(key, value); // (storage unavailable: it lasts this visit at most)

export const localProfile: LocalProfile = {
  read(): ProfileData {
    const name = cleanName(read(USERNAME_KEY) ?? '');
    const character = read(CHARACTER_KEY);
    const sound = read(SOUND_KEY);
    const listed = read(LISTED_KEY);
    const past = read(PAST_KEY);
    return {
      name: name || undefined,
      character: character && isCharacterId(character) ? character : undefined,
      sound: sound === 'on' || sound === 'off' ? sound : undefined,
      listPublicly: listed === 'yes' || listed === 'no' ? listed : undefined,
      showPast: past === 'yes' || past === 'no' ? past : undefined,
    };
  },

  apply(p: ProfileData): void {
    const name = typeof p.name === 'string' ? cleanName(p.name) : '';
    if (name) write(USERNAME_KEY, name);
    if (typeof p.character === 'string' && isCharacterId(p.character)) write(CHARACTER_KEY, p.character);
    if (p.sound === 'on' || p.sound === 'off') write(SOUND_KEY, p.sound);
    if (p.listPublicly === 'yes' || p.listPublicly === 'no') write(LISTED_KEY, p.listPublicly);
    if (p.showPast === 'yes' || p.showPast === 'no') write(PAST_KEY, p.showPast);
  },
};

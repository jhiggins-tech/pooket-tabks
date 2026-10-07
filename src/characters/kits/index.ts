import { ciarra } from './ciarra';
import { garyoldmancorp } from './garyoldmancorp';
import { kcaj } from './kcaj';
import { kie } from './kie';
import { larinovsky } from './larinovsky';
import { tones } from './tones';
import { torikloud } from './torikloud';

export * from './ciarra';
export * from './garyoldmancorp';
export * from './kcaj';
export * from './kie';
export * from './larinovsky';
export * from './tones';
export * from './torikloud';

/** Every character's kit (the character and their three weapons), in the order the setup screen lists them. */
export const KITS = [tones, kie, kcaj, torikloud, ciarra, larinovsky, garyoldmancorp] as const;

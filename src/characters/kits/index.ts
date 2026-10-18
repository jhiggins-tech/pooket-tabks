import { ciarra } from './ciarra';
import { doctorfox } from './doctorfox';
import { garyoldmancorp } from './garyoldmancorp';
import { kcaj } from './kcaj';
import { kie } from './kie';
import { kiwicore } from './kiwicore';
import { larinovsky } from './larinovsky';
import { shotdownboyz } from './shotdownboyz';
import { tones } from './tones';
import { torikloud } from './torikloud';

export * from './ciarra';
export * from './doctorfox';
export * from './garyoldmancorp';
export * from './kcaj';
export * from './kie';
export * from './kiwicore';
export * from './larinovsky';
export * from './shotdownboyz';
export * from './tones';
export * from './torikloud';

/** Every character's kit (three weapons and an optional bonus move), in setup-screen order. */
export const KITS = [tones, kie, kcaj, torikloud, ciarra, larinovsky, garyoldmancorp, kiwicore, doctorfox, shotdownboyz] as const;

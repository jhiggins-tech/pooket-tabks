import { readStore, writeStore } from '../core/storage';
import type { Params } from './params';

/**
 * Testing: every character open online (betas included), whatever this phone's player has unlocked
 * (characters/access.ts). On for:
 * - this phone, once it's been opened with `?unlockall` (remembered: `?unlockall=off` turns it off again);
 * - a build made with `VITE_UNLOCK_ALL=1` (`VITE_UNLOCK_ALL=1 npm run dev`, say);
 * - automated runs (`navigator.webdriver`), unless they ask for the locks (`?locks`).
 * `shown`: whether the first screen says so (it does, unless it's an automated run's default).
 */

const KEY = 'pooket.unlockAll';

export function unlockAll(params: Pick<Params, 'unlockAll' | 'locks'>): { on: boolean; shown: boolean } {
  if (params.unlockAll) writeStore(KEY, params.unlockAll); // (else it lasts this visit)
  const asked = params.unlockAll === 'on' || (params.unlockAll === null && readStore(KEY) === 'on') || import.meta.env.VITE_UNLOCK_ALL === '1';
  return { on: asked || !params.locks, shown: asked };
}

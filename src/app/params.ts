/**
 * What the page was opened with (the query string), read once. Mostly for automated tests: they run with
 * `navigator.webdriver` set, which skips the what's-new popup and the first-visit name prompt and has
 * player 1 go first, unless they ask otherwise.
 */
export interface Params {
  /** `?seed=N`: the first map (handy for tests and sharing a layout). */
  seed: number | null;
  /** Who goes first: random (from the seed, so both phones agree), or `?first=N` for player N + 1. */
  first: number | 'random';
  /** `?debug`: exposes `window.__pooket`, and allows the test-only options below. */
  debug: boolean;
  /** `?debug&db=URL`: a test database. */
  db: string | null;
  /** `?debug&lobby=NAME`: a Games list of its own (so tests don't see each other's games). */
  lobby: string | null;
  /** `?debug&lost=MS`: notice a quiet phone sooner. */
  lostMs: number | null;
  /** `?debug&vapid=KEY`: a VAPID key, so tests see the notifications button. */
  vapid: string | null;
  /** `?debug&db=URL&fakegoogle=NAME`: sign in as NAME against the test database's stand-in for Google and Firebase Auth. */
  fakeGoogle: string | null;
  /** Show the what's-new popup (`?whatsnew`) and the first-visit name prompt (`?askname`) in a test anyway. */
  whatsNew: boolean;
  askName: boolean;
  /** Testing: `?unlockall` (or `=on`) opens every character online on this phone, `?unlockall=off` stops it (app/unlockall.ts). */
  unlockAll: 'on' | 'off' | null;
  /** An automated run has everything unlocked, unless it asks for the locks (`?locks`). */
  locks: boolean;
}

export function readParams(search: string, automated: boolean): Params {
  const q = new URLSearchParams(search);
  const seed = Number(q.get('seed'));
  const first = q.get('first') ?? (automated ? '0' : 'random');
  const debug = q.has('debug');
  return {
    seed: Number.isFinite(seed) && seed > 0 ? seed : null,
    first: first === 'random' ? 'random' : Number(first) || 0,
    debug,
    db: (debug && q.get('db')) || null,
    lobby: (debug && q.get('lobby')) || null,
    lostMs: debug && q.has('lost') ? Number(q.get('lost')) : null,
    vapid: (debug && q.get('vapid')) || null,
    fakeGoogle: (debug && q.get('db') && q.get('fakegoogle')) || null,
    whatsNew: !automated || q.has('whatsnew'),
    askName: !automated || q.has('askname'),
    unlockAll: q.has('unlockall') ? (q.get('unlockall') === 'off' ? 'off' : 'on') : null,
    locks: !automated || q.has('locks'),
  };
}

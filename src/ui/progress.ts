import { GUEST, unlockable, type Access } from '../characters/access';
import { isCharacterId } from '../characters/roster';
import { Emitter } from '../core/emitter';
import { readJson, writeJson } from '../core/storage';
import { errText, netLog } from '../net/log';
import { SERVER_TIME, type Rtdb } from '../net/rtdb';
import type { StatsSummary } from '../stats/aggregate';
import { xpEarned, xpProgress } from '../stats/xp';

/**
 * This phone's player's career, signed in (a guest has none: the starter set, characters/access.ts):
 * - their XP (stats/xp.ts) as the hourly totals last added it up (`StatsSummary.xp`), or more if they've
 *   finished rated matches here since (`played` adds what each earned at once, remembered here; XP only
 *   goes up, so whichever is more stands, and the totals take over once they've caught up);
 * - the characters that are theirs online: those they've unlocked (their account,
 *   `users/<uid>/unlocks/<id>`, and a copy here so the locks are right before it answers), and any they'd
 *   already played in rated matches (the totals' verified players: kept from before unlocks came in);
 * - their unlock tokens: one every `XP.unlock`, less those spent (`unlock`).
 * `everything` (testing, app/unlockall.ts): every character open online, whatever's unlocked.
 */

/** Who's signed in on this phone: their account, their stats key, and the database as them. */
export interface Me {
  uid: string;
  key: string;
  db: Rtdb;
}

/** What a rated match just earned: XP (units) before and after, and how it went (1 won, 0.5 drew, 0 lost). */
export interface Gain {
  before: number;
  after: number;
  score: number;
  turns: number;
}

const PROVISIONAL_KEY = 'pooket.myXp';
const UNLOCKS_KEY = 'pooket.unlocks';

interface Provisional {
  key: string;
  xp: number;
  at: number;
}

type Totals = Pick<StatsSummary, 'updatedAt'> & Partial<Pick<StatsSummary, 'xp' | 'verified'>>;

export class Progress {
  private totals: Totals | null = null;
  private readonly changes = new Emitter<{ changed: [] }>();
  /** What's remembered here (and kept in storage, where there is any): the unlocks, and the XP since the totals. */
  private mine = readJson(UNLOCKS_KEY) as { uid?: unknown; ids?: unknown } | null;
  private since = readJson(PROVISIONAL_KEY) as Provisional | null;

  constructor(
    private readonly me: () => Me | null,
    private readonly everything = false,
  ) {}

  /** Call `fn` whenever what's open, the XP or the tokens may have changed; returns the function that stops it. */
  onChange(fn: () => void): () => void {
    return this.changes.on('changed', fn);
  }

  /** The hourly totals (as loaded for the ranks, or by the stats viewer). */
  take(s: Totals): void {
    this.totals = s;
    this.changes.emit('changed');
  }

  /** The account's unlocks (on signing in, and each time the game loads). Best effort: the copy here stands meanwhile. */
  async load(): Promise<void> {
    const me = this.me();
    if (!me) return this.changes.emit('changed');
    try {
      const remote = Object.keys((await me.db.get<Record<string, unknown>>(`users/${me.uid}/unlocks`)) ?? {});
      this.remember(me.uid, [...this.unlocked(me), ...remote]);
    } catch (e) {
      netLog(`unlocks: couldn't load them (${errText(e)})`);
    }
    this.changes.emit('changed');
  }

  /** What's open online (characters/access.ts `onlineLock`). */
  access(): Access {
    const me = this.me();
    if (!me) return this.everything ? { ...GUEST, everything: true } : GUEST;
    const played = Object.keys(this.totals?.verified?.players.find((p) => p.key === me.key)?.characters ?? {});
    const owned = new Set([...this.unlocked(me), ...played].filter(isCharacterId));
    return { signedIn: true, owned, ...(this.everything ? { everything: true } : {}) };
  }

  /** Signed in: their XP (units), with any rated matches finished here since the totals. */
  xp(): number | null {
    const me = this.me();
    if (!me) return null;
    const official = this.totals?.xp?.[me.key] ?? 0;
    const p = this.since;
    return p && p.key === me.key && typeof p.xp === 'number' ? Math.max(official, p.xp) : official;
  }

  /** Unlock tokens to spend: one every `XP.unlock`, less those already spent. */
  tokens(): number {
    const me = this.me();
    const xp = this.xp();
    if (!me || xp === null) return 0;
    return Math.max(0, xpProgress(xp).unlocks - this.unlocked(me).length);
  }

  /** The characters a token could unlock now (none with nothing to spend, or with everything open). */
  unlockable(): string[] {
    return this.tokens() > 0 ? unlockable(this.access()) : [];
  }

  /**
   * This phone's player has just finished a rated match: what it earned, added at once (null: not signed
   * in). `score`: 1 won, 0.5 drew, 0 lost; `turns`: how many turns it went (a quick one earns nothing).
   */
  played(score: number, turns: number): Gain | null {
    const me = this.me();
    const before = this.xp();
    if (!me || before === null) return null;
    const after = before + xpEarned(score, turns);
    this.since = { key: me.key, xp: after, at: Date.now() };
    writeJson(PROVISIONAL_KEY, this.since); // (else it lasts this visit: the totals will have it within the hour)
    this.changes.emit('changed');
    return { before, after, score, turns };
  }

  /** Spend a token on `id`: saved to the account, then it's theirs. False if it couldn't be (no token, not lockable, or the save failed). */
  async unlock(id: string): Promise<boolean> {
    const me = this.me();
    if (!me || !this.unlockable().includes(id)) return false;
    try {
      await me.db.put(`users/${me.uid}/unlocks/${id}`, { ts: SERVER_TIME });
    } catch (e) {
      netLog(`unlocks: couldn't save ${id} (${errText(e)})`);
      return false;
    }
    netLog(`unlocks: unlocked ${id}`);
    this.remember(me.uid, [...this.unlocked(me), id]);
    this.changes.emit('changed');
    return true;
  }

  /** The characters this account has unlocked (as remembered here). */
  private unlocked(me: Me): string[] {
    const v = this.mine;
    return v && v.uid === me.uid && Array.isArray(v.ids) ? v.ids.filter((id): id is string => typeof id === 'string' && isCharacterId(id)) : [];
  }

  /** Remember `uid`'s unlocks here (each once). */
  private remember(uid: string, ids: string[]): void {
    this.mine = { uid, ids: [...new Set(ids)].filter(isCharacterId) };
    writeJson(UNLOCKS_KEY, this.mine); // (else they last this visit, and come from the account next time)
  }
}

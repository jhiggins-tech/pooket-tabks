import type { Auth } from './auth';
import { errText, netLog } from './log';
import { SERVER_TIME, type Rtdb } from './rtdb';
import { SerialQueue } from './writer';

/**
 * A signed-in player's profile, kept in the database (`users/<uid>/profile`) so it follows them from
 * phone to phone: their name, last online character and a few settings. Rules (firebase/database.rules.json)
 * let only that account read or write it.
 *
 * Which way it goes (`sync`, on signing in and on every load while signed in):
 * - the account has no profile yet: this phone's goes up;
 * - this phone has never synced as this account: the account's wins and comes down;
 * - otherwise the newer one wins: an account profile written since this phone last synced comes down
 *   (another phone changed it), unless this phone has changes of its own not yet sent (those go up).
 * A change on this phone (`changed`) goes up a moment later. All best effort: offline just means later.
 */

/** What follows the player. Values are as they're kept in localStorage; anything missing stays as it is. */
export interface ProfileData {
  name?: string;
  character?: string;
  sound?: 'on' | 'off';
  listPublicly?: 'yes' | 'no';
  showPast?: 'yes' | 'no';
}

/** This phone's copy of the profile (app/localprofile.ts). `apply` cleans what it's given. */
export interface LocalProfile {
  read(): ProfileData;
  apply(p: ProfileData): void;
}

/** What this phone knows about its last sync (localStorage `pooket.sync`). */
interface Link {
  /** The account it last synced as. */
  uid: string | null;
  /** That profile's `ts` when it did. */
  ts: number;
  /** This phone has changes the account hasn't seen. */
  dirty: boolean;
}

export const LINK_KEY = 'pooket.sync';
const PUSH_DELAY_MS = 1500;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export interface AccountOptions {
  store?: Store | null;
  /** How long after a change before it's sent (so a few quick ones go together). */
  pushDelayMs?: number;
}

export class Account {
  private readonly queue = new SerialQueue();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly store: Store | null;

  constructor(
    private readonly auth: Auth,
    private readonly db: Rtdb,
    private readonly local: LocalProfile,
    /** The account's profile came down onto this phone: refresh whatever shows it. */
    private readonly onApplied: () => void = () => {},
    private readonly opts: AccountOptions = {},
  ) {
    this.store = opts.store === undefined ? safeStorage() : opts.store;
  }

  /** Bring this phone and the account together (see the top). Resolves when done; never throws. */
  sync(): Promise<void> {
    return this.run(async () => {
      const uid = this.auth.uid;
      if (!uid) return;
      const link = this.link();
      const remote = await this.db.get<{ ts?: number } & ProfileData>(`users/${uid}/profile`);
      if (!remote) return void (await this.push(uid));
      if (link.uid !== uid) return this.pull(uid, remote);
      if (link.dirty) return void (await this.push(uid));
      if (typeof remote.ts === 'number' && remote.ts > link.ts) this.pull(uid, remote);
    });
  }

  /** Something that follows the player was saved on this phone: send it soon (once signed in). */
  changed(): void {
    this.setLink({ ...this.link(), dirty: true });
    if (!this.auth.signedIn) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(async () => this.auth.uid && this.link().uid === this.auth.uid && (await this.push(this.auth.uid))), this.opts.pushDelayMs ?? PUSH_DELAY_MS);
  }

  /** Serialised, so a push never overlaps a sync; failures are only logged. */
  private run(job: () => Promise<unknown>): Promise<void> {
    return this.queue.run(job, (e) => netLog(`account: ${errText(e)}`));
  }

  private async push(uid: string): Promise<void> {
    const mine = this.local.read();
    if (Object.values(mine).every((v) => v === undefined)) return;
    await this.db.put(`users/${uid}/profile`, { ...mine, ts: SERVER_TIME });
    const ts = await this.db.get<number>(`users/${uid}/profile/ts`);
    this.setLink({ uid, ts: typeof ts === 'number' ? ts : Date.now(), dirty: false });
    netLog('account: profile sent');
  }

  private pull(uid: string, remote: { ts?: number } & ProfileData): void {
    this.local.apply(remote);
    this.setLink({ uid, ts: typeof remote.ts === 'number' ? remote.ts : 0, dirty: false });
    netLog('account: profile received');
    this.onApplied();
  }

  private link(): Link {
    try {
      const v = JSON.parse(this.store?.getItem(LINK_KEY) ?? 'null') as Partial<Link> | null;
      if (v && (typeof v.uid === 'string' || v.uid === null) && typeof v.ts === 'number') return { uid: v.uid, ts: v.ts, dirty: !!v.dirty };
    } catch {
      /* start over */
    }
    return { uid: null, ts: 0, dirty: false };
  }

  private setLink(link: Link): void {
    try {
      this.store?.setItem(LINK_KEY, JSON.stringify(link));
    } catch {
      /* it'll sync from scratch next time */
    }
  }
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

import { netLog } from './log';

/**
 * Sign in with Google, optionally, without the Firebase SDK: Google's button hands us an ID token (a
 * "credential", see ui/signin.ts), which Firebase's REST sign-in swaps for a Firebase ID token (an hour's
 * worth, sent to the database as `?auth=`), a refresh token and the account's uid. We keep only those
 * (never the Google email or name) in localStorage, and refresh the ID token shortly before it expires.
 * Signed out is the normal state: everything works without an account.
 */

const SESSION_KEY = 'pooket.auth';
/** Refresh this long before the token expires. */
const REFRESH_EARLY_MS = 60_000;

interface Session {
  uid: string;
  idToken: string;
  refreshToken: string;
  /** When idToken stops working (ms). */
  expiresAt: number;
}

export interface AuthOptions {
  apiKey: string;
  /** Firebase's REST endpoints (tests point these at a stand-in). */
  signInUrl?: string;
  refreshUrl?: string;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  now?: () => number;
}

const SIGN_IN_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp';
const REFRESH_URL = 'https://securetoken.googleapis.com/v1/token';

/** What Firebase says when a refresh token will never work again (as opposed to a hiccup). */
const DEAD_TOKEN = /TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_DISABLED|USER_NOT_FOUND|INVALID_GRANT_TYPE|MISSING_REFRESH_TOKEN/;

export class Auth {
  private session: Session | null;
  private refreshing: Promise<string | null> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly storage: NonNullable<AuthOptions['storage']> | null;
  private readonly now: () => number;

  constructor(private readonly opts: AuthOptions) {
    this.now = opts.now ?? Date.now;
    this.storage = opts.storage === undefined ? safeStorage() : opts.storage;
    this.session = this.load();
  }

  /** The signed-in account's uid (the only thing about them we use), or null. */
  get uid(): string | null {
    return this.session?.uid ?? null;
  }

  get signedIn(): boolean {
    return !!this.session;
  }

  /** Called whenever someone signs in or out. Returns the function that stops listening. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Swap Google's ID token for an account (throws with a short reason if Firebase refuses it). */
  async signInWithGoogle(googleIdToken: string): Promise<string> {
    const res = await this.post(`${this.opts.signInUrl ?? SIGN_IN_URL}?key=${encodeURIComponent(this.opts.apiKey)}`, JSON.stringify({
      postBody: `id_token=${encodeURIComponent(googleIdToken)}&providerId=google.com`,
      requestUri: globalThis.location?.origin ?? 'http://localhost',
      returnSecureToken: true,
      returnIdpCredential: true,
    }), 'application/json');
    const body = (await res.json().catch(() => null)) as { localId?: string; idToken?: string; refreshToken?: string; expiresIn?: string; error?: { message?: string } } | null;
    if (!res.ok || !body?.localId || !body.idToken || !body.refreshToken) {
      netLog(`auth: sign-in refused (${res.status} ${body?.error?.message ?? ''})`);
      throw new Error(body?.error?.message ? `Sign-in refused: ${body.error.message}` : `Sign-in failed (${res.status})`);
    }
    this.set({ uid: body.localId, idToken: body.idToken, refreshToken: body.refreshToken, expiresAt: this.now() + Number(body.expiresIn ?? 3600) * 1000 });
    netLog('auth: signed in');
    return body.localId;
  }

  signOut(): void {
    if (!this.session) return;
    netLog('auth: signed out');
    this.set(null);
  }

  /**
   * A token the database accepts, refreshed if it's about to lapse. Null when signed out, or when it
   * can't be refreshed right now (no signal: we stay signed in and try again next time). A refresh
   * token Firebase says is dead signs us out.
   */
  async token(): Promise<string | null> {
    const s = this.session;
    if (!s) return null;
    if (s.expiresAt - this.now() > REFRESH_EARLY_MS) return s.idToken;
    return (this.refreshing ??= this.refresh(s).finally(() => (this.refreshing = null)));
  }

  private async refresh(s: Session): Promise<string | null> {
    try {
      const res = await this.post(`${this.opts.refreshUrl ?? REFRESH_URL}?key=${encodeURIComponent(this.opts.apiKey)}`, `grant_type=refresh_token&refresh_token=${encodeURIComponent(s.refreshToken)}`, 'application/x-www-form-urlencoded');
      const body = (await res.json().catch(() => null)) as { id_token?: string; refresh_token?: string; expires_in?: string; user_id?: string; error?: { message?: string } } | null;
      if (!res.ok) {
        const why = body?.error?.message ?? '';
        netLog(`auth: refresh refused (${res.status} ${why})`);
        if (res.status >= 400 && res.status < 500 && DEAD_TOKEN.test(why)) this.set(null);
        return null;
      }
      if (!body?.id_token || !body.refresh_token) return null;
      // Signed out (or in as someone else) while that was going on: leave it be.
      if (this.session?.uid !== s.uid) return null;
      this.set({ uid: s.uid, idToken: body.id_token, refreshToken: body.refresh_token, expiresAt: this.now() + Number(body.expires_in ?? 3600) * 1000 }, false);
      return body.id_token;
    } catch (e) {
      netLog(`auth: couldn't refresh (${e instanceof Error ? e.message : e})`);
      return null;
    }
  }

  private post(url: string, body: string, contentType: string): Promise<Response> {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': contentType }, body, signal: AbortSignal.timeout(10_000) });
  }

  /** Keep a session (null = signed out). `announce` is false for a quiet token refresh. */
  private set(s: Session | null, announce = true): void {
    const changed = this.session?.uid !== s?.uid;
    this.session = s;
    try {
      if (s) this.storage?.setItem(SESSION_KEY, JSON.stringify(s));
      else this.storage?.removeItem(SESSION_KEY);
    } catch {
      /* private mode etc.: signed in until the page closes */
    }
    if (announce || changed) for (const fn of this.listeners) fn();
  }

  private load(): Session | null {
    try {
      const v = JSON.parse(this.storage?.getItem(SESSION_KEY) ?? 'null') as Partial<Session> | null;
      return v && typeof v.uid === 'string' && typeof v.idToken === 'string' && typeof v.refreshToken === 'string' && typeof v.expiresAt === 'number' ? (v as Session) : null;
    } catch {
      return null;
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

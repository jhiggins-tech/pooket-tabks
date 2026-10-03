import type { Auth } from '../net/auth';
import { netLog } from '../net/log';
import { button, el } from './dom';

/**
 * The optional "Sign in with Google" line on the landing screen. Signed out it's a button; tapping it
 * loads Google's sign-in script (only then, so nothing is fetched from Google by people who never sign
 * in) and swaps itself for Google's own button, which opens the account chooser and hands back an ID
 * token for `Auth.signInWithGoogle`. Signed in it says so, with Sign out. We never show or keep the
 * Google name or email: the player's name is the one they chose.
 *
 * Tests use `fakeGoogle` instead (`?debug&fakegoogle=NAME`): the first tap signs in as NAME straight away.
 */

interface GoogleId {
  initialize(config: { client_id: string; callback: (r: { credential?: string }) => void; auto_select?: boolean }): void;
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
}
declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleId } };
  }
}

const GSI_URL = 'https://accounts.google.com/gsi/client';

let gsi: Promise<GoogleId> | null = null;
/** Google's script, loaded once, on demand. */
function loadGoogle(): Promise<GoogleId> {
  return (gsi ??= new Promise<GoogleId>((resolve, reject) => {
    const s = el('script');
    s.src = GSI_URL;
    s.async = true;
    s.onload = () => {
      const id = window.google?.accounts?.id;
      if (id) resolve(id);
      else reject(new Error("Google's sign-in didn't start"));
    };
    s.onerror = () => reject(new Error("Couldn't reach Google"));
    document.head.append(s);
  }).catch((e: unknown) => {
    gsi = null; // try again next tap
    throw e;
  }));
}

export interface SignInOptions {
  clientId: string;
  fakeGoogle: string | null;
  /** Someone just signed in (sync their profile). */
  onSignedIn: () => void;
}

export class SignInPanel {
  private message = '';
  /** Google's button is showing (after the first tap). */
  private choosing = false;
  /** Google's script has been told who we are (once is enough). */
  private initialised = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly auth: Auth,
    private readonly opts: SignInOptions,
  ) {
    auth.onChange(() => {
      this.choosing = false;
      this.render();
    });
    this.render();
  }

  private render(): void {
    this.root.replaceChildren();
    this.root.hidden = false;
    if (this.auth.signedIn) {
      this.root.append(el('span', 'account-note', '✓ Signed in: your name and settings follow you'), button('Sign out', () => this.auth.signOut(), 'account-btn'));
      return;
    }
    if (this.message) this.root.append(el('span', 'account-note account-error', this.message));
    if (this.choosing) {
      const slot = el('div', 'google-slot');
      this.root.append(slot);
      void this.showGoogleButton(slot);
      return;
    }
    const b = button('🔑 Sign in with Google', () => void this.start(), 'account-btn');
    b.id = 'sign-in';
    b.title = 'Optional: keep your name and settings on every phone';
    this.root.append(b);
  }

  private async start(): Promise<void> {
    this.message = '';
    if (this.opts.fakeGoogle !== null) return this.finish(`fake:${this.opts.fakeGoogle}`);
    this.choosing = true;
    this.render();
  }

  private async showGoogleButton(slot: HTMLElement): Promise<void> {
    try {
      const id = await loadGoogle();
      if (!this.initialised) {
        id.initialize({ client_id: this.opts.clientId, auto_select: false, callback: (r) => void (r.credential ? this.finish(r.credential) : this.fail('Sign-in was cancelled.')) });
        this.initialised = true;
      }
      id.renderButton(slot, { type: 'standard', theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'pill' });
    } catch (e) {
      netLog(`signin: ${e instanceof Error ? e.message : e}`);
      this.fail(e instanceof Error ? `${e.message}. Check your connection and try again.` : 'Sign-in failed.');
    }
  }

  private async finish(credential: string): Promise<void> {
    try {
      await this.auth.signInWithGoogle(credential);
      this.opts.onSignedIn();
    } catch (e) {
      netLog(`signin: ${e instanceof Error ? e.message : e}`);
      this.fail("Couldn't sign in. Try again in a moment.");
    }
  }

  private fail(message: string): void {
    this.message = message;
    this.choosing = false;
    this.render();
  }
}

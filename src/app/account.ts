import { Account } from '../net/account';
import { Auth } from '../net/auth';
import { FIREBASE_API_KEY, GOOGLE_CLIENT_ID, VAPID_PUBLIC_KEY } from '../net/config';
import { accountAddress, registerPushDevice, useAccount, wantsPush } from '../net/push';
import { useResultsAccount } from '../net/results';
import { Rtdb } from '../net/rtdb';
import { seatChanges } from '../net/seat';
import { SeatSync } from '../net/seatsync';
import { PushClient } from '../push/client';
import { notifyWhileOpen } from '../push/foreground';
import { byId } from '../ui/dom';
import { NotifyButton } from '../ui/notify';
import { profileChanges } from '../ui/profile';
import { SignInPanel } from '../ui/signin';
import { localProfile } from './localprofile';
import type { Params } from './params';

/**
 * The page's notifications and optional sign-in, set up once (main.ts):
 * - Notifications ("your turn", "someone joined your game"): push/, net/push.ts, public/sw.js; the 🔔
 *   button, and alerts while the page is open.
 * - Sign in with Google: net/auth.ts, net/account.ts (the profile follows the player), net/seatsync.ts
 *   (and so do their matches), ui/signin.ts; notifications for the account (net/push.ts).
 */
export interface AccountSetup {
  auth: Auth;
  /** A signed-in player's matches from their account (null: no sign-in here). */
  seatSync: SeatSync | null;
}

export function setupAccount(o: {
  /** The database (null: none, so no notifications or sign-in). */
  dbUrl: string | null;
  params: Pick<Params, 'db' | 'fakeGoogle' | 'vapid'>;
  /** The account's profile came down onto this phone: show it (name, sound…). */
  profileApplied: () => void;
  /** The account's matches came down onto this phone. */
  seatsSynced: () => void;
  /** A notification: open its match (`open`), or whether it's about the one on screen (`here`). */
  alerts: { open: (ref: string) => void; here: (ref: string) => boolean };
}): AccountSetup {
  const { params } = o;
  const pushDb = o.dbUrl ? new Rtdb(o.dbUrl) : null;
  const push = new PushClient(pushDb, params.vapid ?? VAPID_PUBLIC_KEY);

  const fakeAuth = params.fakeGoogle !== null && params.db ? params.db : null;
  const auth = new Auth({
    apiKey: FIREBASE_API_KEY,
    ...(fakeAuth ? { signInUrl: `${fakeAuth}/identitytoolkit/signInWithIdp`, refreshUrl: `${fakeAuth}/securetoken/token` } : {}),
  });
  // (A test database has no real accounts: only the fake one, `?fakegoogle`.)
  /** The database as the signed-in player (null: no sign-in here). */
  let userDb: Rtdb | null = null;
  let seatSync: SeatSync | null = null;
  if (o.dbUrl && (fakeAuth || (!params.db && FIREBASE_API_KEY && GOOGLE_CLIENT_ID))) {
    userDb = new Rtdb(o.dbUrl, () => auth.token());
    const account = new Account(auth, userDb, localProfile, o.profileApplied);
    const seats = new SeatSync(auth, userDb, o.seatsSynced);
    seatSync = seats;
    profileChanges.on('saved', () => account.changed());
    seatChanges.on('changed', (code) => seats.changed(code));
    useAccount(() => auth.uid);
    useResultsAccount(() => (userDb && auth.uid ? { uid: auth.uid, db: userDb } : null));
    new SignInPanel(byId('account'), auth, {
      clientId: GOOGLE_CLIENT_ID,
      fakeGoogle: params.fakeGoogle,
      onSignedIn: () => {
        void account.sync();
        void seats.sync();
        void listPhone();
      },
      beforeSignOut: () => listPhone(false),
    });
    void account.sync();
    void seats.sync();
  }
  /** List this phone under the signed-in account as one with notifications on (or take it off). */
  function listPhone(on = push.state() === 'on'): Promise<void> {
    return userDb && auth.uid ? registerPushDevice(userDb, auth.uid, on) : Promise.resolve();
  }
  void push.start().then(() => listPhone());
  new NotifyButton(push, () => void listPhone());
  if (pushDb && wantsPush()) notifyWhileOpen(pushDb, o.alerts);
  // Signed in: what's for the account too (from either match seat, on any of the player's phones).
  let accountAlerts: { stop: () => void } | null = null;
  function followAccount(): void {
    accountAlerts?.stop();
    accountAlerts = pushDb && userDb && auth.uid ? notifyWhileOpen(pushDb, o.alerts, accountAddress(auth.uid)) : null;
  }
  followAccount();
  auth.onChange(followAccount);
  return { auth, seatSync };
}

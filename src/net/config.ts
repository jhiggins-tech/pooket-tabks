/**
 * The Firebase Realtime Database that online rooms go through (free Spark plan; security rules in
 * `firebase/database.rules.json`). Empty = not set up yet: online play says so and hotseat still works.
 * `?debug&db=URL` overrides it (tests use a local stand-in).
 */
export const FIREBASE_DATABASE_URL = 'https://pooket-tanks-default-rtdb.asia-southeast1.firebasedatabase.app';

/**
 * The public half of the VAPID key pair push notifications are signed with (safe to publish; the private
 * half is a GitHub secret only the sender sees: README, "Push notifications"). Empty = notifications off.
 */
export const VAPID_PUBLIC_KEY = '';

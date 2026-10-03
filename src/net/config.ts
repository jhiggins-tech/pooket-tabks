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
export const VAPID_PUBLIC_KEY = 'BOSpIBJgO1BW1B0WMSxI-6fGqcTwA-IT6YGRQyRRtMDZo2NDLPN_-V2--GxHilfWm7_SMKfPjFU-t6Zo5Ziu7nA';

/**
 * Sign in with Google (optional; src/net/auth.ts). Both are public by design: the Firebase project's Web
 * API key (Project settings → General) and the Google OAuth Web client ID (the one Firebase made when
 * Google sign-in was switched on, with `https://jhiggins-tech.github.io` as an authorised JavaScript
 * origin). Empty = no sign-in button.
 */
export const FIREBASE_API_KEY = 'AIzaSyDFAgMSemTYKhd6E6mTkvkKiSkjYS6AJ6Q';
export const GOOGLE_CLIENT_ID = '654066013813-i9bquca9l3ngvchu34f3eehl35s98ju1.apps.googleusercontent.com';

/**
 * The Firebase Realtime Database that online rooms go through (free Spark plan; security rules in
 * `firebase/database.rules.json`). Empty = not set up yet: online play falls back to direct codes.
 * `?debug&db=URL` overrides it (tests use a local stand-in).
 */
export const FIREBASE_DATABASE_URL = 'https://pooket-tanks-default-rtdb.asia-southeast1.firebasedatabase.app';

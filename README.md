# Pooket Tabks

Artillery (Worms / Pocket Tanks style) for **phone browsers**: six characters with their own
three-weapon kits, destructible terrain, kitschy 8-bit sound. Play hotseat on one phone, or on two
phones anywhere with a 4-letter room code (others can watch).

**Play:** https://jhiggins-tech.github.io/pooket-tabks/ (hold your phone in landscape; on iOS,
*Share → Add to Home Screen* gives true fullscreen).

## How to play
- **Start:** the first visit asks your name. The landing screen has the **Game browser** (online) and
  **Local hotseat** (two players on one phone, each picking a character: tones, kie, kcaj, torikloud,
  ciarra, larinovsky). Each kit has 5 rounds of tier 1, 3 of tier 2 and 1 of tier 3 (larinovsky also has
  a bonus move). ⓘ explains every weapon; ✨ shows what's new.
- **Aim:** drag anywhere and pull back like a slingshot: direction is the angle (a full 360°), pull
  length is power. Fine-tune with ↺ ↻ and − +.
- **Move:** hold ◀ ▶ before you fire. One tank of fuel lasts the whole match (ciarra hops instead).
- **FIRE.** Last tank standing wins; if everyone runs out of ammo, most HP wins.
- **Two phones:** in the Game browser, 📶 Host a game shows a room code and a link; the other phone picks
  the game from the browser's table (or types the code, or opens the link). Any live match can be
  watched from the same table. Matches go turn by turn when you're not both there: take your turn, go
  back to the menu, and the other player takes theirs later (your matches head the table; a dot on the
  landing screen counts the turns waiting for you; 3 days a turn).

[FEATURES.md](FEATURES.md) lists everything shipped and what's queued; [CLAUDE.md](CLAUDE.md) has the
architecture and recipes for adding weapons, mechanics and characters.

## Architecture
TypeScript + Vite, a small hand-rolled Canvas2D engine, no runtime dependencies.

```
src/
  core/        seeded RNG, destructible terrain (per-pixel mask + RGBA), terrain generation
  characters/  one kit file per character: the character and their three weapons
  weapons/     weapon types and the registry
  game/        the match: turn state machine + one module per mechanic (pure, DOM-free)
  render/      canvas renderer (letterboxed, DPR-aware) with draw/ mirroring game/, sprites, DOM HUD
  input/       touch controls
  audio/       8-bit synth, sound effects and chiptunes
  net/         online play through Firebase: rooms, relay, match session, spectating, rejoining, replays
  push/        push notifications: subscribing, the templates (shared with notifier/), the open page's alerts
  ui/          setup, info, what's new, online screens
  main.ts      fixed-timestep loop wiring it all together
tests/         Vitest unit tests (Node; a local Firebase stand-in for the online code)
e2e/           Playwright on an emulated landscape phone (incl. multi-phone online flows)
firebase/      database security rules and setup guide
notifier/      the push sender, run every 5 minutes by .github/workflows/notify.yml (not part of the site)
public/sw.js   the service worker: shows pushes, opens the game when one is tapped
```

Game logic is pure and seeded: `?seed=123` reproduces a map.

## Development
```sh
npm install
npm run dev        # Vite dev server (--host, so you can open it on a phone on your LAN)
npm test           # unit tests
npm run test:e2e   # phone-emulated browser tests
npm run build      # typecheck + production build into dist/
```

## Deployment
`.github/workflows/deploy.yml` runs typecheck, unit tests, build and e2e on every push, and deploys
`dist/` to GitHub Pages on pushes to `main`. Online play needs the Firebase database in
`src/net/config.ts` (see `firebase/README.md`).

## Sign in with Google (optional)
The landing screen's "🔑 Sign in with Google" gives a player an account that follows them between phones.
No Firebase SDK: Google's own button (loaded only when someone taps to sign in) hands back an ID token,
Firebase's REST sign-in (`src/net/auth.ts`) swaps it for a Firebase token, and the database sees it as
`?auth=` on `users/<uid>/…` calls only. We keep the uid (never the Google email or name). What follows the
player (`src/net/account.ts`, `users/<uid>/profile`): their name, last online character, sound and the
Game browser ticks (the account's wins on a phone's first sign-in; after that the newer one does), and their
online matches (`src/net/seatsync.ts`, `users/<uid>/games`): a match carries on from any of their phones, and
the phone that opens it last plays while the other stands aside. Their notifications go to the account
(`u:<uid>` in the outbox): every phone of theirs with 🔔 on (`users/<uid>/push`) gets the push, and any with the
game open shows it at once.

One-time setup (done once, by the owner; the keys are public, so they're committed in `src/net/config.ts`):
Firebase console → Authentication → Sign-in method → enable Google (and add `jhiggins-tech.github.io` under
Settings → Authorized domains); Google Cloud console → Credentials → that Web client → authorised JavaScript
origins `https://jhiggins-tech.github.io` (and `http://localhost:5173` for dev); OAuth consent screen
External, **In production** (basic scopes need no review). `FIREBASE_API_KEY` is the project's Web API key
and `GOOGLE_CLIENT_ID` that client. Then publish `firebase/database.rules.json` (it has `users`).
The API key ("Browser key (auto created by Firebase)", Credentials) is restricted to the referrers
`https://jhiggins-tech.github.io/*` and `http://localhost:5173/*` and to the Identity Toolkit API and Token
Service API (the database doesn't use it). A new place the game is served from needs adding there, or sign-in
is refused there ("Requests from referer … are blocked").
Tests use a stand-in for Google and Firebase Auth inside `tests/support/rtdb.ts` (`?debug&db=…&fakegoogle=NAME`).

## Push notifications
Phones that turn notifications on (the 🔔 on the landing screen) hear "your turn" when the other player
has played and they're away, and "someone joined your game" when someone starts their open game. When
the other player should hear about something, the phone in the match adds an entry to the database's
`outbox` (no text, and the room's topic, never its code). An open page shows its entries at once; the
scheduled workflow `.github/workflows/notify.yml` (`notifier/`) pushes the rest within about 5–15
minutes, as Web Push (VAPID; no Firebase Cloud Messaging, no paid plan), and clears the outbox.

### One-time setup (the owner, by hand: never commit the private key or the service account)
1. **VAPID keys**: `npx web-push generate-vapid-keys`. The public key goes in `VAPID_PUBLIC_KEY` in
   `src/net/config.ts` (safe to commit: it switches the 🔔 on); the private key only into a GitHub secret.
2. **Firebase service account**: Firebase console → Project settings → Service accounts → Generate new
   private key (a JSON file).
3. **GitHub** (Settings → Secrets and variables → Actions):

   | Name | Kind | Value |
   |---|---|---|
   | `VAPID_PRIVATE_KEY` | Secret | the private key from step 1 |
   | `FIREBASE_SERVICE_ACCOUNT` | Secret | the whole JSON file from step 2 |
   | `VAPID_PUBLIC_KEY` | Secret or variable | the public key from step 1 |
   | `VAPID_SUBJECT` | Secret or variable | `mailto:` an address the push services can write to |
   | `FIREBASE_DATABASE_URL` | Secret or variable | the database URL in `src/net/config.ts` |

   The workflow does nothing (a quick green run) until both secrets are there.
4. The repo stays **public** (a 5-minute schedule would use up a private repo's free Actions minutes).
5. **Database rules**: publish `firebase/database.rules.json` (Firebase console → Realtime Database →
   Rules): it has `outbox`, `pushSubscriptions` and each room's `devices`.

GitHub pauses a schedule after 60 days without a commit (it emails first); any commit restarts it.
Run it by hand from the Actions tab ("Send push notifications" → Run workflow) to test; to run the sender
locally, put the five values in a git-ignored `notifier/.env` and `cd notifier && npm ci && node --env-file=.env notify.ts`.

**Testing on phones** (desktop emulation can't do background pushes): Android Chrome, and an iPhone on
iOS 16.4+ with the game added to the Home Screen and opened from there. Turn on 🔔 on one phone, start a
match with the other, go back to the menu (or close the app), take a turn on the other phone, then run the
workflow: the notification arrives, and tapping it opens that match. The run's log has counts only.

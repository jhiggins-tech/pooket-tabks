# CLAUDE.md

Pooket Tabks: a Worms / Pocket Tanks style artillery game for **phone browsers only** (landscape, touch),
hosted on GitHub Pages at https://jhiggins-tech.github.io/pooket-tabks/. Six characters, each with a
three-weapon kit (larinovsky has a fourth: a bonus move); hotseat on one phone, or two phones online through Firebase (with spectators).

## Working rules
- The owner has authorised pushing directly to `main` (no branches or PRs unless asked). Every push runs
  CI (typecheck, unit tests, build, Playwright e2e) and deploys to Pages: run
  `npm run typecheck && npm test && npm run test:e2e` before pushing, then check the run and fix it if red.
- `FEATURES.md` is the features list and work queue. Requests to "queue" something go there; shipping
  moves it to **Shipped** (and updates the character table). Balance changes get a **Balance** entry.
- Anything players will notice gets a release in `src/ui/whatsnew.ts` (`CHANGELOG`, newest first, version
  + 1; never edit a release that has already shipped).
- If `firebase/database.rules.json` changes, ask the owner to re-publish it (Firebase console → Rules).
  The code assumes the latest rules; no fallbacks for old ones.

## Commands
```sh
npm run dev        # Vite dev server
npm test           # Vitest unit tests (Node, no DOM)
npm run test:e2e   # Playwright on an emulated landscape Pixel 7; screenshots land in test-results/
npm run build      # tsc --noEmit + vite build -> dist/
```
In cloud containers Playwright uses the preinstalled Chromium at `/opt/pw-browsers/chromium` (see
`playwright.config.ts`); don't run `playwright install`.

## Map
TypeScript + Vite, hand-rolled Canvas2D, no runtime dependencies. Each file starts with a comment saying
what it's for; weapons are documented where they're defined.

| Where | What |
|---|---|
| `src/core/` | seeded RNG (`Rng.state` is serialisable), `Terrain` (per-pixel solid mask + RGBA with dirty rects), terrain generation |
| `src/characters/kits/<name>.ts` | a character **and** their three weapons (`kit()`); `kits/index.ts` lists them in setup order |
| `src/characters/roster.ts` | `ROSTER` (from the kits), ammo per tier (5 / 3 / 1), colour assignment; `upcoming.ts`: Coming soon characters (shown, never playable; a new one's ready: give it a kit and take it off this list) |
| `src/weapons/` | `kinds.ts` (`KINDS`: every kind of weapon, aimed or not, shot / free / bonus), `types.ts` (`WeaponDef`: what every weapon has, plus its kind's spec, as a union by kind; `SpriteId`), `registry.ts` (`getWeapon`, `weaponOf(id, kind)` for a kind's spec, `ignoresAim`, `isBonus`, `blastOf`, the plain `shell`) |
| `src/game/` | the match, pure and DOM-free (below) |
| `src/render/` | `canvas.ts` (`Renderer`: viewport, terrain image, draw order) and `draw/<mechanic>.ts` (mirrors `src/game/`); `hud.ts` (DOM HUD); `sprites.ts` |
| `src/input/` | touch controls: slingshot drag, hold-to-repeat, hold-to-drive, FIRE |
| `src/audio/` | 8-bit synth (`chip.ts`), sound recipes (`sfx.ts`), chiptunes (`tunes.ts`) |
| `src/net/` | online play (below); `auth.ts` + `account.ts` the optional Google sign-in and the profile that follows the player (below) |
| `src/push/` + `notifier/` + `public/sw.js` | push notifications (below) |
| `src/stats/` + `notifier/stats.ts` | the stats: `summary.ts` (a finished match's summary, its fingerprint) and `aggregate.ts` (adding up), plain TypeScript shared with the hourly sender; the viewer is `ui/stats.ts` (below) |
| `src/ui/` | `dom.ts` (typed `el`, `byId`, `button`: use these, not raw `createElement`), `landing.ts` (the first screen), `setup.ts` (Local hotseat), `profile.ts` (the username, asked for on a first visit, and your online character), info (ⓘ), what's new, `online.ts` (`OnlineScreen`: hosting, joining, rejoining, watching, the lobby and match menu; each way in is an attempt, `online/scope.ts`, ended by the next one) and `online/` (its screens: the Game browser, the host screen, Choose your tank, shared widgets) |
| `src/main.ts` | fixed-timestep loop (`FIXED_DT`) wiring it together, one `startMatch`; `src/app/` its helpers (`params.ts`: the query string, read once; `sound.ts`: the sound toggle; `tape.ts`: the match being played, recorded for ▶ Watch replay); `?debug` exposes `window.__pooket` |
| `tests/` | Vitest; `tests/support/game.ts` (match builders), `tests/support/rtdb.ts` (local Firebase stand-in), `tests/support/wait.ts` (`flush`, `until`, `settled`) |
| `e2e/` | `smoke.spec.ts` (every character's kit and the UI), `online.spec.ts` (multi-phone flows, replays) |

## How the game fits together
- **Turn state machine** (`game/game.ts`): `aiming → flying → settling → aiming | gameover` (plus
  `stealing` for kie's roulette). `fire()` spends the round and calls the weapon kind's entry in
  `FIRE` (a `scam` bonus move instead stays in `aiming`); `state.lastShot` is the turn's shot; `step()` advances every `STEPPERS` entry each tick while flying and settles once none is busy;
  `endTurn()` runs statuses, holograms (a hit one blows up as the shot plays out, `hologramBlastStepper`), refunds and picks the next player (skipping the dead and the
  out-of-ammo; if nobody has ammo, most HP wins). `game.ts` re-exports the public API: import from `game/game`.
- **Mechanics** (`game/mechanics.ts`): `FIRE` maps each `WeaponKind` to how it goes off (the type insists
  on one per kind); `STEPPERS` lists what plays out during a shot, **in tick order** (the order is part of
  the simulation). Each mechanic's module (`stream`, `jetpack`, `gunk`, `walkers`, `sonic`, `sew`,
  `runner`, `nap`, `steal`, `scam`, `projectiles`, `copies`) owns its fire function, steppers and rules.
- **Tanks and damage** (`game/tanks.ts`): hit-testing goes through `targetAt()` / `Target` (a tank, a
  twin or a hologram); use `targetPos` / `targetOwner` / `soakTarget` / `tankBodies` rather than
  switching on the kind. A player's tanks (the `Player` itself, and `player.twin`) are `TankBody`s: a
  `Target` is `{ kind: 'tank', player, tank }` or a hologram. **Every mechanic's hits go through
  `applyHit()`** (damage, the weapon's effect flags, friendly fire, refund-on-miss), then
  `damageTarget()` → `hurt()` (floating numbers, a twin taking over). Outgoing damage × the shooter's
  `offence()` (halved while cooked) at every source; incoming × the victim's `vulnerable()` (tattoos).
  Full health is `Player.maxHp` (the character's `maxHp`, else `MAX_HP`). torikloud's twin (`copies.ts`)
  is placed by the player (`Player.twinSpot`, `pendingTwinSpot` / `placeTwin`) and has its own aim
  (`Twin.angle` / `power`; `twinGun` fires with it; `Player.aimTwin` and `aimedTank` say which one
  `setAim` moves). Once Twins is spent, its slot is Yolk Sucker while the twin stands (`yolkTier`,
  `canSuckYolk`, `suckYolk` in copies.ts): `selectTier` and `fire` treat that slot as a bonus move that
  evens out the twins' health; no rounds, so it's invisible to Steal, `hasAmmo` and refunds.
- **Statuses** (`game/statuses.ts`, a table in its header): `afflict()` puts them on from a hit's weapon flags
  (`dot` → burn on the tank hit, `debuff` → cooked, `tattoo`, `pin` → pinned, on the player), `turnEnding`
  / `turnStarting` run their course from `endTurn`, and `offence` / `vulnerable` / `canMove` are what
  they do; burns tick (as damage) in `tickBurn` as their player's turn comes up. `scam` (Women in Scam)
  notes the first enemy hit on the player's tanks in `hurt` and pays out a round of `lastShot`'s weapon
  at the end of the next enemy turn (a new slot on the player's own `loadout` / `ammo`, which can outgrow
  the character's).
- **Movement** (`game/movement.ts`): one tank of fuel per match (`FUEL_PER_MATCH`), driving before
  firing; tanks roll over small lips, stop at slopes > 45° unless the climb is short or they're in a
  hollow (so craters are always escapable). ciarra hops instead (bigger, higher, half the fuel). Pinned
  tanks can't move. Who goes first: `GameConfig.first` (`'random'` in `main.ts`, from the seed).
- **Online** (`src/net/`): phone → Firebase Realtime Database (REST + SSE, `rtdb.ts`) → phone, all sealed
  with AES-GCM from the room code (`seal.ts`). `rooms.ts` seats and codes, `relay.ts` the message pipe
  (numbered batches per epoch, stamped with the sender's seat id; silence = "quiet", not the end),
  `session.ts` the match protocol (`NetSession`, in one `phase`: lobby, rejoining, match, ended; the screens follow it with `on(event)`: the phone whose turn it is streams its aim, sends a
  pre-fire snapshot, then the result snapshot + terrain, which the other phone snaps to; `rejoin` /
  `resume` for a phone that dropped out). Matches are live when both phones are there and **turn by
  turn** when not: `record.ts` is each room's lasting record (`game`: written by the phone in charge at
  start / fire / result), and `NetSession.catchUp` goes by it when nobody answers a rejoin within
  `RESUME_WAIT` (replaying their last shot, or playing out one left in flight and recording it); a match
  records the rules it started on (`MatchSetup.rules`, see Versions);
  `away` (back to the menu: the room stays), `resign`, and `forfeit` after `FORFEIT_MS`. Only leaving the
  lobby (`leave`, 'bye') or Cancel game ends a room. Hosting puts an **open offer** in the same slot
  (`OpenRecord`: the host's pick): the game stays open (and listed, `Advert.open`, up to
  `OPEN_ADVERT_MS`) without its host, and a guest who joins with the host away (`roomHost`) starts the
  match itself (`startIfHostAway`). Hosting and joining someone else's game go through `chooseTank`
  first (sets your online character, `profile.ts`). `view.ts` + `spectate.ts` spectators (`watchers.ts`: who's watching, checked in to the room's `watchers/`, shown by `ui/online/audience.ts`; `follow.ts`: what following someone else's turn shares: previews, `putState`, `shotResolved`), `lobby.ts` the public Games
  list (a host's `Listing`: waiting → playing → over, on/off with the Public/Private toggle, re-listed on
  a host rejoin via `Seat.listed`; `watchLobby` hides stale listings), `replay.ts` replays of public
  matches (`ReplayRecorder`, a GameStore next to the record, writes each shot as fired and the end, by the
  replay id in the match setup, `NetSession.publicReplay`; `loadReplays` is the Game browser's Past
  matches; `ReplayPlayer` plays one back, view only, like a Spectator), `seat.ts` this phone's matches (`matches.ts`: how each stands)
  (listed first in the Game browser, with `left` / `seen` per match). Log every network step with `netLog` (the "Copy
  logs" button; `window.__pooket.log()` in debug). Tests: `?debug&db=URL&lobby=NAME&lost=MS` (each test
  its own Games list).

- **Sign in with Google** (optional; `net/auth.ts`, `net/account.ts`, `ui/signin.ts`, `app/localprofile.ts`): no
  Firebase SDK. Google's button gives an ID token, `Auth.signInWithGoogle` swaps it over Firebase's REST for
  a Firebase token (kept in localStorage with the uid, refreshed by `Auth.token()`), and `Rtdb` (built with a
  token source) sends `?auth=` on `users/…` paths **only** (an expired token is refused even where rules are
  open). `Account` syncs `users/<uid>/profile` (name, character, sound, Game browser ticks) through a
  `LocalProfile`: first sign-in on a phone takes the account's, after that the newer wins, unsent local
  changes win. Anything saved on the phone that should follow the player emits `profileChanges` (`ui/profile.ts`).
  Tests use `?debug&db=URL&fakegoogle=NAME` (a stand-in for Google and Firebase Auth in `tests/support/rtdb.ts`,
  which also enforces "a person's own data is theirs"); no sign-in button on a test database without it.
  A signed-in player's match seats follow them too (`net/seatsync.ts`, `users/<uid>/games/<code>`): seat.ts
  stamps each seat's change time (`at`), keeps notes of forgotten ones and emits `seatChanges`; `takeSeats`
  merges the account's in (newer wins; `left` / `seen` stay per phone). **One phone per seat**: seat claims
  carry the device (`dev`, `clientId`), host check-ins patch only `ts`, and `watchSeat` makes a phone whose
  seat another device took (same id) stand aside quietly (`NetSession.standDown`). Notifications follow the
  account: a signed-in device's record carries `uid` (`useAccount`), `notifySeat` then addresses the outbox
  entry to `u:<uid>` (`accountAddress`), phones with 🔔 on list themselves under `users/<uid>/push/<clientId>`
  (`registerPushDevice`), the sender resolves them (`Store.accountDevices`), and open pages follow both addresses.
- **Stats** (📊 on the landing screen): `game/tally.ts` keeps each player's shots, hits, damage (by weapon)
  and kills in the match state (never read by the simulation; credit goes through `hurt`, burns carry `by`);
  `net/results.ts` files a finished match's summary (`stats/matches/<id>/<seat>`) and, signed in, vouches
  for it (`users/<uid>/results/<id>`: the summary's SHA-256), from `OnlineScreen` and from `matchesOf`;
  `notifier/stats.ts` (hourly, `.github/workflows/stats.yml`) runs `src/stats/aggregate.ts` into
  `stats/summary` (no uids: `playerKey` hashes them); `ui/stats.ts` shows it (the 🏆 Leaderboard tab first:
  `ratings` by rating). A match is verified when both
  seats vouched for the same summary from two accounts. A new weapon kind that never does damage itself
  goes in tally.ts's `HARMLESS`. **Ranks**: `stats/ranks.ts` (`RANKS`, Elo; the hourly sender rates verified
  matches into `stats/summary`'s `ratings`, by player key), `ui/ranks.ts` (`Ratings`: anyone's rank by key,
  and this phone's own rating moved at the end of a rated match until the totals catch up; `noteSeen` so a
  rank-up is celebrated once), `ui/insignia.ts`, `ui/rankup.ts`; a signed-in pick / `PlayerConfig` carries
  the player's `key`.
- **Push notifications**: `net/push.ts` (each phone's `clientId`; `announceDevice` in each room it's
  in; `notifySeat` adds an `outbox` entry for the other seat's device, from `OnlineScreen`: your turn
  when they're away, someone joined), `push/templates.ts` (the words: shared with the sender, plain
  TypeScript Node runs as is), `push/client.ts` (service worker, subscribing, `pushSubscriptions`),
  `push/foreground.ts` (an open page alerts at once; `push/seen.ts` and `public/sw.js` keep one alert per
  entry), `notifier/` (the sender: `drain.ts` is the logic, tested in `tests/notifier.test.ts`; run every
  5 minutes by `.github/workflows/notify.yml`). Owner setup and testing: README, "Push notifications".
  A new kind of notification: its type in `PUSH_TYPES` and `render`, the rules' `type` pattern, and a
  `notifySeat` where it happens.

## Recipes
**Tweak a weapon** (numbers, text): its kit file in `src/characters/kits/`. Keep `info` accurate (the info
screen is built from it). Bump `RULES` (see Versions) unless it's text only. Add a FEATURES **Balance**
entry and a what's-new release.

**Add a weapon using an existing mechanic** (e.g. another ballistic shot):
1. Define it in the character's kit file (`export const x = { … } satisfies WeaponDef`: its `kind` decides
   which spec it must have) and put it in their `kit(…, [t1, t2, t3])` (or `[t1, t2, t3, bonus]`). Effects
   (`dot`, `debuff`, `tattoo`, `pin`, …) work on any kind.
2. `src/audio/sfx.ts`: a `FIRE_SOUNDS` entry (and `ROUND_SOUNDS` if it has a `burst`); tests enforce both.
3. Optional look: an SVG in `src/assets/sprites/`, its id in `SpriteId` (`weapons/types.ts`) and an entry
   in `render/sprites.ts`.
4. Unit tests in the character's test file; update the kit's e2e step in `e2e/smoke.spec.ts`.

**Add a new mechanic** (a new `WeaponKind`):
1. `weapons/kinds.ts`: its row in `KINDS` (aimed? shot, free action or bonus move?) and what it is;
   `weapons/types.ts`: its spec type and its member of the `WeaponDef` union.
2. `game/state.ts`: the entity type and its array on `GameState`; initialise it in `createGame`.
   (Snapshots, sync and spectating copy the whole state, so plain data needs nothing more; stored matches
   need a fill-in in `upgradeSnapshot`.)
3. `game/<mechanic>.ts`: `fire…(state, p, weapon: WeaponOf<'kind'>)` and a `Stepper` (`step` + `busy`;
   look the weapon up with `weaponOf(id, 'kind')`); add them to `FIRE` (or `FREE_ACTIONS`) and `STEPPERS`
   in `game/mechanics.ts` (the types insist). Hits go through `applyHit`.
4. `render/draw/<mechanic>.ts` and its entry in `LAYERS` (`render/canvas.ts`; order = layering).
5. Sounds, info text and tests as above; say what it does in its module's header comment.

**Add a character**: a new kit file (colours, blurb, three weapons, optional `movement`), add it to `KITS`
in `kits/index.ts`, then update `tests/roster.test.ts` and the character list in `e2e/smoke.spec.ts`
(both list every character), add a row to the FEATURES character table and a what's-new release.

**Add a status effect**: its field on `Player` (or `TankBody`, if it's about one tank) and its starting
value in `createGame`; its weapon flag on `WeaponDef` (the effects group); in `game/statuses.ts`: the
table row, `afflict` (put on), `turnEnding` / `turnStarting` (its course) and what it does (a reader like
`canMove`, used where it matters); a fill-in in `upgradeSnapshot` (stored matches); its look in
`render/draw/tank.ts` and badge in `render/hud.ts`; a sound cue; tests in `tests/statuses.test.ts`.

**Add a rank** (e.g. a meme one): a row in `RANKS` (`src/stats/ranks.ts`) where it goes, with the lowest
rating it covers, a new `id`, colours, a shape, a sparkle level and jingle notes. Nothing else: ratings are
stored as numbers, the insignia and jingle come from the row. A new shape needs its path in `ui/insignia.ts`.

**Add a sound cue** for a game event: the cue name in `SfxCue` (`game/state.ts`), `sound(state, cue)` where
it happens (game logic only queues cues), and its recipe in `CUE_SOUNDS` (`audio/sfx.ts`). Keep it kitschy.

**Versions** (`net/version.ts`): any gameplay change (a balance tweak, a mechanic) bumps `RULES`: phones
playing live must match exactly, and an older phone is told to reload. Matches in progress carry on under
the new rules unless you also raise `OLDEST_RULES`; replays from rules older than that are hidden. A
change to the state's shape (a new field) gets a fill-in in `upgradeSnapshot` (`net/snapshot.ts`) for
stored matches and replays, rather than raising `OLDEST_RULES`. A change to
the messages or stored records that an older build can't read bumps `WIRE`.

**Change the online protocol**: `NetMsg` in `net/session.ts`, bump `WIRE` (see Versions), `netLog` the new steps,
test over `loopback()` (`tests/net-session.test.ts`) and the fake Firebase (`tests/rejoin.test.ts`,
`tests/rooms.test.ts`). New database paths need rules (and a re-publish, see above).

## Invariants and gotchas
- **Deterministic**: gameplay randomness only through the seeded RNG (`?seed=N` reproduces a map);
  cosmetic randomness (splashes, floater drift) uses `fxSeq` or `hash`, never the gameplay RNG. Cosmetic
  effects live in `state.fx` (never read by the simulation, not in snapshots: each phone keeps its own);
  gameplay ids come from `state.nextId`. Both
  phones must run identical code, so don't reorder `STEPPERS` or steps casually.
- **Holograms look exactly like the real tank** (no tells: shared shimmer at the end of every turn,
  swap or not), and the swap target is secret online (`NetSession.fire` blanks `swapTargetId` in the
  pre-fire snapshot).
- `targetAt` is the hot path (every projectile, droplet and blob of mud, every ~1px): keep it
  allocation-free.
- Game logic stays DOM-free (sound goes out as queued cues; the renderer only reads state).
- Opening a `#room=` link asks before joining: messaging apps load links in hidden browsers for previews.
- No goodbye on `pagehide`: a reload must be able to rejoin.

## Conventions
- Mobile first: touch/pointer events only, landscape, safe-area insets, big tap targets; keep tanks and
  key action clear of the bottom-corner thumb controls.
- Vite `base` is `'./'`: relative asset paths (Pages serves under `/pooket-tabks/`).
- Unit tests for game logic (build matches with `testGame` and move turns along with `whileFlying`,
  `untilAiming`, `untilNextTurn`, `passTurn`, `hold` from `tests/support/game.ts`); extend
  `e2e/smoke.spec.ts` for new UI flows. Automated runs (`navigator.webdriver`) start with player 1 and
  skip the what's-new popup and the first-visit name prompt unless `?first=` / `?whatsnew` / `?askname`.

# CLAUDE.md

Pooket Tabks: a Worms / Pocket Tanks style artillery game for **phone browsers only** (landscape, touch),
hosted on GitHub Pages at https://jhiggins-tech.github.io/pooket-tabks/. Eight characters, each with a
three-weapon kit (larinovsky and garyoldmancorp have a fourth: a bonus move; garyoldmancorp and kiwicore are
in beta, `CharacterDef.beta`, with stand-in shots); hotseat on one phone, or two phones online through Firebase (with
spectators).

## Working rules
- The owner has authorised pushing directly to `main` (no branches or PRs unless asked). Every push runs
  CI (typecheck, the notifier's typecheck, unit tests, build, Playwright e2e) and deploys to Pages: run
  `npm run typecheck && npm test && npm run test:e2e` before pushing, then check the run and fix it if red.
- `FEATURES.md` is the features list and work queue. Requests to "queue" something go there; shipping
  moves it to **Shipped** (and updates the character table). Balance changes get a **Balance** entry.
- Anything players will notice gets a release in `src/ui/whatsnew.ts` (`CHANGELOG`, newest first, version
  + 1; never edit a release that has already shipped). **Testing pushes** (betas, work in progress, like
  garyoldmancorp's) get no release: the owner calls a roll-up release when there's a batch, and it lists
  them then. (48 was withdrawn: the numbers skip it.)
- **Hidden ranks**: 25 of the 33 ranks (everything but Bronze, Silver, Gold, Platinum, Diamond, Master,
  Grandmaster, Champion) are meant to be *discovered*: never name them (or describe their looks) in
  `whatsnew.ts`, FEATURES.md, README, CLAUDE.md, comments outside `src/stats/ranks.ts`, tests or commit
  messages, until the owner says otherwise. They appear in the game only when a player holds one.
- If `firebase/database.rules.json` changes, ask the owner to re-publish it (Firebase console → Rules).
  The code assumes the latest rules; no fallbacks for old ones.

## Commands
```sh
npm run dev        # Vite dev server
npm test           # Vitest unit tests (Node, no DOM)
npm run test:e2e   # Playwright on an emulated landscape Pixel 7; screenshots land in test-results/
npm run build      # tsc --noEmit + vite build -> dist/
npx tsc -p notifier  # type-check the senders (after npm ci --prefix notifier)
```
In cloud containers Playwright uses the preinstalled Chromium at `/opt/pw-browsers/chromium` (see
`playwright.config.ts`); don't run `playwright install`. Locally the e2e server is reused if one is already
on its port: with several checkouts at once, give each its own (`E2E_PORT=4500 npm run test:e2e`).

## Map
TypeScript + Vite, hand-rolled Canvas2D, no runtime dependencies. Each file starts with a comment saying
what it's for; weapons are documented where they're defined.

| Where | What |
|---|---|
| `src/core/` | seeded RNG (`Rng.state` is serialisable), `Terrain` (per-pixel solid mask + RGBA with dirty rects), terrain generation, `emitter.ts`, `storage.ts` (best-effort localStorage: `readStore` / `writeStore` / `readJson`), `hex.ts` (hex and SHA-256: stored keys depend on it, pinned by tests) |
| `src/characters/kits/<name>.ts` | a character **and** their three weapons (`kit()`); `kits/index.ts` lists them in setup order |
| `src/characters/roster.ts` | `ROSTER` (from the kits), ammo per tier (5 / 3 / 1, `fullAmmo`), colours (`assignColours`, `matchPlayers`); `upcoming.ts`: Coming soon characters (shown, never playable; a new one's ready: give it a kit and take it off this list); `access.ts`: who can play which character online (the starter set, unlocks, betas: hotseat only) |
| `src/weapons/` | `kinds.ts` (`KINDS`: a row per kind of weapon: aimed?, shot / free / bonus, and the columns below), `types.ts` (`WeaponDef`: what every weapon has, plus its kind's spec, as a union by kind; `SpriteId`), `registry.ts` (`getWeapon`, `weaponOf(id, kind)`, `jetSpec`, `ignoresAim`, `isBonus`, `blastOf`, the plain `shell`) |
| `src/game/` | the match, pure and DOM-free (below) |
| `src/render/` | `canvas.ts` (`Renderer`: viewport, terrain image, draw order), `draw/<mechanic>.ts` (mirrors `src/game/`; `context.ts` is what they draw with), `hud.ts` (the DOM HUD: `Hud`, over one module per part in `hud/`, each redrawn only when its key changes: `hud/part.ts`; the hint line is a table in `hud/hint.ts`), `sprites.ts` (`spriteReady`) |
| `src/input/` | touch controls: slingshot drag, hold-to-repeat, hold-to-drive, FIRE |
| `src/audio/` | 8-bit synth (`chip.ts`), sound recipes (`sfx.ts`: `FIRE_SOUNDS`, `ROUND_SOUNDS`, `CUE_SOUNDS`), rank-up jingles (`jingle.ts`, in `score.ts`'s notation), walker chiptunes (`tunes.ts`) |
| `src/net/` | online play, sign-in and the account (below) |
| `src/push/` + `notifier/` + `public/sw.js` | push notifications (below) |
| `src/stats/` + `notifier/stats.ts` | stats and ranks: `summary.ts` (a finished match's summary, its fingerprint), `aggregate.ts` (adding up), `ranks.ts` (the ladder and rating rule), `xp.ts` (career XP: what a match earns, the unlock tuning), `store.ts` (`stats/summary`'s stored format); plain TypeScript shared with the hourly sender |
| `src/ui/` | `dom.ts` (`el`, `byId`, `query`, `button`, `dialog`, `tabBar`, `closeButton`: use these, not raw `createElement`), `landing.ts` (the first screen), `setup.ts` (Local hotseat), `profile.ts` (the username, asked for on a first visit, and your online character), `info.ts` (ⓘ), `whatsnew.ts`, `status-looks.ts` (every status effect's icon, badge and info line), `gameover.ts` (`GameOverCard`), `viewing.ts` (watching/replay buttons and body flags), `stats.ts`, `ranks.ts` / `insignia.ts` / `rankup.ts`, `progress.ts` / `xp.ts` (career XP and unlocks: below), `online.ts` and `online/` (below) |
| `src/main.ts` | fixed-timestep loop (`FIXED_DT`) wiring it together, one `startMatch`; `src/app/` its helpers (`params.ts`: the query string, read once; `sound.ts`: the sound toggle; `tape.ts`: the match being played, recorded for ▶ Watch replay; `account.ts`: sign-in, push and account setup; `battlefield.ts`: taps on the battlefield; `localprofile.ts`; `unlockall.ts`: testing with every character open); `?debug` exposes `window.__pooket` |
| `tests/` | Vitest; `support/game.ts` (match builders and steppers), `support/net.ts` (`connectedPair`, `runPhones`, `expectSameMatch`), `support/rtdb.ts` (local Firebase stand-in), `support/wait.ts` (`flush`, `until`, `untilAsync`, `settled`) |
| `e2e/` | `smoke.spec.ts` (every character's kit and the UI), `online.spec.ts` (multi-phone flows, replays), `support.ts` (the typed `window.__pooket`, `startHotseat`, a `test` that fails on any page error) |

## How the game fits together

### The match (`src/game/`)
- **Turns** (`game.ts`): `aiming → flying → settling → aiming | gameover`, plus `stealing` (kie's Steal
  roulette) and `coffee` (Diced Coffee's spinner), both back to `aiming`, and `drumming` (kiwicore's Band
  Aid: a rhythm minigame between FIRE and the shot, run by the drummer's phone like aiming and streamed in
  its previews; `drums.ts`). `fire()` (gated by `canFire`) spends
  the round and calls the weapon kind's entry in `FIRE` (free actions and bonus moves: `FREE_ACTIONS`, and
  the turn carries on); `state.lastShot` is the turn's shot; `step()` runs `STEPPERS` while flying
  (`runSteppers`) and settles once none is busy (`settleTurn`); `endTurn()` runs statuses, holograms, refunds,
  burns (every turn change) and picks the next player (an `extraTurn` first, then skipping the dead and those
  with nothing to fire: `hasAmmo`; if nobody has anything, most HP wins). `game.ts` re-exports the public
  API: import from `game/game`.
- **Weapon slots** (`loadout.ts`): the one place for what a slot is (`slotAt`: shot, free, bonus, or
  torikloud's Yolk Sucker) and whether it can be used now (`canUseSlot`, `canFire`, `roundKeepsInPlay`);
  `selectTier`, `fire`, `hasAmmo` and the HUD all ask it.
- **Kinds** (`weapons/kinds.ts`): each row says whether it aims, what it does to the turn, and for bonus
  moves how often (`per: 'match' | 'turn'`); `keepsInPlay: false` for rounds that don't keep a player taking
  turns (Diced Coffee); `harmless` for kinds that never do damage themselves (left out of the stats' shots).
- **Mechanics** (`mechanics.ts`): `FIRE` maps each shot kind to how it goes off (the type insists on one
  per kind); `STEPPERS` lists what plays out during a shot, **in tick order** (the order is part of the
  simulation). Each mechanic's module (`stream`, `jetpack`, `gunk`, `walkers`, `sonic`, `sew`, `boomerang`,
  `drums`, `runner`, `nap`, `steal`, `scam`, `coffee`, `projectiles`, `copies`) owns its fire function, steppers and rules, and
  says what it does in its header.
- **Tanks and damage** (`tanks.ts`, `bodies.ts`): hit-testing goes through `targetAt()` / `Target` (a tank,
  a twin or a hologram); use `targetPos` / `targetOwner` / `soakTarget` / `tankBodies` rather than switching
  on the kind. A player's tanks are `TankBody`s (the `Player` itself, and `player.twin`): `bodiesOf(p)`.
  **Hits go through `applyHit()`** (damage, the weapon's effect flags, friendly fire, refund-on-miss) or,
  for hits that soak in (stream droplets, gunk, toxic puddles), `applySoak()` (the same minus effect flags:
  none of those kinds has any), then `damageTarget()` → `hurt()` (floating numbers, a twin taking over).
  Outgoing damage × the shooter's `offence()` (halved while cooked) at every source; incoming × the
  victim's `vulnerable()` (tattoos). Full health is `Player.maxHp`. `bodies.ts` is a leaf (where tanks are,
  `otherBodyNear`, `hullRest`, `settleTurn`), so any module can use it without import cycles.
- **torikloud's twin** (`copies.ts`): placed by the player, with its own aim; every shot fires from each of
  `originsOf(p)` with `gunOf(p, origin)`'s position, angle and power (ballistic and sonic). Spent Twins
  becomes Yolk Sucker while the twin stands (see the module header).
- **Statuses** (`statuses.ts`, a table in its header): `afflict()` puts them on from a hit's weapon flags
  (`dot` → burn on the tank hit, `debuff` → cooked, `tattoo`, `pin` → pinned), `turnEnding` /
  `turnStarting` run their course from `endTurn`, and `offence` / `vulnerable` / `canMove` are what they do;
  burns tick in `tickBurn` at every turn change, whoever's turn it is. Bonus moves with their own bookkeeping
  (Women in Scam: `scam.ts`; Diced Coffee: `coffee.ts`) describe it in their headers.
- **Movement** (`movement.ts`): one tank of fuel per match (`FUEL_PER_MATCH`), driving before firing;
  tanks roll over small lips, stop at slopes > 45° unless the climb is short or they're in a hollow (so
  craters are always escapable). `CharacterDef.movement`: ciarra hops, garyoldmancorp rides a scooter (fast,
  far, and terrain that would stop a tank is a crash: see the module). Pinned tanks can't move. Who goes
  first: `GameConfig.first` (`'random'` in `main.ts`, from the seed).

### Online (`src/net/`, `src/ui/online.ts`, `src/ui/online/`)
- **Pipe**: phone → Firebase Realtime Database (REST + SSE, `rtdb.ts`; `followChildren` for streamed lists)
  → phone, all sealed with AES-GCM from the room code (`seal.ts`). `rooms.ts`: codes, seats (`roomRef`,
  `RoomError`, `watchSeat`), `relay.ts` the message pipe (numbered batches per epoch, stamped with the
  sender's seat id; silence = "quiet", not the end).
- **Match protocol** (`session.ts`, `NetSession`, in one `phase`: lobby, rejoining, match, ended; screens
  follow it with `on(event)`): the phone whose turn it is streams its aim (previews, which carry health),
  sends a pre-fire snapshot, then the result snapshot + terrain, which the other phone snaps to; a shot in
  play and its result are a `ResultBuffer` (`follow.ts`, shared with spectators). Matches are live when both
  phones are there and **turn by turn** when not: `record.ts` is each room's lasting record, and
  `NetSession.catchUp` goes by it when nobody answers a rejoin within `RESUME_WAIT`; a match records the
  rules it started on (`MatchSetup.rules`, see Versions). `away` (back to the menu: the room stays),
  `resign`, `forfeit` after `FORFEIT_MS`; only leaving the lobby (`leave`, 'bye') or Cancel game ends a room.
- **Screens**: `OnlineScreen` (`ui/online.ts`): hosting, joining, rejoining, watching, the lobby and match
  menu; each way in is an attempt (`online/scope.ts`), ended by the next one. A match on this phone is one
  `MatchLink` (`online/match.ts`): it owns the seat, check-ins, the spectator feed, record and replay,
  notifications, listing and result filing, and `end(how)` ends them all (a table of what each way of
  leaving does to the seat, session and listing); `MatchSlot` holds one at a time.
- **Open offers**: hosting puts the host's pick in the room (`OpenRecord`): the game stays open (and listed,
  up to `OPEN_ADVERT_MS`) without its host, and a guest who joins with the host away starts the match itself
  (`startIfHostAway`). Hosting and joining go through `chooseTank` first.
- **Watching, listing, replays**: `view.ts` + `spectate.ts` spectators (`watchers.ts`: who's watching,
  shown by `online/audience.ts`), `lobby.ts` the public Games list (a host's `Listing`: waiting → playing →
  over; `watchCounts` for the landing screen), `replay.ts` replays of public matches (`ReplayRecorder`,
  `loadReplays`, `ReplayPlayer`), `seat.ts` this phone's matches (`matches.ts`: how each stands).
- Log every network step with `netLog` (`errText(e)` for thrown values; the "Copy logs" button;
  `window.__pooket.log()` in debug). Tests: `?debug&db=URL&lobby=NAME&lost=MS` (each test its own Games list).

### Sign in with Google and the account
Optional (`net/auth.ts`, `net/account.ts`, `ui/signin.ts`, `app/account.ts`, `app/localprofile.ts`); no
Firebase SDK. Google's button gives an ID token, `Auth.signInWithGoogle` swaps it over Firebase's REST for a
Firebase token (kept in localStorage, refreshed by `Auth.token()`), and `Rtdb` sends `?auth=` on `users/…`
paths **only** (an expired token is refused even where rules are open). `Account` syncs
`users/<uid>/profile` through a `LocalProfile` (first sign-in on a phone takes the account's, then the
newer wins, unsent local changes win); anything that should follow the player emits `profileChanges`.
Seats follow the account too (`net/seatsync.ts`, `users/<uid>/games/<code>`; `takeSeats` merges, newer
wins). **One phone per seat**: seat claims carry the device (`dev`), and `watchSeat` makes a phone whose
seat another device took stand aside (`NetSession.standDown`). Tests use `?debug&db=URL&fakegoogle=NAME`
(a stand-in for Google and Firebase Auth in `tests/support/rtdb.ts`).

### Stats and ranks (📊 on the landing screen)
`game/tally.ts` keeps each player's shots, hits, damage (by weapon) and kills in the match state (never read
by the simulation; credit goes through `hurt`, burns carry `by`); `net/results.ts` files a finished match's
summary and, signed in, vouches for it (its SHA-256); `notifier/stats.ts` (hourly,
`.github/workflows/stats.yml`) runs `aggregate.ts` into `stats/summary` (`stats/store.ts`; no uids:
`playerKey` hashes them); `ui/stats.ts` shows it (🏆 Leaderboard first). A match is verified when both seats
vouched for the same summary from two accounts. **Ranks**: `stats/ranks.ts` (the ladder and the Elo rule:
see its header), `ui/ranks.ts` (`Ratings`: anyone's rank by key, this phone's own rating moved at the end of a
rated match until the totals catch up, `noteSeen` so a rank-up is celebrated once), `ui/insignia.ts`,
`ui/rankup.ts`.

**XP and unlocks** (signed in): `stats/xp.ts` (what a rated match earns, 1× a loss, 2× a win, 6× an unlock:
the tuning), worked out into the hourly totals (`StatsSummary.xp`) and, for a match just finished, at once
on the phone (`ui/progress.ts` `Progress`: XP, the characters that are theirs online, unlock tokens and
spending them, `users/<uid>/unlocks`). `characters/access.ts` says what's open online (`onlineLock`: the
starter set, unlocks, betas hotseat only; hotseat is all open). `ui/xp.ts` is the XP screen after a rated
match (after the rank-up, main.ts `celebrateMatch`) and the padlock-breaking unlock; sounds in `audio/xp.ts`.
Testing: `?unlockall` (or a `VITE_UNLOCK_ALL=1` build) opens everything (`app/unlockall.ts`).

### Push notifications
`net/push.ts` (each phone's `clientId`; `announceDevice` in each room; `notifySeat` adds an `outbox` entry
for the other seat, addressed to their account `u:<uid>` when signed in), `push/templates.ts` (the words and
the payload, tag and icon: plain TypeScript shared with the sender), `push/client.ts` (service worker,
subscribing), `push/foreground.ts` (an open page alerts at once; `push/seen.ts` and `public/sw.js`, which
keeps its own copies of templates.ts's bits, keep one alert per entry), `notifier/` (the senders: `drain.ts`
is the logic, tested in `tests/notifier.test.ts`; `setup.ts` their shared env and Firebase setup; run every
5 minutes by `.github/workflows/notify.yml`). Owner setup and testing: README, "Push notifications". A new
kind of notification: its type in `PUSH_TYPES` and `render`, the rules' `type` pattern, and a `notifySeat`.

## Recipes
**Tweak a weapon** (numbers, text): its kit file in `src/characters/kits/`. Keep `info` accurate (the info
screen is built from it). Bump `RULES` (see Versions) unless it's text only. Add a FEATURES **Balance**
entry and a what's-new release.

**Add a weapon using an existing mechanic** (e.g. another ballistic shot):
1. Define it in the character's kit file (`export const x = { … } satisfies WeaponDef`: its `kind` decides
   which spec it must have) and put it in their `kit(…, [t1, t2, t3])` (or `[t1, t2, t3, bonus]`). Effects
   (`dot`, `debuff`, `tattoo`, `pin`, …) work on any kind that hits through `applyHit`.
2. `src/audio/sfx.ts`: a `FIRE_SOUNDS` entry (and `ROUND_SOUNDS` if it has a `burst`); tests enforce both.
3. Optional look: an SVG in `src/assets/sprites/`, its id in `SpriteId` (`weapons/types.ts`) and an entry
   in `render/sprites.ts`.
4. Unit tests in the character's test file; update the kit's e2e step in `e2e/smoke.spec.ts`.

**Add a new mechanic** (a new `WeaponKind`):
1. `weapons/kinds.ts`: its row in `KINDS` (aims? shot, free action or bonus move, and how often; does it
   keep a player in play; is it harmless) and what it is; `weapons/types.ts`: its spec type and its member of
   the `WeaponDef` union.
2. `game/state.ts`: the entity type and its array on `GameState`; initialise it in `createGame`.
   (Snapshots, sync and spectating copy the whole state, so plain data needs nothing more; stored matches
   need a fill-in in `upgradeSnapshot`.)
3. `game/<mechanic>.ts`: `fire…(state, p, weapon: WeaponOf<'kind'>)` and a `Stepper` (`step` + `busy`;
   look the weapon up with `weaponOf(id, 'kind')`); add them to `FIRE` (or `FREE_ACTIONS`) and `STEPPERS`
   in `game/mechanics.ts` (the types insist). Hits go through `applyHit` (or `applySoak`).
4. `render/draw/<mechanic>.ts` and its entry in `LAYERS` (`render/canvas.ts`; order = layering).
5. Sounds, info text and tests as above; say what it does in its module's header comment.

**Add a character**: a new kit file (colours, blurb, three weapons, optional `movement`, `beta` while it
has stand-ins), add it to `KITS` in `kits/index.ts` (and take it off `upcoming.ts`), then update
`tests/roster.test.ts` and the character list in `e2e/smoke.spec.ts` (both list every character), add a row
to the FEATURES character table and a what's-new release (not for a beta: see Working rules).

**Add a status effect**: its field on `Player` (or `TankBody`, if it's about one tank) and its starting
value in `createGame`; its weapon flag on `WeaponDef` (the effects group); in `game/statuses.ts`: the
table row, `afflict` (put on), `turnEnding` / `turnStarting` (its course) and what it does (a reader like
`canMove`, used where it matters); a fill-in in `upgradeSnapshot` (stored matches); its look on the tank in
`render/draw/tank.ts`, and its icon, badge and info line in `ui/status-looks.ts`; a sound cue; tests in
`tests/statuses.test.ts`.

**Add a rank** (e.g. a meme one): a row in `ROWS` in `src/stats/ranks.ts`: its header says what a row
needs (the jingle is a little score in `audio/score.ts`'s notation, built up like its neighbours'). Nothing
else: each rank's lowest rating is worked out from its place, so nobody's rating changes. A new shape also
needs its name in `InsigniaShape` and its drawing in `ui/insignia-shapes.ts`.

**Add a sound cue** for a game event: the cue name in `SfxCue` (`game/state.ts`), `sound(state, cue)` where
it happens (game logic only queues cues), and its recipe in `CUE_SOUNDS` (`audio/sfx.ts`, in its group).
Keep it kitschy.

**Versions** (`net/version.ts`): any gameplay change (a balance tweak, a mechanic) bumps `RULES`: phones
playing live must match exactly, and an older phone is told to reload. Matches in progress carry on under
the new rules unless you also raise `OLDEST_RULES`; replays from rules older than that are hidden. A
change to the state's shape (a new field) gets a fill-in in `upgradeSnapshot` (`net/snapshot.ts`) for
stored matches and replays, rather than raising `OLDEST_RULES`. A change to the messages or stored records
that an older build can't read bumps `WIRE`.

**Change the online protocol**: `NetMsg` in `net/session.ts`, bump `WIRE` (see Versions), `netLog` the new
steps, test over `loopback()` (`tests/net-session.test.ts`, with `tests/support/net.ts`) and the fake
Firebase (`tests/rejoin.test.ts`, `tests/rooms.test.ts`). New database paths need rules (and a re-publish,
see above).

## Invariants and gotchas
- **Deterministic**: gameplay randomness only through the seeded RNG (`?seed=N` reproduces a map);
  cosmetic randomness (splashes, floater drift) uses `fxSeq` or `hash`, never the gameplay RNG. Cosmetic
  effects live in `state.fx` (never read by the simulation, not in snapshots: each phone keeps its own);
  gameplay ids come from `state.nextId`. Both phones must run identical code, so don't reorder `STEPPERS` or
  steps casually.
- **Holograms look exactly like the real tank** (no tells: shared shimmer at the end of every turn,
  swap or not), and the swap target is secret online (`NetSession.fire` blanks `swapTargetId` in the
  pre-fire snapshot).
- `targetAt` is the hot path (every projectile, droplet and blob of mud, every ~1px): keep it
  allocation-free (as `otherBodyNear` is, for every pixel of a drive).
- Game logic stays DOM-free (sound goes out as queued cues; the renderer only reads state).
- Stored hashes and keys (`playerKey`, room topics, replay ids, push ids) must stay byte-identical:
  `tests/hashes.test.ts` pins them.
- Opening a `#room=` link asks before joining: messaging apps load links in hidden browsers for previews.
- No goodbye on `pagehide`: a reload must be able to rejoin.

## Conventions
- Mobile first: touch/pointer events only, landscape, safe-area insets, big tap targets; keep tanks and
  key action clear of the bottom-corner thumb controls.
- Vite `base` is `'./'`: relative asset paths (Pages serves under `/pooket-tabks/`).
- localStorage through `core/storage.ts` (keys never change: saved data must survive).
- Unit tests for game logic (build matches with `testGame` and move them along with `whileFlying`,
  `untilAiming`, `untilNextTurn`, `stepUntil`, `passTurn`, `hold` from `tests/support/game.ts`); extend
  `e2e/smoke.spec.ts` for new UI flows (`startHotseat` and the error-checking `test` from `e2e/support.ts`).
  Automated runs (`navigator.webdriver`) start with player 1, skip the what's-new popup and the
  first-visit name prompt, and have every character unlocked online, unless `?first=` / `?whatsnew` /
  `?askname` / `?locks`.

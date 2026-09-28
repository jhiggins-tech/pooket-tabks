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
| `src/characters/roster.ts` | `ROSTER` (from the kits), ammo per tier (5 / 3 / 1), colour assignment |
| `src/weapons/` | `types.ts` (`WeaponDef`, `WeaponKind`, specs, `SpriteId`), `registry.ts` (`getWeapon`, `ignoresAim`, the plain `shell`) |
| `src/game/` | the match, pure and DOM-free (below) |
| `src/render/` | `canvas.ts` (`Renderer`: viewport, terrain image, draw order) and `draw/<mechanic>.ts` (mirrors `src/game/`); `hud.ts` (DOM HUD); `sprites.ts` |
| `src/input/` | touch controls: slingshot drag, hold-to-repeat, hold-to-drive, FIRE |
| `src/audio/` | 8-bit synth (`chip.ts`), sound recipes (`sfx.ts`), chiptunes (`tunes.ts`) |
| `src/net/` | online play (below) |
| `src/ui/` | setup (Player 1 = the saved username, `profile.ts`, asked for on a first visit), info (ⓘ), what's new, online screens |
| `src/main.ts` | fixed-timestep loop (`FIXED_DT`) wiring it together; `?debug` exposes `window.__pooket` |
| `tests/` | Vitest; `tests/support/game.ts` (match builders), `tests/support/rtdb.ts` (local Firebase stand-in) |
| `e2e/` | `smoke.spec.ts` (every character's kit and the UI), `online.spec.ts` (multi-phone flows) |

## How the game fits together
- **Turn state machine** (`game/game.ts`): `aiming → flying → settling → aiming | gameover` (plus
  `stealing` for kie's roulette). `fire()` spends the round and calls the weapon kind's entry in
  `FIRE` (a `scam` bonus move instead stays in `aiming`); `state.lastShot` is the turn's shot; `step()` advances every `STEPPERS` entry each tick while flying and settles once none is busy;
  `endTurn()` runs statuses, holograms, refunds and picks the next player (skipping the dead and the
  out-of-ammo; if nobody has ammo, most HP wins). `game.ts` re-exports the public API: import from `game/game`.
- **Mechanics** (`game/mechanics.ts`): `FIRE` maps each `WeaponKind` to how it goes off (the type insists
  on one per kind); `STEPPERS` lists what plays out during a shot, **in tick order** (the order is part of
  the simulation). Each mechanic's module (`stream`, `jetpack`, `gunk`, `walkers`, `sonic`, `sew`,
  `runner`, `nap`, `steal`, `scam`, `projectiles`, `copies`) owns its fire function, steppers and rules.
- **Tanks and damage** (`game/tanks.ts`): hit-testing goes through `targetAt()` / `Target` (a tank, a
  twin or a hologram); use `targetPos` / `targetOwner` / `soakTarget` / `tankBodies` rather than
  switching on the kind. Damage: `damageTarget()` → `damagePlayer()` (floating numbers). Outgoing damage
  × the shooter's `offence()` (halved while cooked) at every source; incoming × the victim's
  `vulnerable()` (tattoos).
- **Statuses** live in `endTurn`: `cooked` and `pinned` become active when the victim's next turn starts
  and clear when it ends; `tattoo.turnsLeft` counts down per victim turn; Hyperfixate burns tick as the
  victim's turn comes up; `scam` (Women in Scam) notes the first enemy hit on the tank in `damagePlayer`
  and pays out a round of `lastShot`'s weapon at the end of the next enemy turn (a new slot on the
  player's own `loadout` / `ammo`, which can outgrow the character's).
- **Movement** (`game/movement.ts`): one tank of fuel per match (`FUEL_PER_MATCH`), driving before
  firing; tanks roll over small lips, stop at slopes > 45° unless the climb is short or they're in a
  hollow (so craters are always escapable). ciarra hops instead (bigger, higher, half the fuel). Pinned
  tanks can't move. Who goes first: `GameConfig.first` (`'random'` in `main.ts`, from the seed).
- **Online** (`src/net/`): phone → Firebase Realtime Database (REST + SSE, `rtdb.ts`) → phone, all sealed
  with AES-GCM from the room code (`seal.ts`). `rooms.ts` seats and codes, `relay.ts` the message pipe
  (numbered batches per epoch, stamped with the sender's seat id; silence = "quiet", not the end),
  `session.ts` the match protocol (`NetSession`: the phone whose turn it is streams its aim, sends a
  pre-fire snapshot, then the result snapshot + terrain, which the other phone snaps to; `rejoin` /
  `resume` for a phone that dropped out), `view.ts` + `spectate.ts` spectators, `lobby.ts` the public
  Games list (a host's `Listing`: waiting → playing → over, on/off with the Public/Private toggle,
  re-listed on a host rejoin via `Seat.listed`; `watchLobby` hides stale listings), `seat.ts` the
  remembered seat for rejoining. Log every network step with `netLog` (the "Copy logs" button). Tests:
  `?debug&db=URL&lobby=NAME&lost=MS` (each test its own Games list).

## Recipes
**Tweak a weapon** (numbers, text): its kit file in `src/characters/kits/`. Keep `info` accurate (the info
screen is built from it). Add a FEATURES **Balance** entry and a what's-new release.

**Add a weapon using an existing mechanic** (e.g. another ballistic shot):
1. Define it in the character's kit file and put it in their `kit(…, [t1, t2, t3])` (or `[t1, t2, t3, bonus]`).
2. `src/audio/sfx.ts`: a `FIRE_SOUNDS` entry (and `ROUND_SOUNDS` if it has a `burst`); tests enforce both.
3. Optional look: an SVG in `src/assets/sprites/`, its id in `SpriteId` (`weapons/types.ts`) and an entry
   in `render/sprites.ts`.
4. If it ignores the aim, add its kind to `ignoresAim()` (`weapons/registry.ts`).
5. Unit tests in the character's test file; update the kit's e2e step in `e2e/smoke.spec.ts`.

**Add a new mechanic** (a new `WeaponKind`):
1. `weapons/types.ts`: the kind and its spec field on `WeaponDef`.
2. `game/state.ts`: the entity type and its array on `GameState`; initialise it in `createGame`.
   (Snapshots, sync and spectating copy the whole state, so plain data needs nothing more.)
3. `game/<mechanic>.ts`: `fire…(state, p, weapon)` and a `Stepper` (`step` + `busy`); add them to `FIRE`
   and `STEPPERS` in `game/mechanics.ts`.
4. `render/draw/<mechanic>.ts` and a call in `Renderer.draw()` (order = layering).
5. Sounds, info text and tests as above; say what it does in its module's header comment.

**Add a character**: a new kit file (colours, blurb, three weapons, optional `movement`), add it to `KITS`
in `kits/index.ts`, then update `tests/roster.test.ts` and the character list in `e2e/smoke.spec.ts`
(both list every character), add a row to the FEATURES character table and a what's-new release.

**Add a sound cue** for a game event: the cue name in `SfxCue` (`game/state.ts`), `sound(state, cue)` where
it happens (game logic only queues cues), and its recipe in `CUE_SOUNDS` (`audio/sfx.ts`). Keep it kitschy.

**Change the online protocol**: `NetMsg` in `net/session.ts`, bump `PROTOCOL`, `netLog` the new steps,
test over `loopback()` (`tests/net-session.test.ts`) and the fake Firebase (`tests/rejoin.test.ts`,
`tests/rooms.test.ts`). New database paths need rules (and a re-publish, see above).

## Invariants and gotchas
- **Deterministic**: gameplay randomness only through the seeded RNG (`?seed=N` reproduces a map);
  cosmetic randomness (splashes, floater drift) uses `fxSeq` or `hash`, never the gameplay RNG. Both
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

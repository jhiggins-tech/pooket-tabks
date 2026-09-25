# CLAUDE.md

Pooket Tabks: a Worms / Pocket Tanks style artillery game for **phone browsers only** (landscape, touch),
hosted on GitHub Pages at https://jhiggins-tech.github.io/pooket-tabks/.
Scope: local hotseat multiplayer, a variety of weapons, custom player names/colours, random terrain.

## Git workflow
- The owner has authorised pushing directly to `main`. No feature branches or PRs needed unless asked.
- Every push to `main` runs CI (typecheck, unit tests, build, Playwright e2e) and deploys to Pages.
  After pushing, check the run and fix it if it goes red.
- Run `npm run typecheck && npm test && npm run test:e2e` before pushing.

## Commands
```sh
npm run dev        # Vite dev server
npm test           # Vitest unit tests (Node, no DOM)
npm run test:e2e   # Playwright on an emulated landscape Pixel 7; screenshots land in test-results/
npm run build      # tsc --noEmit + vite build -> dist/
```
In cloud containers, Playwright uses the preinstalled Chromium at `/opt/pw-browsers/chromium`
(see `playwright.config.ts`); don't run `playwright install` locally.

## Architecture
TypeScript + Vite, hand-rolled Canvas2D, no runtime dependencies.
- `src/core/`: seeded RNG, `Terrain` (per-pixel solid mask + RGBA buffer with dirty-rect tracking), terrain generation.
- `src/game/`: `game.ts` holds the turn state machine (`aiming → flying → settling → aiming | gameover`)
  and physics, plus ammo/tier selection. Players with no ammo are skipped; if nobody has ammo, highest HP wins.
  Aiming is a full 360° (`normalizeAngle`; 0 = right, 90 = up, 270 = down), so tanks can fire downhill.
  Keep it pure and DOM-free so it stays unit-testable.
- `src/weapons/`: data-driven `WeaponDef`s + registry; a new weapon should be a new definition, not game-loop edits.
  `kind` is `ballistic` (default), `beam` (instant straight line, `dot` burn), `rain` (falls across the
  stage, ignores aim), `stream` (liquid jet with a `stream` pressure profile; droplets trickle damage
  via `Player.soak`, flushed as small batched numbers, and wet the soil instead of cratering) or `decoy`
  (spawns `Hologram`s of the firer's tank; ignores aim). Other optional fields: `volley`, `bounces`/`restitution`, `friendlyFire`, `sprite`
  (SVGs in `src/assets/sprites/`, registered in `src/render/sprites.ts`), `trail`.
- Hit-testing goes through `targetAt()` / `Target` (a real tank or a hologram). Damage goes through
  `damageTarget()` → `damagePlayer()`, which spawns the floating damage numbers. Holograms show the would-be
  damage, and at the end of the turn (`resolveHolograms()`) any hit hologram vanishes and the shooter takes
  `HOLOGRAM_PENALTY` (50%) of it; then the current player's chosen swap (`swapTargetId`) happens.
  Holograms must stay visually identical to the real tank. Cosmetic phase effects: holograms phase in
  (`Hologram.age`), exposed ones dissolve (`ghosts`), and all of a player's copies shimmer together at the
  end of their turn (`shimmers`) whether or not they swapped, so the swap has no tell.
- `src/characters/roster.ts`: selectable characters `tones`, `kie`, `kcaj` (lowercase on purpose), each with
  signature colours and a 3-tier loadout. kie: Shell / Heavy / Trollogram (2 holograms; on later turns tap
  one to secretly swap with it after firing). tones: ten-1 (yellow water jet: pressure builds 0→full over 2s
  in uneven seeded spurts, holds at exactly full for 0.7s, sputters off over 1.2s; see `streamPressure`)
  / Heavy / Mega. kcaj has
  Double Park (two ice cream cones at aim ±2°), Hyperfixate (straight laser beam; a direct hit burns for 8
  at the start of the victim's next 3 turns) and Unmedicated (120 pills rain over the stage, bounce twice,
  micro-detonate; ignores aiming and never hurts kcaj). Ammo is
  5 / 3 / 1 rounds for tiers 1–3 (`AMMO_PER_TIER`). Duplicate picks get distinct alternate colours.
- `src/ui/setup.ts` + `src/ui/seats.ts`: setup screen. PoC matches are exactly 2 players (`PLAYER_COUNT`),
  each picking a character; the name field pre-fills with the character name and stays editable.
  Remembered in localStorage. The engine itself supports more players.
- `src/render/`: letterboxed, DPR-aware canvas renderer and a DOM HUD overlay.
- `src/input/`: touch controls (slingshot drag, hold-to-repeat buttons, FIRE button).
- `src/main.ts`: fixed-timestep loop (`FIXED_DT`) wiring it together. `?debug` exposes `window.__pooket`
  (live state + renderer) for e2e tests that need world positions.

## Conventions
- Mobile first: touch/pointer events only, landscape layout, respect safe-area insets, keep tanks and
  key action clear of the bottom-corner thumb controls. Big tap targets.
- Deterministic: all randomness in game logic goes through the seeded RNG (`?seed=N` reproduces a map).
  Cosmetic-only effects (splashes, floater drift) use `fxSeq`, never the gameplay RNG.
- Vite `base` is `'./'`, so use relative asset paths; Pages serves under `/pooket-tabks/`.
- Add unit tests for game logic changes and extend `e2e/smoke.spec.ts` for new UI flows.

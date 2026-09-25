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
  Keep it pure and DOM-free so it stays unit-testable.
- `src/weapons/`: data-driven `WeaponDef`s + registry; a new weapon should be a new definition, not game-loop edits.
  `kind` is `ballistic` (default), `beam` (instant straight line, `dot` burn), `rain` (falls across the
  stage, ignores aim) or `stream` (liquid jet with a `stream` pressure profile; droplets trickle damage
  via `Player.soak`, flushed as small batched numbers, and wet the soil instead of cratering). Other optional fields: `volley`, `bounces`/`restitution`, `friendlyFire`, `sprite`
  (SVGs in `src/assets/sprites/`, registered in `src/render/sprites.ts`), `trail`.
- All damage goes through `damagePlayer()` in `game.ts`, which spawns the floating damage numbers.
- `src/characters/roster.ts`: selectable characters `tones`, `kie`, `kcaj` (lowercase on purpose), each with
  signature colours and a 3-tier loadout. kie uses the default Shell / Heavy / Mega. tones' tier 1 is ten-1
  (water jet: pressure ramps 0→full over 2s, holds 0.7s, eases off over 1.2s). kcaj has
  Double Park (two ice cream cones at aim ±2°), Hyperfixate (straight laser beam; a direct hit burns for 8
  at the start of the victim's next 3 turns) and Unmedicated (120 pills rain over the stage, bounce twice,
  micro-detonate; ignores aiming and never hurts kcaj). Ammo is
  5 / 3 / 1 rounds for tiers 1–3 (`AMMO_PER_TIER`). Duplicate picks get distinct alternate colours.
- `src/ui/setup.ts` + `src/ui/seats.ts`: setup screen. PoC matches are exactly 2 players (`PLAYER_COUNT`),
  each picking a character; the name field pre-fills with the character name and stays editable.
  Remembered in localStorage. The engine itself supports more players.
- `src/render/`: letterboxed, DPR-aware canvas renderer and a DOM HUD overlay.
- `src/input/`: touch controls (slingshot drag, hold-to-repeat buttons, FIRE button).
- `src/main.ts`: fixed-timestep loop (`FIXED_DT`) wiring it together.

## Conventions
- Mobile first: touch/pointer events only, landscape layout, respect safe-area insets, keep tanks and
  key action clear of the bottom-corner thumb controls. Big tap targets.
- Deterministic: all randomness in game logic goes through the seeded RNG (`?seed=N` reproduces a map).
  Cosmetic-only effects (splashes, floater drift) use `fxSeq`, never the gameplay RNG.
- Vite `base` is `'./'`, so use relative asset paths; Pages serves under `/pooket-tabks/`.
- Add unit tests for game logic changes and extend `e2e/smoke.spec.ts` for new UI flows.

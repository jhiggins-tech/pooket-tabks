# Pooket Tabks

Pass-and-play artillery (Worms / Pocket Tanks style) for **phone browsers**, hosted on GitHub Pages.

**Play:** https://jhiggins-tech.github.io/pooket-tabks/ — hold your phone in landscape. On iOS, *Share → Add to Home Screen* gives true fullscreen.

## How to play
- **Setup:** two players each pick a character (tones, kie or kcaj); the name pre-fills and can be
  changed. Each character has a three-tier loadout: 5 rounds of tier 1, 3 of tier 2 and 1 of tier 3.
- **Weapon:** tap a weapon above FIRE; the dots show rounds left.
- **Aim:** drag anywhere on the battlefield and pull back like a slingshot — direction sets the angle
  (a full 360°, so you can fire down at a tank below you), pull length sets power.
- **Fine-tune:** ↺ / ↻ for angle, − / + for power (hold to repeat).
- **Decoys:** after kie deploys Trollogram, tap one of his holograms on his turn to secretly swap
  places with it once the shot lands. Hitting a hologram costs the shooter half the damage.
- **FIRE**, then pass the phone.

## Architecture
TypeScript + Vite, a small hand-rolled Canvas2D engine, no runtime dependencies.

```
src/
  core/      rng (seeded), terrain (per-pixel destructible mask), terrainGen
  characters/ roster of characters with colours and tiered loadouts
  game/      state types, constants, game.ts (turn state machine + physics, DOM-free)
  weapons/   data-driven weapon defs + registry
  render/    canvas renderer (letterboxed, DPR-aware), DOM HUD
  input/     touch controls (slingshot drag, hold-to-repeat buttons, weapon picker)
  ui/        setup screen
  main.ts    fixed-timestep loop wiring it all together
tests/       Vitest unit tests for terrain + game logic (runs in Node)
e2e/         Playwright smoke tests on an emulated landscape phone
```

Game logic is pure and seeded: `?seed=123` in the URL reproduces a map.

## Development
```sh
npm install
npm run dev        # Vite dev server (--host, so you can open it on a phone on your LAN)
npm test           # unit tests
npm run test:e2e   # phone-emulated browser smoke tests (builds + previews first)
npm run build      # typecheck + production build into dist/
```

## Deployment
`.github/workflows/deploy.yml` runs typecheck, unit tests, build and e2e on every push/PR,
and deploys `dist/` to GitHub Pages on pushes to `main`.
One-time setup: **Settings → Pages → Source: GitHub Actions**.

# Pooket Tabks

Pass-and-play artillery (Worms / Pocket Tanks style) for **phone browsers**, hosted on GitHub Pages.

**Play:** https://jhiggins-tech.github.io/pooket-tabks/ — hold your phone in landscape. On iOS, *Share → Add to Home Screen* gives true fullscreen.

## How to play
- **Aim:** drag anywhere on the battlefield and pull back like a slingshot — direction sets the angle, pull length sets power.
- **Fine-tune:** ↺ / ↻ for angle, − / + for power (hold to repeat).
- **FIRE**, then pass the phone.

## Architecture
TypeScript + Vite, a small hand-rolled Canvas2D engine, no runtime dependencies.

```
src/
  core/      rng (seeded), terrain (per-pixel destructible mask), terrainGen
  game/      state types, constants, game.ts (turn state machine + physics, DOM-free)
  weapons/   data-driven weapon defs + registry
  render/    canvas renderer (letterboxed, DPR-aware), DOM HUD
  input/     touch controls (slingshot drag, hold-to-repeat buttons)
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

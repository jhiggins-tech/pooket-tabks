# Pooket Tabks

Artillery (Worms / Pocket Tanks style) for **phone browsers**: six characters with their own
three-weapon kits, destructible terrain, kitschy 8-bit sound. Play hotseat on one phone, or on two
phones anywhere with a 4-letter room code (others can watch).

**Play:** https://jhiggins-tech.github.io/pooket-tabks/ (hold your phone in landscape; on iOS,
*Share → Add to Home Screen* gives true fullscreen).

## How to play
- **Setup:** each player picks a character (tones, kie, kcaj, torikloud, ciarra, larinovsky); the name
  pre-fills and can be changed. Each kit has 5 rounds of tier 1, 3 of tier 2 and 1 of tier 3.
  ⓘ explains every weapon; ✨ shows what's new.
- **Aim:** drag anywhere and pull back like a slingshot: direction is the angle (a full 360°), pull
  length is power. Fine-tune with ↺ ↻ and − +.
- **Move:** hold ◀ ▶ before you fire. One tank of fuel lasts the whole match (ciarra hops instead).
- **FIRE.** Last tank standing wins; if everyone runs out of ammo, most HP wins.
- **Two phones:** 📶 Host shows a room code and a link; the other phone taps Join (games on the same
  Wi-Fi are listed) or opens the link. A dropped phone can rejoin; a third phone can watch.

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
  net/         online play through Firebase: rooms, relay, match session, spectating, rejoining
  ui/          setup, info, what's new, online screens
  main.ts      fixed-timestep loop wiring it all together
tests/         Vitest unit tests (Node; a local Firebase stand-in for the online code)
e2e/           Playwright on an emulated landscape phone (incl. multi-phone online flows)
firebase/      database security rules and setup guide
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

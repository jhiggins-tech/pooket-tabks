# Features

The running features list and work queue. Newest shipped items first; the **Queue** is worked top-down.

## Queue

1. ✅ **Fuel meter**: shipped (see below).
2. _(empty; next requests go here)_

### Backlog (ideas, not yet scheduled)

- Weapons for **ciarra** and **larinovsky** (currently placeholder Shell / Heavy / Mega).
- **torikloud** tier 1 and tier 3 (currently placeholder Shell / Mega).
- Hide the Trollogram "flat pad" tell: decoys spawn on natural slopes while the real tank starts on a
  flattened pad.
- Sound effects and music.
- Wind.
- More than 2 players per match (the engine already supports it; setup is fixed at 2).

## Shipped

### Core
- **Fuel meter**: each tank has one tank of fuel for the whole match (250px of driving; it never
  refills), usable any time during your turn before firing. Hold ◀ ▶ in the drive bar; the gauge shows
  what's left. Tanks follow the ground: they climb small
  bumps, roll down slopes and drop off ledges, and are stopped by walls, other tanks and decoys, and the
  map edge.
- **360° aiming** with slingshot drag (pull back to aim, pull length = power) plus fine-tune buttons.
- **Floating damage numbers** for every hit, sloping off the tank and fading into the sky.
- Seeded random destructible terrain (`?seed=N` reproduces a map), turn-based hotseat for 2 players,
  5 / 3 / 1 rounds per weapon tier, game over / rematch.
- Phone-first: landscape layout, rotate prompt, fullscreen on Android, Add to Home Screen on iOS.

### Characters
Setup screen: two players each pick a character (the name pre-fills and can be changed); remembered
between visits.

| Character | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| **tones** | ten-1: yellow water jet that builds in spurts, trickle damage | ten-2: shakes for 10s, then jetpacks away on toxic mud | ten-3: short-range chunky spew, intense damage over one turn |
| **kie** | Shell | Weasel Pop: 3 tumbling weasels that walk to the enemy and pop | Trollogram: 2 decoys, secret swap, 50% penalty for hitting one |
| **kcaj** | Double Park: twin ice cream cones | Hyperfixate: straight laser, burns for 3 turns | Unmedicated: pill storm across the stage, bounces twice |
| **torikloud** | Shell (placeholder) | Sonic Boom: sound arcs through terrain, weaker with distance, kookaburra in the sky | Mega (placeholder) |
| **ciarra** | Shell (placeholder) | Heavy (placeholder) | Mega (placeholder) |
| **larinovsky** | Shell (placeholder) | Heavy (placeholder) | Mega (placeholder) |

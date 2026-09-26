# Features

The running features list and work queue. Newest shipped items first; the **Queue** is worked top-down.

## Queue

1. ✅ **Fuel meter**: shipped (see below).
2. ✅ **larinovsky's kit**: Pill Pusher / the Rizzler / Take a Nap, shipped (see below).
3. ✅ **torikloud's Debate and Twins** (plus Sonic Boom crossover), shipped (see below).
4. ✅ **ciarra's kit**: Tattoo Gun / Sew / Marathon plus frog hops, shipped (see below). Every character
   now has their own kit; the placeholder Heavy and Mega shells are gone.
5. _(empty; next requests go here)_

### Backlog (ideas, not yet scheduled)

- Hide the Trollogram "flat pad" tell: decoys spawn on natural slopes while the real tank starts on a
  flattened pad.
- Sound effects and music.
- Wind.
- More than 2 players per match (the engine already supports it; setup is fixed at 2).

## Shipped

### Balance
- **tones buff** (user testing: felt underpowered): ten-2's exhaust is ~3× bigger and much wider (1s at
  900 particles/s, ±43° fan), carpeting ~300px of ground in mud; ten-3's chunks now leave toxic sludge
  that burns enemies touching it at 10 HP/s for the rest of the turn.

### Core
- **Fuel meter**: each tank has one tank of fuel for the whole match (250px of driving; it never
  refills), usable any time during your turn before firing. Hold ◀ ▶ in the drive bar; the gauge shows
  what's left. Tanks follow the ground: they climb small
  bumps, roll down slopes and drop off ledges, and are stopped by walls, other tanks and decoys, and the
  map edge.
- **Frog hops** (ciarra): instead of driving, she hops 24px at a time from the same fuel tank, clearing
  walls up to ~16px that would stop a tank.
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
| **tones** | ten-1: yellow water jet that builds in spurts, trickle damage | ten-2: shakes for 10s, then jetpacks away on a huge, wide blast of toxic mud | ten-3: short-range chunky spew, intense damage over one turn; coats the ground in toxic sludge that burns enemies for the rest of the turn |
| **kie** | Shell | Weasel Pop: 3 tumbling weasels that walk to the enemy and pop | Trollogram: 2 decoys, secret swap, 50% penalty for hitting one |
| **kcaj** | Double Park: twin ice cream cones | Hyperfixate: straight laser, burns for 3 turns | Unmedicated: pill storm across the stage, bounces twice |
| **torikloud** | Debate: a random legal word lobbed one letter at a time (longer word = more damage) | Sonic Boom: sound arcs through terrain, weaker with distance, kookaburra in the sky; with a twin, crossing waves phase for ×1.5 damage and range | Twins: a second tank with half his HP and its own bar; it mirrors every shot (Debate from a social-work dictionary) |
| **ciarra** (moves in frog hops) | Tattoo Gun: a burst of 12 ink needles; enemies hit are tattooed and take +25% damage from everything until the end of their next 2 turns | Sew: a needle and thread stitch straight through terrain (power = length, no crater), 20 damage and pins the enemy so they can't move on their next turn | Marathon: a runner jogs one leg towards the nearest enemy every time anyone fires, over any hill, and explodes for 50 at the finish; a blast near them is a DNF |
| **larinovsky** | Pill Pusher: indirect fire, a series of 4 lobbed pills that walk across the target | the Rizzler: blast "cooks" enemies, who deal half damage on their next turn | Take a Nap: doze for 2s, wake at full health |

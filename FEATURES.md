# Features

The running features list and work queue. Newest shipped items first; the **Queue** is worked top-down.

## Queue

1. ✅ **Fuel meter**: shipped (see below).
2. ✅ **larinovsky's kit**: Pill Pusher / the Rizzler / Take a Nap, shipped (see below).
3. ✅ **torikloud's Debate and Twins** (plus Sonic Boom crossover), shipped (see below).
4. ✅ **ciarra's kit**: Tattoo Gun / Sew / Marathon plus frog hops, shipped (see below). Every character
   now has their own kit; the placeholder Heavy and Mega shells are gone.
5. ✅ **Info screen** and **smoother driving**, shipped (see below).
6. ✅ **kie's new kit**: Weasel Pop / Trollogram / Steal, shipped (see below).
7. ✅ **8-bit sound effects**, shipped (see below).
8. ✅ **Two phones over Wi-Fi** (WebRTC, no server), shipped (see below).
9. ✅ **Room codes and a Wi-Fi game list** for two-phone play (public MQTT brokers), shipped (see below).
10. _(empty; next requests go here)_

### Backlog (ideas, not yet scheduled)

- Hide the Trollogram "flat pad" tell: decoys spawn on natural slopes while the real tank starts on a
  flattened pad.
- Music.
- Wind.
- More than 2 players per match (the engine already supports it; setup is fixed at 2).
- Online: reconnect after a dropped connection (it currently ends the match); a relay (TURN) server for
  play over mobile data, which carrier networks often block for direct connections; if the free public
  brokers prove flaky, swap them for Firebase or a tiny Cloudflare Worker (only `rendezvous.ts` changes).

## Shipped

### Balance
- **tones buff** (user testing: felt underpowered): ten-2's exhaust is ~3× bigger and much wider (1s at
  900 particles/s, ±43° fan), carpeting ~300px of ground in mud; ten-3's chunks now leave toxic sludge
  that burns enemies touching it at 10 HP/s for the rest of the turn.

### Core
- **Two phones over Wi-Fi**: 📶 Host on one phone opens a room with a 4-letter code (plus a QR code
  and a link of it). On the other phone, Join lists games on the same Wi-Fi to tap, or type the code, or
  just open the link: one trip, nothing to send back. Free public MQTT brokers (HiveMQ, EMQX, Mosquitto,
  all at once) pass the connection details between the phones, sealed with a key from the code, and
  are dropped once connected. If they can't be reached, it falls back to swapping direct QR codes both
  ways (scan with the camera app, in-game on Android, or paste). Then a lobby (each picks their own character; the host starts) and each plays on their own phone:
  the other phone watches your aim live, and its controls step aside until it's its turn. WebRTC
  data channel with free public STUN only, no server: same Wi-Fi is the baseline; over mobile data
  it's a bonus if the carrier allows it. Leaving or dropping out shows "Connection lost".
- **8-bit sound effects**: kitschy Game Boy style bleeps, synthesised live (pulse waves and LFSR noise,
  no audio files). Every weapon has its own firing sound (an ice cream van jingle for Double Park, a
  wolf whistle for the Rizzler, BLEURGH for ten-3, a snore for Take a Nap, a sewing machine for Sew…),
  plus explosions, damage oofs, typewriter clacks for Debate letters, the kookaburra's laugh, Steal's
  roulette ticks and ka-ching, a sad trombone for a Marathon DNF, frog-hop boings and a victory tune.
  🔊 / 🔇 next to ⓘ toggles it (remembered). While Weasel Pop's weasels scurry, a chiptune of Pop Goes
  the Weasel plays, cut off dead (with a POP!) the moment the last one pops.
- **Info screen**: the ⓘ button (top centre in battle, and on the setup screen) opens a guide: how to
  play, what the status icons mean, and a page per character with their movement and a card for each
  weapon (tier, rounds, aimed or not, what it does). It opens on the current player's character and
  pauses the game while it's up.
- **Smoother driving**: tanks roll over bumps and lips up to 7px (mud piles, crater edges) instead of
  getting caught on anything over 3px, and scramble up short steep climbs like crater walls (anything that
  tops out within 40px) and anything that leads out of a pit or crater, so they can always drive out of
  a crater, even a pile of overlapping ones, or away from a steep crater wall they've slid against; tall
  hills steeper than 45° still stop them. Frog hops never land sunk into a bank.
- **Fuel meter**: each tank has one tank of fuel for the whole match (250px of driving; it never
  refills), usable any time during your turn before firing. Hold ◀ ▶ in the drive bar; the gauge shows
  what's left. Tanks follow the ground: they climb small
  bumps, roll down slopes and drop off ledges, and are stopped by walls, other tanks and decoys, and the
  map edge. (Bumps up to 7px and short steep climbs like crater walls are fine; tall slopes steeper than 45° are too steep.)
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
| **kie** | Weasel Pop: 3 tumbling weasels that scurry right up under the enemy and pop for full damage (or as close as they can get in range), to Pop Goes the Weasel | Trollogram: 2 decoys per use (3 uses, they add up), secret swap, 50% penalty for hitting one | Steal: a slot-machine roulette spins over the enemy's weapons and lands on one at random; kie takes a round of it (they lose it), it replaces Steal and he can fire it the same turn |
| **kcaj** | Double Park: twin ice cream cones | Hyperfixate: straight laser, burns for 3 turns | Unmedicated: pill storm across the stage, bounces twice |
| **torikloud** | Debate: a random legal word lobbed one letter at a time (longer word = more damage) | Sonic Boom: sound arcs through terrain, weaker with distance, kookaburra in the sky; with a twin, crossing waves phase for ×1.5 damage and range | Twins: a second tank with half his HP and its own bar; it mirrors every shot (Debate from a social-work dictionary) |
| **ciarra** (moves in frog hops) | Tattoo Gun: a burst of 12 ink needles; enemies hit are tattooed and take +25% damage from everything until the end of their next 2 turns | Sew: a needle and thread stitch straight through terrain (power = length, no crater), 20 damage and pins the enemy so they can't move on their next turn | Marathon: a short runner (tan skin, rose ponytail) jogs one leg towards the nearest enemy every time anyone fires, over any hill, and explodes for 50 at the finish; a blast near them is a DNF |
| **larinovsky** | Pill Pusher: indirect fire, a series of 4 lobbed pills that walk across the target | the Rizzler: blast "cooks" enemies, who deal half damage on their next turn | Take a Nap: doze for 2s, wake at full health |

# Features

The running features list and work queue. Newest shipped items first; the **Queue** is worked top-down.

## Queue

**Feature freeze: refactoring pass** (from the code assessment, 1 Oct). Behaviour stays the same unless an
item says otherwise; each step ships on its own with the full test suite. Live play-test checkpoints are
flagged to the owner as they come up.

1. **Phase 2: game core.**
   - One hit pipeline (`applyHit`): every mechanic goes through it, so every weapon effect (burn, cook,
     tattoo, pin, refund-on-miss, friendly fire) works on every kind of weapon.
   - Status registry: each status's apply / turn start / turn end / tick / effect / badge / look in one place.
   - One `Tank` shape for a player's tanks (main and twin): one damage path, no field copying on promotion.
     Fixes the twin toxin gap: a twin hit by gunk takes it as instant damage instead of draining toxin,
     and promotion doesn't hand toxin over (a rules change: after the versioning).
   - Weapon kinds table (`fire`, aimless, is a shot, twin mirrors) replacing scattered kind checks.
   - `WeaponDef` as a union by kind (no `spec!` assertions, no `blastRadius: 0, damage: 0` boilerplate).
   - Simulation vs cosmetic state: cosmetics left out of snapshots, a gameplay id counter, `winnerId`.
   - Stepper and helper cleanup: allocation-free target scans, one swept-segment helper, shared spacing /
     nearest-enemy / ammo-fallback helpers.
2. **Phase 3: presentation.**
   - HUD: readouts update in place; chips and weapon buttons rebuild only when they change.
   - Terrain uploads as several dirty rectangles, not one union.
   - Draw-layer list (one signature, like `STEPPERS`); shared glow / sprite / pips helpers; cached sky.
   - `main.ts` split, with one `startMatch`.
3. **Phase 4: online and screens.**
   - Sealed-store helpers (`putSealed` / `getSealed`, one encoding everywhere) and one latest-wins writer.
   - A shared base for watching and replays (`applyState`, resolved, previews).
   - `ui/dom.ts`: one set of DOM helpers for every screen.
   - `online.ts` split into screens with one dispose path (no `stopRoom` / `cancelled` juggling); session
     events with listeners instead of wrapped callbacks.
   - `NetSession` as an explicit state machine.
4. **Phase 5: tidy.** Dead CSS and the `#online button` specificity fight, test helpers into
   `tests/support`, stale comments.

### Backlog (ideas, not yet scheduled)

- Hide the Trollogram "flat pad" tell: decoys spawn on natural slopes while the real tank starts on a
  flattened pad.
- Music.
- Wind.
- More than 2 players per match (the engine already supports it; setup is fixed at 2).

## Shipped

### Refactoring (feature freeze, Oct)
- **Phase 1: versioning** (`net/version.ts`). The one `PROTOCOL` number became `WIRE` (messages and stored
  records) and `RULES` (the game), plus `OLDEST_RULES`, the oldest rules a stored match or replay can carry
  on under. A balance tweak bumps `RULES` only, so matches in progress carry on with the new numbers
  instead of all ending ("Older version"); `OLDEST_RULES` is raised only when older matches can't fit.
  Matches record the rules they started on (`MatchSetup.rules`), records the rules of whoever wrote them,
  replays both. Phones playing live must match exactly: the older one now gets "Update needed · ↻ Reload"
  (your match is still there afterwards) or "The other phone needs an update", instead of "Connection
  lost", and the room is left alone (it used to be cleared). A match last played on a newer build shows
  "Reload to play" in the Game browser; Past matches only lists replays this build can play.
- **Phase 0: safety.** The frame loop schedules the next frame first and logs a frame's error (once each,
  to Copy logs) instead of freezing the game for good. The sound player looks a weapon up only for tune
  cues, and never throws on an unknown id (`findWeapon`, for presentation). A phone that rejoins just
  as the other phone's turn result is waiting gets that result, not the stale local state (the session
  settles the shot before catching anyone up). Joining an open game whose host is away can't leave a
  listing advertising after you've left.

### Balance
- **torikloud starts with 150 health** (two tanks are two targets, so the twins tended to take more
  damage): everyone else still has 100; Twins splits it 75 / 75. Per character (`maxHp`), shown on the
  info screen (Health · 150) and filling the health bars; Take a Nap heals to the character's full.
- **Statuses on the twin** (bug fix): a Hyperfixate beam into torikloud's twin now sets the twin burning
  (it had no burn at all); each tank's burn ticks on its own as his turn comes up, and a burning twin
  that takes over from a destroyed main tank keeps burning. Checked the rest: cooked, tattooed and
  pinned already applied to torikloud from a twin hit (now "COOKED" shows over the twin that was hit),
  soak / sludge / toxin already hurt the twin, and a hit on a scamming player's twin now counts for
  Women in Scam. Online protocol 7.
- **Trollogram holograms blow up** (deemed overpowered: hitting one cost the shooter half the damage
  they'd have dealt): a hologram that gets hit now self-destructs straight away, a small blast (radius 20,
  up to 20 damage, a little crater) that hurts every tank in reach, friend or foe, kie included, and can
  set off another hologram nearby (a chain, one after another). Nobody pays a penalty any more. With its
  own animation (the copy overloads and glitches, a white-hot flash, a cyan/magenta shockwave, pixel
  shards and chunks of the tank) and sound (a glitchy stutter, a power-down ZWOOOM and a bang, falling
  sparkles). Online protocol 6 (matches started on the version before can't carry on).
- **Women in Scam** (larinovsky's new bonus move, a 4th weapon slot): once a match, doesn't use the
  turn; until the end of the next enemy turn, the first enemy attack to hit larinovsky's own tank
  (not anything else; burns ticking don't count) earns a round of the weapon that enemy fired that
  turn. Take a Nap's restock skips it. The weapon bar grows a second column for scammed rounds.
- **Take a Nap restocks**: waking up also refills Pill Pusher to 5 and the Rizzler to 3 (not the nap
  itself; a stolen round on top of a full stock is kept). Floats "Ammo restocked" when it changed
  anything. Plus two sleepy cat sprites either side of the tank while it naps.
- **Bigger frog hops** (user feedback: after the driving improvements hops were no real advantage):
  44px leaps (was 24), clearing 64px (was 16, below a tank's 40px scramble), at half the fuel per px.
- **the Rizzler homes in**: once the heart comes within 100px of an enemy tank (or its decoy or twin) it
  locks on (an "ooh-la-la" trill), drops gravity and turns up to 720°/s towards it, so near misses hit.
- **ten-1 spread** (user feedback: too concentrated at close range): while the pressure is low the jet
  sprays (up to ±40° and ±35% speed, tightening to a clean line at full), and a droplet's damage scales
  with its pressure (×0.1 dribbling … ×1 at full). Best case point-blank ~63 (was ~90), 150px ~55 (62);
  250px and beyond unchanged (~51 / 45 / 37 at 250 / 400 / 600px).
- **tones buff** (user testing: felt underpowered): ten-2's exhaust is ~3× bigger and much wider (1s at
  900 particles/s, ±43° fan), carpeting ~300px of ground in mud; ten-3's chunks now leave toxic sludge
  that burns enemies touching it at 10 HP/s for the rest of the turn.

### Core
- **Replays (Past matches)**: tick **Past matches** in the Game browser (remembered) and every public
  match that finished in the last two weeks is listed under the games ("Ann vs Bo · tones vs kcaj · Bo
  resigned · 2 h ago") with **▶ Replay**. A replay plays the match back view only, like watching it live:
  each shot from the exact state it was fired from (the aim shown for a moment, then it plays out), then
  how it ended; **1× / 2× / 4×** speed, **↺ Watch again** at the end. Recorded by whichever phone is in
  charge as the match goes (`net/replay.ts`, `replays/` and `replayList/` in the database); private games
  aren't recorded.
- **Choose your tank**: hosting a game, or joining someone's (from the Game browser, a typed code or an
  invite link), stops at a "Choose your tank" screen first: a dropdown of characters with what each one
  does (blurb, how it moves, every weapon's card, as on the ⓘ screen), then **Host with X** / **Join with
  X**. The room only opens, or the join only goes ahead, once you've picked. It starts on your last
  online tank and remembers the new one. (Going back to your own match skips it.)
- **Open games**: a hosted game stays open after the host leaves the Host screen (**Back to menu**; it's
  in their own games as "Waiting for a player", and tapping it reopens the Host screen). It stays in
  the Game browser for up to 3 days without its host, and the first to join becomes player 2 and starts
  the match right away if the host isn't there (after 6 s if the host was there a moment ago but hasn't
  said hello); it then goes turn by turn. **Cancel game** takes it down. The room keeps the host's
  offer (name, character, listed or private) in its `game` record until the match starts.
- **Landing screen** (designed with mock-ups first, approved): "Playing as NAME ✎ Change", then two big
  cards: **🌐 Game browser** (host, join or watch online; a mint dot on its corner counts the online
  turns waiting for you, and a line under it how many games are waiting or live) and **👥 Local
  hotseat**; plus ⓘ Weapons & how to play and ✨ What's new. The Player 1 / Player 2 rows moved to the
  **Local hotseat** screen (two cards, a character and a name each, Start battle); Player 1 starts as
  you, and names typed there are just for that match. Online you play your last online character
  (changeable in the lobby, remembered).
- **Game browser**: a full-screen table, your matches first ("↩ You vs Kim · Your turn · Play", their
  turn, won/lost), then everyone's: waiting for a player (Join), live and finished (👁 Watch), updating
  live. A side panel: **📶 Host a game**, and under it "Private game? Enter its code". (My games lives
  here now.)
- **Your name**: the first time the game opens in a browser with no saved username, a "What's your
  name?" prompt comes up before anything else (even an invite link), pre-filled with a name typed in
  before. It's saved in the browser and is Player 1's name (hotseat) and your name online (lobby, Games
  list, spectators). Editing Player 1's name on the setup screen changes it (blank puts it back);
  picking another character keeps it.
- **Two phones, any network**: 📶 Host on one phone opens a room with a 4-letter code (and a link of it
  to copy or share). On the other phone, Join opens the Games list (tap a game to join), or type the
  code, or just open the link. The game's messages go through a Firebase Realtime Database (free tier, see
  `firebase/README.md`), sealed with a key from the code, so it works on mobile data too. (Local
  multiplayer is hotseat on one phone.) Then a lobby (each picks their own character; the host starts)
  and each plays on their own phone: the other phone watches your aim live, and its controls step aside
  until it's its turn. Leaving or dropping out shows "Connection lost". Every online screen has a
  📋 Copy logs button (database calls, room messages, session; addresses masked) for bug reports.
- **Games list**: Join shows every public game, on any network, updating live: "Waiting for a player"
  (tap to join) and "Live now" (who's playing whom, tap to watch; finished ones say so). Hosted games are
  listed unless the host taps 🌐 Listed in Games → 🔒 Private (remembered), and then only the code or
  link gets in. A game leaves the list when its host leaves; a host that drops out and rejoins is
  re-listed; a listing whose host vanished drops off within 90 seconds and is tidied away after 10
  minutes. (Replaces the old same-Wi-Fi nearby list; no STUN lookup any more.)
- **Spectator mode**: join a match that's already under way (type its code, open its link, or tap it
  under "Live now" in the Games list) to watch it live, view only: aim, shots and
  results as they happen, with a 👁 Watching · Leave button. Joining mid-match catches straight up.
- **Turn by turn (async online play)**: an online match is live while both phones are there and turn by
  turn when they aren't (no separate mode). ☰ in a match: Back to menu (the match waits), 📣 Nudge, 🏳
  Resign (tap twice). The other phone's banner says so: "X isn't here. Take your turn: they'll see it when
  they're back", or "It's X's turn, and they're not here. The game waits" with Nudge (shares the game's
  link) and Menu. **My games** on the setup screen lists this phone's matches (Your turn / Their turn /
  won / lost; "· N your turn" on the button); opening one replays their last shot if you haven't seen it,
  then it's your go. Each room keeps a sealed **game record** (state, the last shot, any shot still in
  flight): firing records the pre-shot state at once, so closing the app mid-shot can't undo a move
  (whoever opens the game next plays it out). **3 days** without a move: whoever's turn it is forfeits.
  A finished match is forgotten once you've seen how it ended; a match from an older version ends with
  a note. Leaving in the lobby, before the start, still ends it. (Push notifications: not yet, maybe
  never: they need a service worker and a paid Firebase plan.)
- **Rejoin a match**: dropping out doesn't end it. A signal blip heals by itself; a phone that reloaded
  (or was killed) goes straight back into its seat when the game is opened again within 10 minutes
  (unless it left on purpose); after that it's in My games (for 5 days). Typing the code or tapping the
  game in the Games list (↩ your match) also rejoins (rather than watching). The rejoining phone is
  caught up by the other phone if it's there (after any shot in flight has played out), else from the
  game record.
- **Invite links ask first**: opening a room link shows "Join a game? … Join game / Not now" instead of
  joining straight away, so a messaging app's link preview can't grab the seat. And if a guest joins and
  goes quiet in the lobby before the match starts, the host frees the seat and keeps waiting (same code).
- **Random first player**: who goes first is picked at random for every match, hotseat and online
  (from the match seed, so both phones agree).
- **What's new popup**: on opening, a card lists what's changed since this phone last looked (a first
  visit sees just the latest release), then stays away until the next release; ✨ What's new on the setup
  screen shows the whole changelog.
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
- **Frog hops** (ciarra): instead of driving, she leaps 44px at a time, clearing walls and cliffs up to
  64px (a driving tank scrambles up 40px at most), and hops cost half the fuel per px, so she goes twice
  as far on the same tank.
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
| **tones** | ten-1: yellow water jet that builds in spurts, trickle damage; a complete miss refunds the round | ten-2: shakes for 10s, then jetpacks away on a huge, wide blast of toxic mud | ten-3: short-range chunky spew, intense damage over one turn; coats the ground in toxic sludge that burns enemies for the rest of the turn |
| **kie** | Weasel Pop: 3 tumbling weasels that scurry right up under the enemy and pop for full damage (or as close as they can get in range), to Pop Goes the Weasel | Trollogram: 2 decoys per use (3 uses, they add up), secret swap (even on the turn it's cast: tap one, then DONE); a hit one blows up (20px blast, 20 damage, hurts any tank, kie's too, and can set off the next) | Steal: a slot-machine roulette spins over the enemy's weapons and lands on one at random; kie takes a round of it (they lose it), it replaces Steal and he can fire it the same turn |
| **kcaj** | Double Park: twin ice cream cones | Hyperfixate: straight laser, burns for 3 turns | Unmedicated: pill storm across the stage, bounces twice |
| **torikloud** | Debate: a random legal word lobbed one letter at a time (longer word = more damage) | Sonic Boom: sound arcs through terrain, weaker with distance, kookaburra in the sky; with a twin, crossing waves phase for ×1.5 damage and range | Twins: a second tank with half his HP and its own bar; it mirrors every shot (Debate from a social-work dictionary). He starts with 150 health (everyone else 100) |
| **ciarra** (moves in big frog hops: over 64px cliffs, twice a tank's range) | Tattoo Gun: a burst of 12 ink needles; enemies hit are tattooed and take +25% damage from everything until the end of their next 2 turns | Sew: a needle and thread stitch straight through terrain (power = length, no crater), 20 damage and pins the enemy so they can't move on their next turn | Marathon: a short runner (tan skin, rose ponytail) jogs one leg towards the nearest enemy every time anyone fires, over any hill, and explodes for 50 at the finish; a blast near them is a DNF |
| **larinovsky** | Pill Pusher: indirect fire, a series of 4 lobbed pills that walk across the target; a mixed handful (red and white capsule, round mint tablet, blue and yellow capsule, lilac oval caplet) | the Rizzler: homes in on any enemy tank within 100px; blast "cooks" enemies, who deal half damage on their next turn | Take a Nap: doze for 2s (a ginger cat and a grey cat curl up either side), wake at full health with Pill Pusher and the Rizzler restocked (5 / 3). Plus a 4th slot, **Women in Scam** 💅: a bonus move once a match (doesn't use the turn); if an enemy attack hits larinovsky's own tank during the next enemy turn, larinovsky gets a round of that weapon (in a new slot, or on top of the same weapon), one per enemy turn |

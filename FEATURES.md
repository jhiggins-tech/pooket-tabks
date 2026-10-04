# Features

The running features list and work queue. Newest shipped items first; the **Queue** is worked top-down.

## Queue

(Empty: everything queued has shipped.)

### Backlog (ideas, not yet scheduled)

- Hide the Trollogram "flat pad" tell: decoys spawn on natural slopes while the real tank starts on a
  flattened pad.
- Music.
- Wind.
- More than 2 players per match (the engine already supports it; setup is fixed at 2).

## Shipped

### Refactoring (feature freeze, Oct)
- **Phase 5: tidy.** Dead CSS gone (`.online-paste`, `.setup-row`); the online screens' default button
  size has no specificity (`:where(#online button:not(.big))`), so class rules win without `!important`
  or `#online` prefixes (one `!important` left, on purpose: a remote turn's controls). Tests share
  `flush` / `until` / `settled` (`tests/support/wait.ts`) instead of eight copies; the Trollogram e2e
  gets the time budget its length needs.
- **Phase 4: `NetSession` phases.** One `phase` (lobby → match, rejoining → match | lobby, ended: left /
  away / outdated / lost) instead of the `lost`, `rejoining` and `fallback` flags beside a nullable game,
  so the impossible mixes can't happen; `lost` and `isRejoining` read it.
- **Phase 4: the online screens.** `online.ts` split: the Game browser, host screen and Choose your tank in
  `ui/online/`, how this phone's matches stand in `net/matches.ts`. Each way in (browser, host, join,
  rejoin, watch, replay) is an attempt with one dispose path (`Scope`), replacing the `stopRoom` /
  `cancelled` juggling; that also stops a few late screens popping up after leaving. Session events are
  listeners (`NetSession.on`), not wrapped callbacks.
- **Phase 4: following a match, shared.** `net/follow.ts` (`previewOf` / `applyPreview`, `putState`,
  `shotResolved`, `SYNC_GRACE`) for the session, spectators and replays, which each had their own copies
  (snapshot + terrain was put back by hand in eight places).
- **Phase 4: one set of DOM helpers.** `ui/dom.ts` (typed `el`, `byId`, `button`, `screenTop`) replaces the
  copies in the online, info, profile, what's-new, landing and hotseat screens.
- **Phase 4: sealed entries and one writer.** `net/sealed.ts` (`putSealed` / `openSealed` / `getSealed`) is
  the one way to write and read a sealed `{ m, ts }` entry (records, open offers, the Games list,
  replays), instead of the same base64 + seal + server-time lines in five places. `seal` now uses the
  wire format everywhere (Infinity and NaN survive; it read plain JSON before, which it still reads).
  `net/writer.ts` `LatestWriter` (newest value, one write at a time, optional retry) is what the record
  and the spectator feed write through; it was two near-copies.
- **Phase 3: main.ts tidied.** One `startMatch` (new game, HUD and tunes reset, game over card hidden)
  instead of four copies (hotseat, online, watching, back to the menu); the query string is read once
  (`app/params.ts`, documented); the sound toggle is `app/sound.ts`.
- **Phase 3: draw layers.** `Renderer.draw` is an ordered list of layers with one signature (`BACKDROP`
  behind the hills, `LAYERS` over them: the order is the layering, like `STEPPERS`), instead of a hand-kept
  sequence with the tank, ghost and aim logic inline: those moved to `drawTanks` / `drawAim`
  (draw/tank.ts) and `drawGhosts` (draw/copies.ts). One `glow()` helper (draw/colour.ts) for the soft
  radial discs drawn in eight places; the sky gradient is made once per resize, not every frame.
- **Phase 3: terrain uploads as separate rectangles.** Changes to the ground used to be merged into one
  bounding box a frame, so Unmedicated's pills popping all over the map re-uploaded most of the map
  every frame. Now changes far apart stay separate rectangles (ones that touch merge; past 24 it falls
  back to one box), each uploaded on its own.
- **Phase 3: the HUD only touches what changed.** It used to rebuild every name chip and weapon button
  whenever anything moved, including every frame of aiming and driving (40 element rebuilds for 20 taps
  of ↺; now none). Each part has its own key: angle / power / fuel are just text and a width; name chips
  are kept and patched (so the health bars now slide down when hit, and the burn badge pulses
  steadily); weapon buttons, the status line, the steal roulette and the turn banner update only when
  theirs changes. Status badges come from one table (`BADGES` in hud.ts).
- **Phase 2: hot-path scans and shared helpers.** `forEachTargetPos` / `nearestEnemyX` / `someTankBody`
  (tanks.ts) scan targets and tank bodies without building lists: walkers (every pixel they walk),
  runners, homing, the jetpack (every pixel of flight) and driving / hopping (every pixel) no longer
  allocate arrays as they go. `clearSpot` (copies.ts) is the one "random spot clear of every tank" for
  twins and decoys. (Left as they are: the four 1px swept-segment loops, which differ in step size and
  what they test; folding them together would risk changing outcomes for little gain.) No change to
  how anything plays.
- **Phase 2: simulation vs cosmetic state.** Effects that only age and get drawn (explosions, floaters,
  splashes, shimmers, ghosts, hologram blasts, apparitions) live under `state.fx`, which snapshots leave
  out: smaller messages and records, and the other phone keeps its own animations instead of snapping to
  the sender's. Hologram and stream ids come from a gameplay counter (`nextId`), not the cosmetic one.
  `applySnapshot` only takes keys the game has. Rules 9 (matches carry on: `upgradeSnapshot`).
- **Phase 2: weapon kinds and types.** `weapons/kinds.ts` is a table of every kind (what it is, aimed or
  not, shot / free action / bonus move), replacing the scattered `kind === 'scam'` / `ignoresAim` lists;
  `FIRE` and `FREE_ACTIONS` (mechanics.ts) must have one entry per kind. `WeaponDef` is a union by kind:
  a weapon's kind decides which spec it must have (a sonic weapon without `sonic` doesn't compile), kits
  use `satisfies WeaponDef`, and specs are read with `weaponOf(id, kind)` instead of `getWeapon(id).sonic!`
  (24 assertions gone; `blastRadius: 0, damage: 0` boilerplate gone from the non-blast weapons).
  `explode` takes an explicit blast size, so the runner's finish and hologram blasts no longer build fake
  weapons. `game/loadout.ts`: `weaponForTier` and one `reselect` for "fall back to a loaded tier"
  (was in three places), which also untangles steal.ts ↔ game.ts. No change to how anything plays.
- **Phase 2: one hit path, and statuses in one place.** Every mechanic's hits go through `applyHit`
  (tanks.ts): damage, then the weapon's effect flags (`dot`, `debuff`, `tattoo`, and Sew's pin, now a
  `pin` flag), friendly fire and refund-on-miss, so every effect works on every kind of weapon (a
  tattooing sound wave or a pinning blast just works). `game/statuses.ts` has each status's whole course:
  put on (`afflict`), turn end / start, and what it does (`offence`, `vulnerable`, `canMove`), with a
  table in its header; `endTurn` and movement call it. No change to how anything plays.
- **Phase 2: one tank shape.** A player's tanks (the main tank is the `Player`, a twin a `Twin`) share
  `TankBody` (position, health, burn, soak, toxin), and `Target` is `{ kind: 'tank', player, tank }` or a
  hologram, so there's one damage path (`hurt`) instead of `damagePlayer` / `damageTwin`, and the
  per-kind switches are gone. Fixes: gunk on the twin now drains as toxin like on any tank (it hit at
  once); a twin taking over hands over its own soak, toxin and burn (the main tank's go with it); hits on
  the twin make the hit sound. Rules 8 (matches carry on: `upgradeSnapshot` fills in older snapshots).
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
- **Faster ranking** (owner, 4 Oct). A rank is a band of 80 rating points (`BAND`). A win moves K = one band
  times how surprising it was (so a win between equals is half a rank and an upset up to nearly a whole
  one), and never less than a third of a rank (`MIN_GAIN`), even a favourite beating a much lower player; the
  loser gives up the same. A draw is plain Elo. (Was K 32, zero floor: about five equal wins a rank.)
  The hourly stats re-rate everyone from every verified match, so the new rule applies to all of history:
  ratings and ranks shift once. No `RULES` bump: it isn't in the simulation. `src/stats/ranks.ts`.
- **ten-1 splashback reaches further** (owner play test, 2 Oct; rules 13): the range is tripled, from 4 to
  12 tank-widths (`SPLASHBACK_RANGE`, 264px between tank centres). Past that ten-1 is unchanged.
- **ten-1 splashback** (owner, 2 Oct; rules 12). Point-blank, every drop of tones2's ten-1 landed, which
  was stronger than intended. Now, if the enemy nearest tones2 when firing (main tank or twin) is within 4
  tank-widths and the stream does more than 5 damage to them in total, it splashes back: "SPLASHBACK!",
  big drops arc back onto tones2's own tank (harmless), the jet is knocked off its aim and the pressure
  dies away to nothing in under half a second. So a point-blank jet does roughly 5–15 rather than 30+;
  further off it's unchanged. Stored matches fill in the stream's new fields (`upgradeSnapshot`).
- **torikloud's Twins: placed and aimed on their own** (owner, 2 Oct; rules 11). With Twins selected a ghost
  tank shows where the twin will appear (a suggested spot, worked out without dice); tap the ground to move
  it (not within 2 tank-widths of an enemy, not on a tank), then FIRE. The twin keeps its own angle and
  power (it starts with the main tank's) and fires every shot along it: a drag that starts near a tank aims
  that one, and the 🎯 Main tank / Twin switch picks which one ↺ ↻ − + adjust. Both aim guides show (the
  one being aimed bright). Online, the twin's aim and the ghost stream live; stored matches fill the twin's
  aim in from the main tank's. A twin that takes over from a destroyed main tank keeps its own aim.
- **Marathon runner can be hit** (owner, 2 Oct; rules 10). Enemy shells, pills and walkers now collide with
  ciarra's runner and go off on her, like hitting a tank: a shot that crosses her path while she runs a
  leg gets her (they used to pass straight through, and she's usually on the move while shots fly, as
  every shot sets her off). Still a one-hit DNF; ciarra's own shots pass her. `runnerAt` (tanks.ts).
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
- **Rank-up jingles, a tune each** (owner, 4 Oct). Every rank's jingle is its own short score
  (`src/stats/ranks.ts` `jingle`, in the notation of `src/audio/score.ts`: notes, rests, chords, slides,
  drums), not an arpeggio moved up or down. They build up the ladder: the lowest ranks are a lone tune, then
  a bass (triangle) joins, then drums (noise), then harmony (thin pulses); sparkle adds an echo of the tune
  (1), the twinkle over the last note (2), and a chorused lead with a shimmer (3). Lengths grow from under
  2 s to about 6 s. `audio/sfx.ts` `rankJingle` plays any score. Tests: every part lasts as long as the tune,
  no two tunes open with the same shape, the parts never drop up the ladder and each tier is longer.
- **33 ranks, 25 of them hidden** (owner, 4 Oct). The ladder grows from 8 to 33. The original eight
  (Bronze … Champion, announced in What's new) are known; **the other 25 are meant to be discovered**: they
  aren't named in the changelog, the docs or the tests, and in the game one only appears when a player holds
  it (insignia show a player's own rank, so nothing lists a rank nobody has earned). Each has its own
  insignia shape (`ui/insignia-shapes.ts`), colours, sparkle level (never dropping up the ladder), jingle and
  mostly a line for the rank-up screen. A rank's lowest rating is worked out from its place in the ladder
  (Silver's band, 960–1039, holds the starting 1000; Gold 1040, Platinum 1360, Diamond 1760, Champion 2480,
  the top rank 2720), so **a new rank is one row** in `src/stats/ranks.ts` (ranks above it move up a band;
  ratings don't change). What a phone last showed its player is remembered by rank id (an older phone's
  place in the first eight is read as that rank), so the longer ladder doesn't fake a rank-up. Note the
  names are in the code (the repo is public): this hides them from the game and the docs, not from anyone
  who reads `ranks.ts`.
- **Ranks** (owner, 3 Oct). Competitive ranks for verified players (signed in, in matches both vouched for),
  on win/loss only: an Elo rating (`src/stats/ranks.ts`: start 1000, K 32; an upset moves more) worked out
  by the hourly stats over verified matches in the order they were played, into `stats/summary`'s `ratings`.
  Ranks are bands of rating in `RANKS`: Bronze, Silver (from 950; everyone starts here), Gold 1050, Platinum
  1150, Diamond 1250, Master 1350, Grandmaster 1450, Champion 1550. **Adding a rank** (meme ones): insert a
  row with its threshold, a new id, colours, a shape (shield / hex / star / crown), a sparkle level (0–3)
  and jingle notes; nothing stored changes. Insignia (`ui/insignia.ts`, SVG; higher ranks shimmer, twinkle
  and glow, still for reduced motion) by verified players' names: the in-game chips and winner line, the
  lobby, the landing screen and the stats (Players and You, with rating and best). A signed-in player's pick
  carries their stats key so the other phone can show their rank. At the end of a match both players were
  signed in for, each phone moves its own rating at once (`ui/ranks.ts`, until the next totals) and a
  rank-up gets the celebration (`ui/rankup.ts`: the insignia bursts in with sparkles, and the rank's jingle,
  `audio/sfx.ts` `rankJingle`); a rank-up that turns up in the totals later is celebrated on the menu, once.
- **📊 Stats** (owner, 3 Oct; rules 15). Online matches (public and private, not hotseat) added up, from this
  release on. Each match keeps a tally per player as it's played (`game/tally.ts`: shots that can do damage,
  hits on an enemy tank or decoy, damage dealt by weapon and taken, self-damage, kills; a burn credits whoever
  lit it). When a match ends, each phone files its summary (`stats/matches/<id>/<seat>`, readable only by the
  stats sender) and a signed-in player's phone vouches for it in their own account (`users/<uid>/results/<id>`:
  seat and the summary's SHA-256); also from My games, for matches never reopened. A GitHub Action
  (`.github/workflows/stats.yml`, hourly; `notifier/stats.ts`, `src/stats/aggregate.ts`) adds it all up into
  `stats/summary`, with no accounts in it (players by a hash of their account, or by name). **Verified**: both
  seats vouched for the same summary from two accounts (a player's second account would pass: a known limit).
  The viewer (📊 Stats on the landing screen, `ui/stats.ts`): Players (ranked from 3 matches; ✓ signed in,
  else "unverified" and grouped by name), Characters, Weapons, You, and a Verified only toggle. New rules for
  `stats/` and `users/$uid/results` (owner re-publishes).
- **torikloud's Yolk Sucker** (owner, 3 Oct; rules 14). Once Twins has been fired, its button (tier 3)
  becomes **Yolk Sucker**: a bonus move (the turn carries on) that pools the two tanks' health and shares
  it out as Twins does (the twin half rounded down, the main tank the rest). As often as you like, any turn
  while both tanks stand, while aiming (before or after driving; firing ends the turn as ever); greyed out
  ("EVEN") when their health is equal or one apart, and gone with either tank. Statuses stay on the tank
  they're on; no rounds are spent (so Steal can't take it, and running out of ammo works as before). A
  stream of yolk arcs from the fuller tank to the emptier one, with what each gave or got and a slurp.
  Online it goes like any bonus move (`fire`, replayed from the same state). `game/copies.ts`
  (`yolkTier`, `canSuckYolk`, `suckYolk`).
- **Sign in with Google, step 3: your turn on every phone** (owner, 3 Oct). A signed-in player's device
  record in each match carries their uid, so notifications for them go to the account (`to: u:<uid>`)
  instead of one device, even when the phone they last played on has notifications off. Each signed-in
  phone with 🔔 on lists itself under `users/<uid>/push/<clientId>` (on load, on signing in, on turning 🔔
  on or off; taken off before signing out), and the sender pushes to all of them but the one the entry came
  from; open pages follow the account's entries as well as their own. The sender drops a malformed account
  address unread. New rules for `users/$uid/push` (owner re-publishes). With this, sign-in is complete
  (profile, matches, notifications); the API key is restricted (README).
- **Sign in with Google, step 2: your matches follow you** (owner, 3 Oct; no rules change to the game). A
  signed-in player's match seats live in their account too (`users/<uid>/games/<room code>`: role, seat id,
  listed, when last played and changed; or a note that it was forgotten, so a finished match doesn't come
  back). Synced on sign-in, on every load and before the Game browser lists your matches; a change goes up
  straight away. The newer change wins; `left` and `seen` stay per phone. **One phone per seat**: each seat
  claim says which device has it (`dev`), host check-ins only touch the time, and a phone that sees its
  seat taken by another device under the same id stands aside without a word to the other player ("Playing
  on another phone", with "Play here instead"); the taker waits 1.5 s first so the old phone stops reading
  its messages. `net/seatsync.ts`, `rooms.ts` (`watchSeat`), `seat.ts` (`at`, forgotten notes,
  `seatChanges`, `takeSeats`); new rules for `users/$uid/games` (owner re-publishes).
- **Sign in with Google, step 1: your profile follows you** (owner, 3 Oct; no rules change to the game). An
  optional "🔑 Sign in with Google" on the landing screen (Google's script is loaded only when it's
  tapped). Signed in, your name, last online character, sound and the Game browser's ticks live in your
  account (`users/<uid>/profile`) and follow you to other phones: a phone's first sign-in takes the
  account's (or sends its own if the account has none), after that the newer wins, and changes made while
  signed out or offline go up next time. Signing out keeps everything on the phone. No SDK: Google ID token
  → Firebase REST sign-in → `?auth=` on `users/` calls only; only the uid is kept, never the Google email
  or name. New rules for `users/$uid` (owner re-publishes). `net/auth.ts`, `net/account.ts`,
  `ui/signin.ts`, `app/localprofile.ts`; tests with a fake Google / Auth in the Firebase stand-in.
- **tones is now tones2** (owner, 2 Oct): the name players see everywhere; the id stays `tones`, so saved
  picks, matches in progress and replays carry on. A hotseat seat saved under the old name follows the
  character (`OLD_NAMES`, ui/seats.ts).
- **Coming soon characters** (owner, 2 Oct): garyoldmancorp, shotdownboyz, kiwicore, odsey, lankcity and
  doctorfox are in the character pickers (hotseat and Choose your tank, under "Coming soon") and have an
  info tab each, with a Coming soon banner. They can be looked at, not played: Start and Join wait for
  someone playable. `characters/upcoming.ts`, deliberately outside ROSTER (nothing else can pick one).
  Their pages tease moves (owner, 2 Oct; marked work in progress, subject to change): kiwicore (tier 1
  torpedo pass, tier 2 throwdown), garyoldmancorp (tier 2 kamp karl, tier 3 the crinkler, bonus action
  stop the violence), lankcity (tier 2 HARD disk drive, movement lizard walk), shotdownboyz (tier 2 summon
  digger, tier 3 neurodiverge, passive tank build).
- **Push notifications** (owner, 1 Oct; from the owner's handover doc). Turn them on with 🔔 on the landing
  screen; then "🎯 Your turn!" when the other player has played and you're away, and "🎮 Someone joined
  your game" when someone starts your open game. Two ways in, one alert: an open page shows it at once
  (a toast to tap, or a system notification in the background); otherwise a scheduled GitHub Action
  (`notifier/`, every 5 minutes) sends a Web Push (VAPID, no paid Firebase plan). Tapping one opens that
  match. Each phone says which device it is in each room (`devices/`, sealed); entries in the `outbox` are
  addressed to that device only, carry no text (`push/templates.ts`, shared by both ways) and the room's
  topic, never its code. On iPhone it needs the Home Screen app. Owner's one-time setup: README, "Push
  notifications".
- **Watch replay instead of Rematch** (owner, 1 Oct): the game over card offers **▶ Watch replay** (the
  match just played, hotseat or online, public or private: each phone records the match it plays, in
  memory, as the same pre-shot snapshots a public replay keeps; `app/tape.ts`) and **New game** (hotseat:
  the setup screen, tanks and all) or **Leave**. Rematch is gone: to play again, start a new game (it was
  host-only online, with no way to change tanks).
- **Who's watching** (owner, 1 Oct): during an online match the players and everyone watching see a 👁
  count in the top bar (tap it for the names; you're "You"), and a toast when someone starts watching
  ("👁 Kim just started watching"). Watchers check in to the room every 20 s while they watch and check
  out when they leave; a check-in over a minute old stops counting (`net/watchers.ts`, `watchers/` in the
  room; `ui/online/audience.ts`).
- **The lobby shows who's playing as what** (owner, 1 Oct): its leftover character dropdown (from before
  Choose your tank) is gone; your tank is chosen before hosting or joining.
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
  5 / 3 / 1 rounds per weapon tier, game over (▶ Watch replay, or a new game).
- Phone-first: landscape layout, rotate prompt, fullscreen on Android, Add to Home Screen on iOS.

### Characters
Setup screen: two players each pick a character (the name pre-fills and can be changed); remembered
between visits.

| Character | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| **tones2** (id `tones`) | ten-1: yellow water jet that builds in spurts, trickle damage; a complete miss refunds the round | ten-2: shakes for 10s, then jetpacks away on a huge, wide blast of toxic mud | ten-3: short-range chunky spew, intense damage over one turn; coats the ground in toxic sludge that burns enemies for the rest of the turn |
| **kie** | Weasel Pop: 3 tumbling weasels that scurry right up under the enemy and pop for full damage (or as close as they can get in range), to Pop Goes the Weasel | Trollogram: 2 decoys per use (3 uses, they add up), secret swap (even on the turn it's cast: tap one, then DONE); a hit one blows up (20px blast, 20 damage, hurts any tank, kie's too, and can set off the next) | Steal: a slot-machine roulette spins over the enemy's weapons and lands on one at random; kie takes a round of it (they lose it), it replaces Steal and he can fire it the same turn |
| **kcaj** | Double Park: twin ice cream cones | Hyperfixate: straight laser, burns for 3 turns | Unmedicated: pill storm across the stage, bounces twice |
| **torikloud** | Debate: a random legal word lobbed one letter at a time (longer word = more damage) | Sonic Boom: sound arcs through terrain, weaker with distance, kookaburra in the sky; with a twin, crossing waves phase for ×1.5 damage and range | Twins: a second tank with half his HP and its own bar; it mirrors every shot (Debate from a social-work dictionary). Once fired, the slot is Yolk Sucker: a bonus move that evens out the two tanks' health. He starts with 150 health (everyone else 100) |
| **ciarra** (moves in big frog hops: over 64px cliffs, twice a tank's range) | Tattoo Gun: a burst of 12 ink needles; enemies hit are tattooed and take +25% damage from everything until the end of their next 2 turns | Sew: a needle and thread stitch straight through terrain (power = length, no crater), 20 damage and pins the enemy so they can't move on their next turn | Marathon: a short runner (tan skin, rose ponytail) jogs one leg towards the nearest enemy every time anyone fires, over any hill, and explodes for 50 at the finish; a blast near them is a DNF |
| **larinovsky** | Pill Pusher: indirect fire, a series of 4 lobbed pills that walk across the target; a mixed handful (red and white capsule, round mint tablet, blue and yellow capsule, lilac oval caplet) | the Rizzler: homes in on any enemy tank within 100px; blast "cooks" enemies, who deal half damage on their next turn | Take a Nap: doze for 2s (a ginger cat and a grey cat curl up either side), wake at full health with Pill Pusher and the Rizzler restocked (5 / 3). Plus a 4th slot, **Women in Scam** 💅: a bonus move once a match (doesn't use the turn); if an enemy attack hits larinovsky's own tank during the next enemy turn, larinovsky gets a round of that weapon (in a new slot, or on top of the same weapon), one per enemy turn |

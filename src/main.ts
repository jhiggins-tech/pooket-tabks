/**
 * The page: wires the game, renderer, HUD, controls, sound and screens together and runs the
 * fixed-timestep loop (FIXED_DT). Hotseat by default; `online.session` / `online.spectator` when playing or
 * watching online.
 */
import './style.css';
import { randomSeed } from './core/rng';
import { FIXED_DT, WORLD_H, WORLD_W } from './game/constants';
import { getCharacter, matchPlayers } from './characters/roster';
import { adjustAim, aimTwin, canPickDecoy, createGame, currentPlayer, drive, drumClock, drumsReady, drumTap, finishDecoyPick, fire, pendingTwinSpot, selectTier, setAim, step } from './game/game';
import type { GameState, PlayerConfig } from './game/state';
import { bindControls } from './input/controls';
import { Renderer } from './render/canvas';
import { Hud } from './render/hud';
import { Chip } from './audio/chip';
import { SfxPlayer } from './audio/sfx';
import { takePlayRef, takeRoomCode } from './net/links';
import { netLog, netLogText } from './net/log';
import { PUBLIC_LOBBY } from './net/lobby';
import { AUTO_REJOIN_MS, latestSeat, loadSeats } from './net/seat';
import { FIREBASE_DATABASE_URL } from './net/config';
import { sealerFor } from './net/seal';
import { setupAccount } from './app/account';
import { aimFromNear, tapBattlefield } from './app/battlefield';
import { InfoScreen } from './ui/info';
import { WhatsNew } from './ui/whatsnew';
import { matchesOf } from './net/matches';
import { OnlineScreen } from './ui/online';
import { Rtdb } from './net/rtdb';
import { loadCharacter, loadUsername, NamePrompt } from './ui/profile';
import { Landing } from './ui/landing';
import { SetupScreen } from './ui/setup';
import { readParams } from './app/params';
import { setupSoundToggle } from './app/sound';
import { MatchTape } from './app/tape';
import { nameKey, playerKey } from './stats/summary';
import { StatsScreen } from './ui/stats';
import { RANKS } from './stats/ranks';
import { Ratings } from './ui/ranks';
import { RankUp } from './ui/rankup';
import { openOnline } from './characters/access';
import { unlockAll } from './app/unlockall';
import { Progress, type Gain } from './ui/progress';
import { XpScreen } from './ui/xp';
import { GameOverCard } from './ui/gameover';
import { byId } from './ui/dom';
import { ViewingBar } from './ui/viewing';

const canvas = byId<HTMLCanvasElement>('game');
const renderer = new Renderer(canvas, WORLD_W, WORLD_H);
/** The game over card (shown by the HUD when a match ends; its buttons are wired below). */
const gameOver = new GameOverCard();
const hud = new Hud(gameOver);

const params = readParams(location.search, navigator.webdriver);
/** Testing: every character open online (`?unlockall`, a `VITE_UNLOCK_ALL=1` build, automated runs). */
const unlocking = unlockAll(params);
/** The online database: a test's (`?db=`), else the real one (null: none, so no online play). */
const dbUrl = params.db || FIREBASE_DATABASE_URL || null;
let nextSeed = params.seed ?? randomSeed();
const first = params.first;
let players: PlayerConfig[] = [];

// The menus: the landing screen (Game browser, Local hotseat), and the hotseat screen that starts a local match.
const setup = new SetupScreen((chosen) => {
  players = chosen;
  hideMenus();
  newGame();
  void goFullscreen();
});
const landing = new Landing({
  browser: () => void online.join(),
  hotseat: () => {
    landing.hide();
    setup.show();
  },
  changeName: () => void namePrompt.ask(yourName()).then(setUsername),
});
byId('hotseat-back').addEventListener('click', () => {
  setup.hide();
  showLanding();
});
const namePrompt = new NamePrompt();
/** This phone's player: the saved username (or, until there is one, Player 1's name). */
const yourName = () => loadUsername() ?? setup.players()[0]!.name;
function setUsername(name: string): void {
  setup.setUsername(name);
  landing.setName(name);
}
landing.setName(yourName());
function hideMenus(): void {
  setup.hide();
  landing.hide();
  stopCounts();
  stopCounts = () => {};
}
let stopCounts = () => {};

// A live battlefield sits behind the setup screen until the real match starts.
let state: GameState = createGame({ seed: nextSeed, players: setup.players(), first });

// Kitschy 8-bit sound effects, synthesised live.
const chip = new Chip();
const sfx = new SfxPlayer(chip, () => chip.now);
const soundToggle = setupSoundToggle(chip, byId('sound-toggle'));

// Characters in this match show in their match colours; the rest in their signature colour.
const info = new InfoScreen(
  (id) => state.players.find((p) => p.characterId === id)?.colour ?? getCharacter(id).colours[0]!,
);
byId('info-open').addEventListener('click', () => info.open(currentPlayer(state).characterId));
byId('setup-info').addEventListener('click', () => info.open(loadCharacter() ?? setup.players()[0]?.characterId));
byId('hotseat-info').addEventListener('click', () => info.open(setup.players()[0]?.characterId));

/** Which drive button is held (−1 / 0 / +1); applied every simulation step. */
let driveDir = 0;

/** The match being played here, recorded to watch again from the game over card. */
const tape = new MatchTape();

/**
 * A fresh match on the battlefield (local, online, watched, or just the backdrop behind the menus).
 * `played`: it's played on this phone (hotseat, or online), so it's recorded.
 */
function startMatch(seed: number, chosen: PlayerConfig[], played = false): GameState {
  state = createGame({ seed, players: chosen, first });
  playing = chosen;
  hud.setRanks(chosen.map((p) => ratings.rank(p.key)));
  if (played) tape.start(seed, chosen);
  else tape.clear();
  hud.reset();
  sfx.tunes.stopAll();
  gameOver.hide();
  return state;
}

/** A local (hotseat) match, with the players picked on the hotseat screen. */
function newGame(): void {
  startMatch(nextSeed, players, true);
  nextSeed = randomSeed();
}

// ---- Ranks (verified players): ratings from the hourly stats, insignia, rank-ups (ui/ranks.ts, ui/rankup.ts). ----
const ratings = new Ratings(dbUrl, () => myStatsKey);
const rankUp = new RankUp();
/** Who's playing the match on screen (for their insignia). */
let playing: PlayerConfig[] = [];
/** This phone's player's rank, if it's gone up since they last saw it: celebrate (once). */
function celebrateRankUp(): void {
  const seen = ratings.noteSeen();
  if (!seen?.up) return;
  rankUp.show(seen.rank, seen.first, ratings.rating(myStatsKey));
  sfx.jingle(seen.rank);
}
/** A rated match has just ended here: a rank-up (if it's gone up), then what the match earned (ui/xp.ts). */
function celebrateMatch(gain: Gain | null): void {
  const seen = ratings.noteSeen();
  const xp = () => {
    if (gain) xpScreen.show(gain);
  };
  if (!seen?.up) return xp();
  rankUp.show(seen.rank, seen.first, ratings.rating(myStatsKey), xp);
  sfx.jingle(seen.rank);
}
/** On the menus (not in an online match): a rank-up that turns up in the totals is celebrated at once. */
function celebrateOnMenus(): void {
  if (landing.isOpen && !online.session) celebrateRankUp();
}
/** Signed in: this player's stats key (their rank goes by it; set with sign-in, below). */
let myStatsKey: string | null = null;
// ---- Online: two phones, one each, through a Firebase room (`online.session`: null in a local, hotseat, game). ----
const online = new OnlineScreen({
  // Online you're you: your name, and the character you last played online.
  // (Never one that's locked online, such as a beta or one not unlocked: characters/access.ts.)
  pick: () => ({ name: yourName(), characterId: openOnline(loadCharacter() ?? setup.players()[0]!.characterId, progress.access()), ...(myStatsKey ? { key: myStatsKey } : {}) }),
  dbUrl,
  lobby: params.lobby || PUBLIC_LOBBY,
  relay: params.lostMs !== null ? { pingMs: 250, lostMs: params.lostMs } : undefined,
  syncSeats: () => account.seatSync?.sync() ?? Promise.resolve(),
  rankOf: (key) => ratings.rank(key),
  // A rated match just ended here: the rating and XP move now; over the game over card, a rank-up is
  // celebrated, then the XP it earned fills the bar towards the next unlock.
  ranked: (opponent, score, turns) => {
    ratings.played(opponent, score);
    const gain = progress.played(score, turns);
    setTimeout(() => celebrateMatch(gain), 1800);
  },
  // What's open online, and a token spent from Choose your tank (its padlock breaking open).
  unlocks: { access: () => progress.access(), tokens: () => progress.tokens(), unlock: (id) => xpScreen.unlockNow(id) },
});
/** An online match (or one being watched) starts: off the menus and into it. */
function startOnline(seed: number, chosen: PlayerConfig[], played = false): GameState {
  online.hide();
  hideMenus();
  return startMatch(seed, chosen, played);
}
online.onConnected = (s) => {
  // Both phones build the same game from the same seed; the session keeps them in step.
  s.onStart = (seed, chosen) => {
    void goFullscreen();
    return startOnline(seed, chosen, true);
  };
  s.on('shot', (shot) => tape.shot(shot));
};
// Watching someone else's match (live, or a replay): view only.
online.onSpectate = (sp) => {
  sp.onStart = (seed, chosen) => startOnline(seed, chosen);
};
const viewing = new ViewingBar({ leave: () => online.close(), replay: () => online.replay });
byId('net-menu').addEventListener('click', () => online.matchMenu());
// Start a match: the host, or a guest who joined an open game while its host was away. Players are [host, guest].
online.onHostStart = (s) => {
  const picks = s.isHost ? [s.localPick!, s.remotePick!] : [s.remotePick!, s.localPick!];
  s.start(randomSeed(), matchPlayers(picks));
};
online.onClosed = () => {
  // Back to the landing screen, with a fresh battlefield behind it.
  startMatch(randomSeed(), setup.players());
  showLanding();
};
/**
 * The landing screen, kept up to date: the turns waiting for you in your online matches (the dot on the
 * Game browser), and how many public games are open or live (while it's showing).
 */
let turnsCheck = 0;
/** The dot on the Game browser: how many of this phone's matches are waiting for your turn. */
function updateTurnsWaiting(): void {
  if (!online.dbUrl) return;
  const check = ++turnsCheck;
  void matchesOf(new Rtdb(online.dbUrl)).then((games) => {
    if (check === turnsCheck) landing.setTurnsWaiting(games.filter((g) => g.status === 'your-turn').length);
  });
}
function showLanding(): void {
  setup.hide();
  landing.show();
  landing.setName(yourName());
  const url = online.dbUrl;
  if (!url) return;
  updateTurnsWaiting();
  stopCounts();
  stopCounts = online.watchCounts((waiting, live) => landing.setCounts(waiting, live));
}
// ---- Notifications and the optional sign in with Google (app/account.ts). ----
const account = setupAccount({
  dbUrl: online.dbUrl,
  params,
  profileApplied: () => {
    setUsername(yourName());
    soundToggle.reload();
  },
  seatsSynced: () => {
    if (landing.isOpen) updateTurnsWaiting();
  },
  alerts: { open: (ref: string) => void openMatch(ref), here: (ref: string) => online.roomTopic === ref },
});
const { auth } = account;
// ---- Career XP and unlocks (signed in): ui/progress.ts, the XP screen (ui/xp.ts), characters/access.ts. ----
const progress = new Progress(() => (auth.uid && myStatsKey && account.userDb ? { uid: auth.uid, key: myStatsKey, db: account.userDb } : null), unlocking.on);
ratings.onTotals((s) => progress.take(s));
const xpScreen = new XpScreen(progress, (cue, n) => sfx.xp(cue, n));
byId('unlock-all').hidden = !unlocking.shown;
/** A notification was tapped: into that match (one of this phone's), else the Game browser. */
async function openMatch(ref: string): Promise<void> {
  netLog('ui: opened from a notification');
  if (online.roomTopic === ref) return;
  for (const seat of loadSeats()) {
    if ((await sealerFor('room', seat.code)).topic === ref) return void online.rejoin(seat);
  }
  void online.join();
}
/** Signed in: this player's stats key (from their account), and so their rank. */
async function refreshStatsKey(): Promise<void> {
  myStatsKey = auth.uid ? await playerKey(auth.uid) : null;
  landing.setRank(ratings.rank(myStatsKey));
  celebrateOnMenus();
  void progress.load(); // (their unlocks)
}
auth.onChange(() => void refreshStatsKey());
ratings.onChange(() => {
  landing.setRank(ratings.rank(myStatsKey));
  hud.setRanks(playing.map((p) => ratings.rank(p.key)));
  celebrateOnMenus();
});
void refreshStatsKey().then(() => ratings.load());
navigator.serviceWorker?.addEventListener('message', (e: MessageEvent<{ type?: string; url?: string }>) => {
  const ref = e.data?.type === 'open' && e.data.url ? takePlayRef(e.data.url) : null;
  if (ref) void openMatch(ref);
});

// Opened from a room link: join that room (or rejoin it, if it's ours). From a notification: that match.
// Reloaded mid-match: straight back in.
const openedRoom = takeRoomCode();
const openedPlay = takePlayRef();
const droppedSeat = latestSeat();
const autoRejoin = !openedRoom && !openedPlay && !!droppedSeat && !droppedSeat.left && Date.now() - droppedSeat.ts < AUTO_REJOIN_MS;
showLanding();
const whatsNew = new WhatsNew();
// 📊 Stats: online matches added up (ui/stats.ts); "you" is your account when signed in, else your name.
const stats = new StatsScreen({
  dbUrl: online.dbUrl,
  ratings,
  you: async () => (auth.uid ? { key: await playerKey(auth.uid), name: yourName(), signedIn: true } : { key: nameKey(yourName()), name: yourName(), signedIn: false }),
});
byId('setup-stats').addEventListener('click', () => stats.open());
// Your insignia on the first screen: where you stand on the leaderboard.
byId('you-rank').addEventListener('click', () => stats.open('leaderboard'));
byId('setup-whatsnew').addEventListener('click', () => whatsNew.open());
function welcome(): void {
  if (openedRoom) online.invite(openedRoom);
  else if (openedPlay) void openMatch(openedPlay);
  else if (autoRejoin) void online.rejoin(droppedSeat!);
  // What's new since this phone last looked (not over a link, nor in automated tests unless asked).
  if (!openedRoom && !openedPlay && !autoRejoin && params.whatsNew) whatsNew.showUnseen();
}
// A browser that's never been told who's playing asks first (automated tests only with `?askname`).
if (!loadUsername() && params.askName) {
  void namePrompt.ask(setup.suggestedName()).then((name) => {
    setUsername(name);
    welcome();
  });
} else {
  welcome();
}
// (No goodbye when the page goes away: a reload comes straight back. Leave says goodbye.)

/** Whether this phone may control the game right now (always, in a local game; never while watching). */
const localCanAct = () => !online.spectator && (!online.session || online.session.canAct());

bindControls(canvas, {
  canAim: () => state.phase === 'aiming' && localCanAct(),
  setAim: (a, p) => setAim(state, a, p),
  adjust: (da, dp) => adjustAim(state, da, dp),
  selectTier: (t) => selectTier(state, t),
  setDrive: (dir) => (driveDir = dir),
  canTap: () => (canPickDecoy(state) || pendingTwinSpot(state) !== null) && localCanAct(),
  tap: (x, y) => tapBattlefield(state, renderer, x, y),
  fire: () => fireNow(),
  done: () => finishDecoyPick(state),
  aimFrom: (x, y) => aimFromNear(state, renderer, x, y),
  switchAim: () => aimTwin(state, !currentPlayer(state).aimTwin),
  canDrum: () => state.phase === 'drumming' && localCanAct(),
  // When the finger came down, on the simulation's clock (the time since its last tick: what's left over in
  // `acc`, and since this frame began), less how late the music is heard.
  drum: (at) => drumTap(state, Math.min(0.1, Math.max(-0.2, acc + (at - last) / 1000 - chip.latency))),
});

/** Fire for whoever's turn it is on this phone (online, through the session, which tells the other phone). */
function fireNow(): boolean {
  return online.session ? online.session.fire() : fireHere();
}

const onResize = () => renderer.resize();
window.addEventListener('resize', onResize);
window.visualViewport?.addEventListener('resize', onResize);

/** Fire in a hotseat match (recording the shot as it's fired). */
function fireHere(): boolean {
  const shot = tape.firing(state);
  if (!fire(state)) return false;
  tape.shot(shot);
  return true;
}

// The game over card: watch the match again, or move on (no rematch: start a new game for that).
gameOver.replay.addEventListener('click', () => {
  if (online.replay) return online.replay.restart(); // Watch again
  const replay = tape.replay;
  if (!replay) return;
  if (online.session) online.close(); // done with the match (it's over)
  online.watchTape(replay);
});
gameOver.leave.addEventListener('click', () => {
  gameOver.hide();
  if (online.session || online.spectator) online.close();
  else setup.show();
});

// `?debug` exposes the live game to automated tests (read it, don't write it).
if (params.debug) {
  Object.assign(window, { __pooket: { get state() { return state; }, get net() { return online.session; }, get spectator() { return online.spectator; }, renderer, sfx, chip, log: netLogText, rankUp, RANKS } });
}

/** Best effort: Android Chrome supports both; iOS Safari ignores them (use Add to Home Screen). */
async function goFullscreen(): Promise<void> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await orientation.lock?.('landscape');
  } catch {
    /* not supported — the rotate prompt covers portrait */
  }
}

// Fixed-timestep simulation, render once per animation frame.
let last = performance.now();
let acc = 0;
function frame(now: number): void {
  // The next frame first: a bug in one frame is logged, and the game carries on rather than freezing.
  requestAnimationFrame(frame);
  try {
    runFrame(now);
  } catch (e) {
    frameError(e);
  }
}
const frameErrors = new Set<string>();
function frameError(e: unknown): void {
  const what = e instanceof Error ? `${e.message} ${e.stack?.split('\n')[1]?.trim() ?? ''}` : String(e);
  if (frameErrors.has(what)) return; // once each (it may happen every frame)
  frameErrors.add(what);
  console.error(e);
  netLog(`error in a frame: ${what}`);
}
function runFrame(now: number): void {
  const net = online.session;
  const replay = online.replay;
  const dt = Math.min(0.1, (now - last) / 1000) * (replay?.speed ?? 1);
  last = now;
  acc += dt;
  const paused = info.isOpen && !net && !online.spectator; // a local game waits while the info screen is up; online can't
  if (paused) acc = 0;
  while (acc >= FIXED_DT) {
    if (localCanAct()) {
      drive(state, driveDir, FIXED_DT);
      drumClock(state, FIXED_DT);
    }
    step(state, FIXED_DT);
    acc -= FIXED_DT;
  }
  // Band Aid's over: fire it (the round, and how it went, go to the other phone like any shot).
  if (drumsReady(state) && localCanAct()) fireNow();
  document.body.classList.toggle('drumming', state.phase === 'drumming');
  net?.tick(dt);
  if (net) online.matchFinished(state.phase === 'gameover');
  online.tick();
  online.spectator?.tick(dt);
  sfx.tunes.update(dt, paused);
  for (const e of state.sfx.splice(0)) sfx.play(e);
  renderer.draw(state, dt);
  hud.online = online.spectator ? { localSeat: -1, syncing: false } : net && !net.ended ? { localSeat: net.localSeat, syncing: net.awaitingSync } : null;
  viewing.update({ spectating: !!online.spectator, replay, online: !!net && !net.ended });
  if (state.phase === 'gameover') tape.end(state);
  gameOver.update(replay ? 'replay' : online.spectator ? 'watching' : net ? 'online' : 'hotseat', !!tape.replay);
  hud.update(state);
}
requestAnimationFrame(frame);

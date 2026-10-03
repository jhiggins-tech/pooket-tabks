/**
 * The page: wires the game, renderer, HUD, controls, sound and screens together and runs the
 * fixed-timestep loop (FIXED_DT). Hotseat by default; `net` / `online.spectator` when playing or
 * watching online.
 */
import './style.css';
import { randomSeed } from './core/rng';
import { FIXED_DT, TANK_BODY_HEIGHT, WORLD_H, WORLD_W } from './game/constants';
import { assignColours, getCharacter } from './characters/roster';
import {
  adjustAim,
  canPickDecoy,
  createGame,
  currentPlayer,
  drive,
  finishDecoyPick,
  fire,
  hologramAt,
  aimTwin,
  pendingTwinSpot,
  placeTwin,
  selectTier,
  setAim,
  step,
  toggleSwapTarget,
} from './game/game';
import type { GameState, PlayerConfig } from './game/state';
import { bindControls } from './input/controls';
import { Renderer } from './render/canvas';
import { Hud } from './render/hud';
import { Chip } from './audio/chip';
import { SfxPlayer } from './audio/sfx';
import { takePlayRef, takeRoomCode } from './net/links';
import { netLog, netLogText } from './net/log';
import { PUBLIC_LOBBY } from './net/lobby';
import { AUTO_REJOIN_MS, latestSeat, loadSeats, seatChanges } from './net/seat';
import { SeatSync } from './net/seatsync';
import { FIREBASE_API_KEY, FIREBASE_DATABASE_URL, GOOGLE_CLIENT_ID, VAPID_PUBLIC_KEY } from './net/config';
import { Account } from './net/account';
import { Auth } from './net/auth';
import { localProfile } from './app/localprofile';
import { SignInPanel } from './ui/signin';
import { wantsPush } from './net/push';
import { sealerFor } from './net/seal';
import { PushClient } from './push/client';
import { notifyWhileOpen } from './push/foreground';
import { NotifyButton } from './ui/notify';
import type { NetSession } from './net/session';
import { InfoScreen } from './ui/info';
import { WhatsNew } from './ui/whatsnew';
import { matchesOf } from './net/matches';
import { OnlineScreen } from './ui/online';
import { Rtdb } from './net/rtdb';
import { loadCharacter, loadUsername, NamePrompt, profileChanges } from './ui/profile';
import { Landing } from './ui/landing';
import { SetupScreen } from './ui/setup';
import { readParams } from './app/params';
import { setupSoundToggle } from './app/sound';
import { MatchTape } from './app/tape';
import { GameOverButtons } from './ui/gameover';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas, WORLD_W, WORLD_H);
const hud = new Hud();

const params = readParams(location.search, navigator.webdriver);
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
document.getElementById('hotseat-back')!.addEventListener('click', () => {
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
const soundToggle = setupSoundToggle(chip, document.getElementById('sound-toggle')!);

// Characters in this match show in their match colours; the rest in their signature colour.
const info = new InfoScreen(
  (id) => state.players.find((p) => p.characterId === id)?.colour ?? getCharacter(id).colours[0]!,
);
document.getElementById('info-open')!.addEventListener('click', () => info.open(currentPlayer(state).characterId));
document.getElementById('setup-info')!.addEventListener('click', () => info.open(loadCharacter() ?? setup.players()[0]?.characterId));
document.getElementById('hotseat-info')!.addEventListener('click', () => info.open(setup.players()[0]?.characterId));

/** Which drive button is held (−1 / 0 / +1); applied every simulation step. */
let driveDir = 0;

/** The match being played here, recorded to watch again from the game over card. */
const tape = new MatchTape();
const gameOver = new GameOverButtons();

/**
 * A fresh match on the battlefield (local, online, watched, or just the backdrop behind the menus).
 * `played`: it's played on this phone (hotseat, or online), so it's recorded.
 */
function startMatch(seed: number, chosen: PlayerConfig[], played = false): GameState {
  state = createGame({ seed, players: chosen, first });
  if (played) tape.start(seed, chosen);
  else tape.clear();
  hud.reset();
  sfx.tunes.stopAll();
  document.getElementById('gameover')!.hidden = true;
  return state;
}

/** A local (hotseat) match, with the players picked on the hotseat screen. */
function newGame(): void {
  startMatch(nextSeed, players, true);
  nextSeed = randomSeed();
}

// ---- Online: two phones, one each, through a Firebase room. Null in a local (hotseat) game. ----
let net: NetSession | null = null;
/** A signed-in player's matches from their account (set up with sign-in, below). */
let seatSync: SeatSync | null = null;
const online = new OnlineScreen({
  // Online you're you: your name, and the character you last played online.
  pick: () => ({ name: yourName(), characterId: loadCharacter() ?? setup.players()[0]!.characterId }),
  dbUrl: params.db || FIREBASE_DATABASE_URL || null,
  lobby: params.lobby || PUBLIC_LOBBY,
  relay: params.lostMs !== null ? { pingMs: 250, lostMs: params.lostMs } : undefined,
  syncSeats: () => seatSync?.sync() ?? Promise.resolve(),
});
/** An online match (or one being watched) starts: off the menus and into it. */
function startOnline(seed: number, chosen: PlayerConfig[], played = false): GameState {
  online.hide();
  hideMenus();
  return startMatch(seed, chosen, played);
}
online.onConnected = (s) => {
  net = s;
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
const spectateLeave = document.getElementById('spectate-leave')!;
spectateLeave.addEventListener('click', () => online.close());
// A replay can run faster: 1×, 2×, 4×.
const replaySpeed = document.getElementById('replay-speed')!;
replaySpeed.addEventListener('click', () => {
  const r = online.replay;
  if (!r) return;
  r.speed = r.speed >= 4 ? 1 : r.speed * 2;
  replaySpeed.textContent = `${r.speed}×`;
});
document.getElementById('net-menu')!.addEventListener('click', () => online.matchMenu());
// Start a match: the host, or a guest who joined an open game while its host was away. Players are [host, guest].
online.onHostStart = (s) => {
  const picks = s.isHost ? [s.localPick!, s.remotePick!] : [s.remotePick!, s.localPick!];
  const colours = assignColours(picks.map((p) => p.characterId));
  s.start(randomSeed(), picks.map((p, i) => ({ name: p.name, characterId: p.characterId, colour: colours[i]! })));
};
online.onClosed = () => {
  net = null;
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
// ---- Notifications ("your turn", "someone joined your game"): push/, net/push.ts, public/sw.js. ----
// ---- Optional sign in with Google: net/auth.ts, net/account.ts (the profile follows the player),
// net/seatsync.ts (and so do their matches), ui/signin.ts. ----
const fakeAuth = params.fakeGoogle !== null && params.db ? params.db : null;
const auth = new Auth({
  apiKey: FIREBASE_API_KEY,
  ...(fakeAuth ? { signInUrl: `${fakeAuth}/identitytoolkit/signInWithIdp`, refreshUrl: `${fakeAuth}/securetoken/token` } : {}),
});
// (A test database has no real accounts: only the fake one, `?fakegoogle`.)
if (online.dbUrl && (fakeAuth || (!params.db && FIREBASE_API_KEY && GOOGLE_CLIENT_ID))) {
  const userDb = new Rtdb(online.dbUrl, () => auth.token());
  const account = new Account(auth, userDb, localProfile, () => {
    setUsername(yourName());
    soundToggle.reload();
  });
  const seats = new SeatSync(auth, userDb, () => {
    if (landing.isOpen) updateTurnsWaiting();
  });
  seatSync = seats;
  profileChanges.on('saved', () => account.changed());
  seatChanges.on('changed', (code) => seats.changed(code));
  new SignInPanel(document.getElementById('account')!, auth, {
    clientId: GOOGLE_CLIENT_ID,
    fakeGoogle: params.fakeGoogle,
    onSignedIn: () => {
      void account.sync();
      void seats.sync();
    },
  });
  void account.sync();
  void seats.sync();
}
const pushDb = online.dbUrl ? new Rtdb(online.dbUrl) : null;
const push = new PushClient(pushDb, params.vapid ?? VAPID_PUBLIC_KEY);
void push.start();
new NotifyButton(push);
/** A notification was tapped: into that match (one of this phone's), else the Game browser. */
async function openMatch(ref: string): Promise<void> {
  netLog('ui: opened from a notification');
  if (online.roomTopic === ref) return;
  for (const seat of loadSeats()) {
    if ((await sealerFor('room', seat.code)).topic === ref) return void online.rejoin(seat);
  }
  void online.join();
}
if (pushDb && wantsPush()) notifyWhileOpen(pushDb, { open: (ref) => void openMatch(ref), here: (ref) => online.roomTopic === ref });
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
document.getElementById('setup-whatsnew')!.addEventListener('click', () => whatsNew.open());
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
const localCanAct = () => !online.spectator && (!net || net.canAct());

bindControls(canvas, {
  canAim: () => state.phase === 'aiming' && localCanAct(),
  setAim: (a, p) => setAim(state, a, p),
  adjust: (da, dp) => adjustAim(state, da, dp),
  selectTier: (t) => selectTier(state, t),
  setDrive: (dir) => (driveDir = dir),
  canTap: () => (canPickDecoy(state) || pendingTwinSpot(state) !== null) && localCanAct(),
  tap: (x, y) => {
    const w = renderer.screenToWorld(x, y);
    // Placing torikloud's twin: wherever the ground was tapped (if it's allowed there).
    if (pendingTwinSpot(state) !== null) return void placeTwin(state, w.x);
    // Generous finger-sized radius (~30 CSS px).
    const holo = hologramAt(state, w.x, w.y, 30 / renderer.cssScale);
    if (holo) toggleSwapTarget(state, holo.id);
  },
  fire: () => (net ? net.fire() : fireHere()),
  done: () => finishDecoyPick(state),
  aimFrom: (x, y) => {
    // torikloud with a twin: a drag that starts near one of the tanks aims that one.
    const p = currentPlayer(state);
    if (!p.twin) return;
    const w = renderer.screenToWorld(x, y);
    const near = 60 / renderer.cssScale;
    const dMain = Math.hypot(w.x - p.x, w.y - (p.y - TANK_BODY_HEIGHT));
    const dTwin = Math.hypot(w.x - p.twin.x, w.y - (p.twin.y - TANK_BODY_HEIGHT));
    if (Math.min(dMain, dTwin) < near) aimTwin(state, dTwin < dMain);
  },
  switchAim: () => aimTwin(state, !currentPlayer(state).aimTwin),
});

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
  if (net) online.close(); // done with the match (it's over)
  online.watchTape(replay);
});
gameOver.leave.addEventListener('click', () => {
  document.getElementById('gameover')!.hidden = true;
  if (net || online.spectator) online.close();
  else setup.show();
});

// `?debug` exposes the live game to automated tests (read it, don't write it).
if (params.debug) {
  Object.assign(window, { __pooket: { get state() { return state; }, get net() { return net; }, get spectator() { return online.spectator; }, renderer, sfx, chip, log: netLogText } });
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
  const replay = online.replay;
  const dt = Math.min(0.1, (now - last) / 1000) * (replay?.speed ?? 1);
  last = now;
  acc += dt;
  const paused = info.isOpen && !net && !online.spectator; // a local game waits while the info screen is up; online can't
  if (paused) acc = 0;
  while (acc >= FIXED_DT) {
    if (localCanAct()) drive(state, driveDir, FIXED_DT);
    step(state, FIXED_DT);
    acc -= FIXED_DT;
  }
  net?.tick(dt);
  if (net) online.matchFinished(state.phase === 'gameover');
  online.tick();
  online.spectator?.tick(dt);
  sfx.tunes.update(dt, paused);
  for (const e of state.sfx.splice(0)) sfx.play(e);
  renderer.draw(state, dt);
  hud.online = online.spectator ? { localSeat: -1, syncing: false } : net && !net.lost ? { localSeat: net.localSeat, syncing: net.awaitingSync } : null;
  document.body.dataset.spectating = String(!!online.spectator);
  if (document.body.dataset.replay !== String(!!replay)) {
    document.body.dataset.replay = String(!!replay);
    spectateLeave.textContent = replay ? '▶ Replay · Leave' : '👁 Watching · Leave';
    spectateLeave.setAttribute('aria-label', replay ? 'Stop the replay' : 'Stop watching');
    replaySpeed.textContent = `${replay?.speed ?? 1}×`;
  }
  document.body.dataset.online = String(!!net && !net.lost);
  if (state.phase === 'gameover') tape.end(state);
  gameOver.update(replay ? 'replay' : online.spectator ? 'watching' : net ? 'online' : 'hotseat', !!tape.replay);
  hud.update(state);
}
requestAnimationFrame(frame);

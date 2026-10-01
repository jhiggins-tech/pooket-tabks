/**
 * The page: wires the game, renderer, HUD, controls, sound and screens together and runs the
 * fixed-timestep loop (FIXED_DT). Hotseat by default; `net` / `online.spectator` when playing or
 * watching online.
 */
import './style.css';
import { randomSeed } from './core/rng';
import { FIXED_DT, WORLD_H, WORLD_W } from './game/constants';
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
import { takeRoomCode } from './net/links';
import { netLog, netLogText } from './net/log';
import { PUBLIC_LOBBY } from './net/lobby';
import { AUTO_REJOIN_MS, latestSeat } from './net/seat';
import { FIREBASE_DATABASE_URL } from './net/config';
import type { NetSession } from './net/session';
import { InfoScreen } from './ui/info';
import { WhatsNew } from './ui/whatsnew';
import { matchesOf, OnlineScreen } from './ui/online';
import { Rtdb } from './net/rtdb';
import { loadCharacter, loadUsername, NamePrompt } from './ui/profile';
import { Landing } from './ui/landing';
import { SetupScreen } from './ui/setup';
import { readParams } from './app/params';
import { setupSoundToggle } from './app/sound';

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
setupSoundToggle(chip, document.getElementById('sound-toggle')!);

// Characters in this match show in their match colours; the rest in their signature colour.
const info = new InfoScreen(
  (id) => state.players.find((p) => p.characterId === id)?.colour ?? getCharacter(id).colours[0]!,
);
document.getElementById('info-open')!.addEventListener('click', () => info.open(currentPlayer(state).characterId));
document.getElementById('setup-info')!.addEventListener('click', () => info.open(loadCharacter() ?? setup.players()[0]?.characterId));
document.getElementById('hotseat-info')!.addEventListener('click', () => info.open(setup.players()[0]?.characterId));

/** Which drive button is held (−1 / 0 / +1); applied every simulation step. */
let driveDir = 0;

/** A fresh match on the battlefield (local, online, watched, or just the backdrop behind the menus). */
function startMatch(seed: number, chosen: PlayerConfig[]): GameState {
  state = createGame({ seed, players: chosen, first });
  hud.reset();
  sfx.tunes.stopAll();
  document.getElementById('gameover')!.hidden = true;
  return state;
}

/** A local (hotseat) match, with the players picked on the hotseat screen. */
function newGame(): void {
  startMatch(nextSeed, players);
  nextSeed = randomSeed();
}

// ---- Online: two phones, one each, through a Firebase room. Null in a local (hotseat) game. ----
let net: NetSession | null = null;
const online = new OnlineScreen({
  // Online you're you: your name, and the character you last played online (changeable in the lobby).
  pick: () => ({ name: yourName(), characterId: loadCharacter() ?? setup.players()[0]!.characterId }),
  dbUrl: params.db || FIREBASE_DATABASE_URL || null,
  lobby: params.lobby || PUBLIC_LOBBY,
  relay: params.lostMs !== null ? { pingMs: 250, lostMs: params.lostMs } : undefined,
});
/** An online match (or one being watched) starts: off the menus and into it. */
function startOnline(seed: number, chosen: PlayerConfig[]): GameState {
  online.hide();
  hideMenus();
  return startMatch(seed, chosen);
}
online.onConnected = (s) => {
  net = s;
  // Both phones build the same game from the same seed; the session keeps them in step.
  s.onStart = (seed, chosen) => {
    void goFullscreen();
    return startOnline(seed, chosen);
  };
};
// Watching someone else's match (live, or a replay): view only.
online.onSpectate = (sp) => {
  sp.onStart = startOnline;
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
function showLanding(): void {
  setup.hide();
  landing.show();
  landing.setName(yourName());
  const url = online.dbUrl;
  if (!url) return;
  const check = ++turnsCheck;
  void matchesOf(new Rtdb(url)).then((games) => {
    if (check === turnsCheck) landing.setTurnsWaiting(games.filter((g) => g.status === 'your-turn').length);
  });
  stopCounts();
  stopCounts = online.watchCounts((waiting, live) => landing.setCounts(waiting, live));
}
// Opened from a room link: join that room (or rejoin it, if it's ours). Reloaded mid-match: straight back in.
const openedRoom = takeRoomCode();
const droppedSeat = latestSeat();
const autoRejoin = !openedRoom && !!droppedSeat && !droppedSeat.left && Date.now() - droppedSeat.ts < AUTO_REJOIN_MS;
showLanding();
const whatsNew = new WhatsNew();
document.getElementById('setup-whatsnew')!.addEventListener('click', () => whatsNew.open());
function welcome(): void {
  if (openedRoom) online.invite(openedRoom);
  else if (autoRejoin) void online.rejoin(droppedSeat!);
  // What's new since this phone last looked (not over a room link, nor in automated tests unless asked).
  if (!openedRoom && !autoRejoin && params.whatsNew) whatsNew.showUnseen();
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
  canTap: () => canPickDecoy(state) && localCanAct(),
  tap: (x, y) => {
    const w = renderer.screenToWorld(x, y);
    // Generous finger-sized radius (~30 CSS px).
    const holo = hologramAt(state, w.x, w.y, 30 / renderer.cssScale);
    if (holo) toggleSwapTarget(state, holo.id);
  },
  fire: () => (net ? net.fire() : fire(state)),
  done: () => finishDecoyPick(state),
});

const onResize = () => renderer.resize();
window.addEventListener('resize', onResize);
window.visualViewport?.addEventListener('resize', onResize);

document.getElementById('rematch')!.addEventListener('click', () => {
  if (online.replay) online.replay.restart(); // Watch again
  else if (!net) newGame();
  else if (net.isHost) online.onHostStart(net);
});
document.getElementById('change-players')!.addEventListener('click', () => {
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
  hud.online = online.spectator ? { localSeat: -1, syncing: false, replay: !!replay } : net && !net.lost ? { localSeat: net.localSeat, syncing: net.awaitingSync } : null;
  document.body.dataset.spectating = String(!!online.spectator);
  if (document.body.dataset.replay !== String(!!replay)) {
    document.body.dataset.replay = String(!!replay);
    spectateLeave.textContent = replay ? '▶ Replay · Leave' : '👁 Watching · Leave';
    spectateLeave.setAttribute('aria-label', replay ? 'Stop the replay' : 'Stop watching');
    replaySpeed.textContent = `${replay?.speed ?? 1}×`;
  }
  document.body.dataset.online = String(!!net && !net.lost);
  hud.update(state);
}
requestAnimationFrame(frame);

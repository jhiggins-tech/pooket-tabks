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
import { publicAddress } from './net/lan';
import { takeRoomCode } from './net/links';
import { AUTO_REJOIN_MS, loadSeat } from './net/seat';
import { FIREBASE_DATABASE_URL } from './net/config';
import type { NetSession } from './net/session';
import { InfoScreen } from './ui/info';
import { WhatsNew } from './ui/whatsnew';
import { OnlineScreen } from './ui/online';
import { SetupScreen } from './ui/setup';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas, WORLD_W, WORLD_H);
const hud = new Hud();

// `?seed=N` fixes the first map (handy for tests and sharing a layout).
const seedParam = Number(new URLSearchParams(location.search).get('seed'));
let nextSeed = Number.isFinite(seedParam) && seedParam > 0 ? seedParam : randomSeed();
// Who goes first is random (from the seed, so both phones agree). Automated tests get player 1
// unless they ask: `?first=random`, or `?first=N` for player N + 1.
const firstParam = new URLSearchParams(location.search).get('first') ?? (navigator.webdriver ? '0' : 'random');
const first: number | 'random' = firstParam === 'random' ? 'random' : Number(firstParam) || 0;
let players: PlayerConfig[] = [];

const setup = new SetupScreen((chosen) => {
  players = chosen;
  setup.hide();
  newGame();
  void goFullscreen();
});

// A live battlefield sits behind the setup screen until the real match starts.
let state: GameState = createGame({ seed: nextSeed, players: setup.players(), first });

// Kitschy 8-bit sound effects, synthesised live. Audio can only start from a user gesture.
const SOUND_KEY = 'pooket-tabks.sound';
const chip = new Chip();
const sfx = new SfxPlayer(chip, () => chip.now);
const soundBtn = document.getElementById('sound-toggle')!;
function setSound(on: boolean): void {
  chip.setMuted(!on);
  soundBtn.textContent = on ? '🔊' : '🔇';
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    /* not critical */
  }
}
let soundOn = true;
try {
  soundOn = localStorage.getItem(SOUND_KEY) !== 'off';
} catch {
  /* storage unavailable */
}
setSound(soundOn);
soundBtn.addEventListener('click', () => {
  chip.unlock();
  soundOn = !soundOn;
  setSound(soundOn);
});
window.addEventListener('pointerdown', () => chip.unlock(), { capture: true });

// Characters in this match show in their match colours; the rest in their signature colour.
const info = new InfoScreen(
  (id) => state.players.find((p) => p.characterId === id)?.colour ?? getCharacter(id).colours[0]!,
);
document.getElementById('info-open')!.addEventListener('click', () => info.open(currentPlayer(state).characterId));
document.getElementById('setup-info')!.addEventListener('click', () => info.open(setup.players()[0]?.characterId));

/** Which drive button is held (−1 / 0 / +1); applied every simulation step. */
let driveDir = 0;

function newGame(): void {
  state = createGame({ seed: nextSeed, players, first });
  nextSeed = randomSeed();
  hud.reset();
  sfx.tunes.stopAll();
}

// ---- Online: two phones, one each, through a Firebase room. Null in a local (hotseat) game. ----
let net: NetSession | null = null;
// `?debug&db=URL` points at a test database; `&lan=X` fakes the Wi-Fi's shared address (`none`: unknown).
const query = new URLSearchParams(location.search);
const debugNet = query.has('debug');
const online = new OnlineScreen({
  pick: () => {
    const p = setup.players()[0]!;
    return { name: p.name, characterId: p.characterId };
  },
  dbUrl: (debugNet && query.get('db')) || FIREBASE_DATABASE_URL || null,
  lanId: async () => (debugNet && query.has('lan') ? (query.get('lan') === 'none' ? null : query.get('lan')) : publicAddress()),
  // `?debug&lost=MS`: notice a quiet phone sooner (tests).
  relay: debugNet && query.has('lost') ? { pingMs: 250, lostMs: Number(query.get('lost')) } : undefined,
});
online.onConnected = (s) => {
  net = s;
  s.onStart = (seed, chosen) => {
    // Both phones build the same game from the same seed; the session keeps them in step.
    state = createGame({ seed, players: chosen, first });
    hud.reset();
    sfx.tunes.stopAll();
    online.hide();
    setup.hide();
    document.getElementById('gameover')!.hidden = true;
    void goFullscreen();
    return state;
  };
};
// Watching someone else's match: view only.
online.onSpectate = (sp) => {
  sp.onStart = (seed, chosen) => {
    state = createGame({ seed, players: chosen, first });
    hud.reset();
    sfx.tunes.stopAll();
    online.hide();
    setup.hide();
    document.getElementById('gameover')!.hidden = true;
    return state;
  };
};
document.getElementById('spectate-leave')!.addEventListener('click', () => online.close());
online.onHostStart = (s) => {
  const picks = [s.localPick!, s.remotePick!];
  const colours = assignColours(picks.map((p) => p.characterId));
  s.start(randomSeed(), picks.map((p, i) => ({ name: p.name, characterId: p.characterId, colour: colours[i]! })));
};
online.onClosed = () => {
  net = null;
  // Back to the setup screen, with a fresh battlefield behind it.
  state = createGame({ seed: randomSeed(), players: setup.players(), first });
  hud.reset();
  sfx.tunes.stopAll();
  document.getElementById('gameover')!.hidden = true;
  setup.show();
  showRejoin();
};
// A match this phone dropped out of (a reload, the app killed, lost signal): offer to rejoin it.
const rejoinBtn = document.getElementById('setup-rejoin') as HTMLButtonElement;
function showRejoin(): void {
  const seat = loadSeat();
  rejoinBtn.hidden = !seat;
  if (seat) rejoinBtn.textContent = `↩ Rejoin ${seat.code}`;
}
rejoinBtn.addEventListener('click', () => {
  const seat = loadSeat();
  if (seat) void online.rejoin(seat);
  else showRejoin();
});
document.getElementById('host-online')!.addEventListener('click', () => void online.host());
document.getElementById('join-online')!.addEventListener('click', () => void online.join());
// Opened from a room link: join that room (or rejoin it, if it's ours). Reloaded mid-match: straight back in.
const openedRoom = takeRoomCode();
const droppedSeat = loadSeat();
const autoRejoin = !openedRoom && !!droppedSeat && Date.now() - droppedSeat.ts < AUTO_REJOIN_MS;
if (openedRoom) online.invite(openedRoom);
else if (autoRejoin) void online.rejoin(droppedSeat!);
showRejoin();

// What's new since this phone last looked (not over a room link, nor in automated tests unless asked).
const whatsNew = new WhatsNew();
document.getElementById('setup-whatsnew')!.addEventListener('click', () => whatsNew.open());
if (!openedRoom && !autoRejoin && (!navigator.webdriver || query.has('whatsnew'))) whatsNew.showUnseen();
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
  if (!net) newGame();
  else if (net.isHost) online.onHostStart(net);
});
document.getElementById('change-players')!.addEventListener('click', () => {
  document.getElementById('gameover')!.hidden = true;
  if (net || online.spectator) online.close();
  else setup.show();
});

// `?debug` exposes the live game to automated tests (read it, don't write it).
if (new URLSearchParams(location.search).has('debug')) {
  Object.assign(window, { __pooket: { get state() { return state; }, get net() { return net; }, get spectator() { return online.spectator; }, renderer, sfx, chip } });
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
  const dt = Math.min(0.1, (now - last) / 1000);
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
  online.spectator?.tick(dt);
  sfx.tunes.update(dt, paused);
  if (state.sfx.length > 0) {
    for (const e of state.sfx) sfx.play(e);
    state.sfx.length = 0;
  }
  renderer.draw(state, dt);
  hud.online = online.spectator ? { localSeat: -1, syncing: false } : net && !net.lost ? { localSeat: net.localSeat, syncing: net.awaitingSync } : null;
  document.body.dataset.spectating = String(!!online.spectator);
  hud.update(state);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

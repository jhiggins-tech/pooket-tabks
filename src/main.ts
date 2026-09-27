import './style.css';
import { randomSeed } from './core/rng';
import { FIXED_DT, WORLD_H, WORLD_W } from './game/constants';
import { getCharacter } from './characters/roster';
import { adjustAim, createGame, currentPlayer, drive, fire, hologramAt, selectTier, setAim, step, toggleSwapTarget } from './game/game';
import type { GameState, PlayerConfig } from './game/state';
import { bindControls } from './input/controls';
import { Renderer } from './render/canvas';
import { Hud } from './render/hud';
import { Chip } from './audio/chip';
import { SfxPlayer } from './audio/sfx';
import { InfoScreen } from './ui/info';
import { SetupScreen } from './ui/setup';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas, WORLD_W, WORLD_H);
const hud = new Hud();

// `?seed=N` fixes the first map (handy for tests and sharing a layout).
const seedParam = Number(new URLSearchParams(location.search).get('seed'));
let nextSeed = Number.isFinite(seedParam) && seedParam > 0 ? seedParam : randomSeed();
let players: PlayerConfig[] = [];

const setup = new SetupScreen((chosen) => {
  players = chosen;
  setup.hide();
  newGame();
  void goFullscreen();
});

// A live battlefield sits behind the setup screen until the real match starts.
let state: GameState = createGame({ seed: nextSeed, players: setup.players() });

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
  state = createGame({ seed: nextSeed, players });
  nextSeed = randomSeed();
  hud.reset();
  sfx.tunes.stopAll();
}

bindControls(canvas, {
  canAim: () => state.phase === 'aiming',
  setAim: (a, p) => setAim(state, a, p),
  adjust: (da, dp) => adjustAim(state, da, dp),
  selectTier: (t) => selectTier(state, t),
  setDrive: (dir) => (driveDir = dir),
  tap: (x, y) => {
    const w = renderer.screenToWorld(x, y);
    // Generous finger-sized radius (~30 CSS px).
    const holo = hologramAt(state, w.x, w.y, 30 / renderer.cssScale);
    if (holo) toggleSwapTarget(state, holo.id);
  },
  fire: () => fire(state),
});

const onResize = () => renderer.resize();
window.addEventListener('resize', onResize);
window.visualViewport?.addEventListener('resize', onResize);

document.getElementById('rematch')!.addEventListener('click', newGame);
document.getElementById('change-players')!.addEventListener('click', () => {
  document.getElementById('gameover')!.hidden = true;
  setup.show();
});

// `?debug` exposes the live game to automated tests (read it, don't write it).
if (new URLSearchParams(location.search).has('debug')) {
  Object.assign(window, { __pooket: { get state() { return state; }, renderer, sfx, chip } });
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
  if (info.isOpen) acc = 0; // the game waits while the info screen is up
  while (acc >= FIXED_DT) {
    drive(state, driveDir, FIXED_DT);
    step(state, FIXED_DT);
    acc -= FIXED_DT;
  }
  sfx.tunes.update(dt, info.isOpen);
  if (state.sfx.length > 0) {
    for (const e of state.sfx) sfx.play(e);
    state.sfx.length = 0;
  }
  renderer.draw(state, dt);
  hud.update(state);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

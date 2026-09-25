import './style.css';
import { randomSeed } from './core/rng';
import { FIXED_DT, WORLD_H, WORLD_W } from './game/constants';
import { adjustAim, createGame, fire, hologramAt, selectTier, setAim, step, toggleSwapTarget } from './game/game';
import type { GameState, PlayerConfig } from './game/state';
import { bindControls } from './input/controls';
import { Renderer } from './render/canvas';
import { Hud } from './render/hud';
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

function newGame(): void {
  state = createGame({ seed: nextSeed, players });
  nextSeed = randomSeed();
  hud.reset();
}

bindControls(canvas, {
  canAim: () => state.phase === 'aiming',
  setAim: (a, p) => setAim(state, a, p),
  adjust: (da, dp) => adjustAim(state, da, dp),
  selectTier: (t) => selectTier(state, t),
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
  Object.assign(window, { __pooket: { get state() { return state; }, renderer } });
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
  while (acc >= FIXED_DT) {
    step(state, FIXED_DT);
    acc -= FIXED_DT;
  }
  renderer.draw(state, dt);
  hud.update(state);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

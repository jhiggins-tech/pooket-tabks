import './style.css';
import { randomSeed } from './core/rng';
import { FIXED_DT, WORLD_H, WORLD_W } from './game/constants';
import { adjustAim, createGame, fire, setAim, step } from './game/game';
import type { GameState, PlayerConfig } from './game/state';
import { bindControls } from './input/controls';
import { Renderer } from './render/canvas';
import { Hud } from './render/hud';

const PLAYERS: PlayerConfig[] = [
  { name: 'Player 1', colour: '#ff5a5f' },
  { name: 'Player 2', colour: '#4ea8ff' },
];

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas, WORLD_W, WORLD_H);
const hud = new Hud();

const seedParam = Number(new URLSearchParams(location.search).get('seed'));
let state: GameState = createGame({
  seed: Number.isFinite(seedParam) && seedParam > 0 ? seedParam : randomSeed(),
  players: PLAYERS,
});

bindControls(canvas, {
  canAim: () => state.phase === 'aiming',
  setAim: (a, p) => setAim(state, a, p),
  adjust: (da, dp) => adjustAim(state, da, dp),
  fire: () => fire(state),
});

const onResize = () => renderer.resize();
window.addEventListener('resize', onResize);
window.visualViewport?.addEventListener('resize', onResize);

document.getElementById('start')!.addEventListener('click', () => {
  document.getElementById('title')!.hidden = true;
  void goFullscreen();
});

document.getElementById('again')!.addEventListener('click', () => {
  state = createGame({ seed: randomSeed(), players: PLAYERS });
  hud.reset();
});

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

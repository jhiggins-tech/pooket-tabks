import { MAX_HP } from '../game/constants';
import { currentPlayer } from '../game/game';
import type { GameState } from '../game/state';

/** Keeps the DOM overlay in sync with game state, touching the DOM only on change. */
export class Hud {
  private readonly playersEl = byId('players');
  private readonly angleEl = byId('angle');
  private readonly powerEl = byId('power');
  private readonly bannerEl = byId('turn-banner');
  private readonly fireEl = byId<HTMLButtonElement>('fire');
  private readonly gameOverEl = byId('gameover');
  private readonly winnerEl = byId('winner');
  private last = '';
  private lastTurnKey = '';

  update(state: GameState): void {
    const p = currentPlayer(state);
    const key = [
      state.phase,
      state.current,
      state.turn,
      p.angle,
      p.power,
      ...state.players.map((pl) => `${pl.hp}${pl.name}`),
    ].join('|');
    if (key === this.last) return;
    this.last = key;

    document.body.dataset.phase = state.phase;
    document.body.dataset.turn = String(state.turn);
    document.body.style.setProperty('--player-colour', p.colour);

    this.playersEl.replaceChildren(
      ...state.players.map((pl) => {
        const el = document.createElement('div');
        el.className = 'chip';
        el.classList.toggle('active', pl === p && state.phase !== 'gameover');
        el.classList.toggle('dead', !pl.alive);
        el.style.setProperty('--c', pl.colour);
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = pl.name;
        const bar = document.createElement('span');
        bar.className = 'hp';
        const fill = document.createElement('span');
        fill.style.width = `${(pl.hp / MAX_HP) * 100}%`;
        bar.append(fill);
        el.append(name, bar);
        return el;
      }),
    );

    this.angleEl.textContent = `${angleLabel(p.angle)}`;
    this.powerEl.textContent = `${p.power}`;
    this.fireEl.disabled = state.phase !== 'aiming';

    const turnKey = `${state.turn}:${state.phase === 'gameover'}`;
    if (turnKey !== this.lastTurnKey && state.phase === 'aiming') {
      this.bannerEl.textContent = `${p.name}'s turn`;
      this.bannerEl.style.color = p.colour;
      this.bannerEl.classList.remove('show');
      void this.bannerEl.offsetWidth; // restart the CSS animation
      this.bannerEl.classList.add('show');
    }
    this.lastTurnKey = turnKey;

    this.gameOverEl.hidden = state.phase !== 'gameover';
    if (state.phase === 'gameover') {
      this.winnerEl.textContent = state.winner ? `${state.winner.name} wins!` : 'Draw!';
      this.winnerEl.style.color = state.winner?.colour ?? '#fff';
    }
  }

  reset(): void {
    this.last = '';
    this.lastTurnKey = '';
  }
}

/** Show angle as degrees from horizontal on the side the barrel points. */
function angleLabel(angle: number): string {
  return angle <= 90 ? `${angle}° ▸` : `◂ ${180 - angle}°`;
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
}

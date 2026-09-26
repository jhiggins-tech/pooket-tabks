import { FUEL_PER_MATCH, MAX_HP } from '../game/constants';
import { AMMO_PER_TIER } from '../characters/roster';
import { currentPlayer, hologramsOf, isAimless, jetCharge, weaponForTier } from '../game/game';
import { getCharacter } from '../characters/roster';
import { getWeapon } from '../weapons/registry';
import type { GameState } from '../game/state';

/** Keeps the DOM overlay in sync with game state, touching the DOM only on change. */
export class Hud {
  private readonly playersEl = byId('players');
  private readonly angleEl = byId('angle');
  private readonly powerEl = byId('power');
  private readonly bannerEl = byId('turn-banner');
  private readonly fireEl = byId<HTMLButtonElement>('fire');
  private readonly weaponsEl = byId('weapons');
  private readonly hintEl = byId('hint');
  private readonly fuelEl = byId('fuel-fill');
  private readonly fuelLabel = document.querySelector<HTMLElement>('.fuel small')!;
  private readonly driveEl = document.querySelector<HTMLElement>('.drive')!;
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
      p.selectedTier,
      Math.round(p.fuel),
      state.holograms.length,
      state.swapTargetId,
      jetCountdown(state),
      p.ammo.join(','),
      ...state.players.map(
        (pl) =>
          `${pl.hp}/${pl.twin?.hp ?? '-'}${pl.name}${pl.burn?.turnsLeft ?? ''}${pl.cooked ? (pl.cooked.active ? 'C' : 'c') : ''}` +
          `${pl.tattoo?.turnsLeft ?? ''}${pl.pinned ? 'P' : ''}`,
      ),
    ].join('|');
    if (key === this.last) return;
    this.last = key;

    document.body.dataset.phase = state.phase;
    const aimless = isAimless(state);
    document.body.dataset.aimless = String(aimless);
    const decoys = hologramsOf(state, p.id).length;
    const countdown = jetCountdown(state);
    document.body.dataset.charging = String(countdown !== null);
    this.hintEl.textContent = countdown !== null
      ? `ten-2 charging… ${countdown}`
      : aimless
      ? 'No aiming needed. Just FIRE'
      : decoys > 0
        ? state.swapTargetId !== null
          ? 'Swapping to that decoy after you fire'
          : 'Drag to aim · tap a decoy to swap after firing'
        : 'Drag & pull back to aim';
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
        // One bar, or two half-size bars once Twins has split the health between two tanks.
        const bar = document.createElement('span');
        bar.className = 'bars';
        const bars = pl.twin ? [pl.hp, pl.twin.hp] : [pl.hp];
        for (const hp of bars) {
          const track = document.createElement('span');
          track.className = 'hp';
          const fill = document.createElement('span');
          fill.style.width = `${(hp / (pl.twin ? MAX_HP / 2 : MAX_HP)) * 100}%`;
          track.append(fill);
          bar.append(track);
        }
        if (pl.tattoo && pl.alive) name.append(Object.assign(document.createElement('span'), { className: 'tattoo', textContent: ' ✒', title: 'Tattooed: takes extra damage' }));
        if (pl.pinned && pl.alive) name.append(Object.assign(document.createElement('span'), { className: 'pinned', textContent: ' 📌', title: 'Pinned: can’t move next turn' }));
        if (pl.cooked && pl.alive) {
          const cooked = document.createElement('span');
          cooked.className = 'cooked';
          cooked.textContent = ' 🍳';
          cooked.title = pl.cooked.active ? 'Cooked: half damage this turn' : 'Cooked: half damage next turn';
          name.append(cooked);
        }
        if (pl.burn && pl.alive) {
          const burn = document.createElement('span');
          burn.className = 'burn';
          burn.style.color = pl.burn.colour;
          burn.textContent = ` ✦${pl.burn.turnsLeft}`;
          burn.title = `Burning: ${pl.burn.damagePerTurn} damage for ${pl.burn.turnsLeft} more turns`;
          name.append(burn);
        }
        el.append(name, bar);
        return el;
      }),
    );

    this.fuelEl.style.width = `${(p.fuel / FUEL_PER_MATCH) * 100}%`;
    this.fuelLabel.textContent = getCharacter(p.characterId).movement === 'hop' ? 'HOPS' : 'FUEL';
    this.driveEl.dataset.empty = String(p.fuel <= 0.5);
    for (const b of this.driveEl.querySelectorAll('button')) b.disabled = state.phase !== 'aiming' || p.fuel <= 0.5;
    this.angleEl.textContent = `${angleLabel(p.angle)}`;
    this.powerEl.textContent = `${p.power}`;
    this.fireEl.disabled = state.phase !== 'aiming' || (p.ammo[p.selectedTier] ?? 0) <= 0;
    this.weaponsEl.replaceChildren(
      ...p.loadout.map((_, tier) => {
        const w = weaponForTier(p, tier);
        const left = p.ammo[tier] ?? 0;
        const btn = document.createElement('button');
        btn.className = 'weapon';
        btn.dataset.tier = String(tier);
        btn.classList.toggle('selected', tier === p.selectedTier);
        btn.disabled = left <= 0 || state.phase !== 'aiming';
        btn.setAttribute('aria-label', `${w.name}, ${left} left`);
        btn.setAttribute('aria-pressed', String(tier === p.selectedTier));
        const name = document.createElement('span');
        name.className = 'wname';
        name.textContent = w.shortName;
        name.classList.toggle('long', w.shortName.length > 8);
        const pips = document.createElement('span');
        pips.className = 'pips';
        const max = AMMO_PER_TIER[tier] ?? left;
        pips.textContent = '●'.repeat(left) + '○'.repeat(Math.max(0, max - left));
        btn.append(name, pips);
        return btn;
      }),
    );

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

/** Whole seconds left on the current player's ten-2 charge, or null. */
function jetCountdown(state: GameState): number | null {
  const p = currentPlayer(state);
  const jet = state.jets.find((j) => j.playerId === p.id);
  if (jetCharge(state, p.id) === null || !jet) return null;
  return Math.max(1, Math.ceil(getWeapon(jet.weaponId).jetpack!.chargeTime - jet.elapsed));
}

/**
 * Show aim as elevation above (+) or below (−) the horizon, on the side the barrel points:
 * 45 → "45° ▸", 135 → "◂ 45°", 330 → "−30° ▸", 210 → "◂ −30°", 90 → "90° ▴", 270 → "90° ▾".
 */
export function angleLabel(angle: number): string {
  const a = ((Math.round(angle) % 360) + 360) % 360;
  if (a === 90) return '90° ▴';
  if (a === 270) return '90° ▾';
  const fmt = (e: number) => (e < 0 ? `−${-e}°` : `${e}°`);
  if (a < 90) return `${fmt(a)} ▸`;
  if (a > 270) return `${fmt(a - 360)} ▸`;
  return `◂ ${fmt(180 - a)}`;
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
}

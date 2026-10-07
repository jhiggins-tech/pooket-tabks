/** The HUD's weapon buttons: rebuilt only when the loadout, rounds, selection or phase change. */
import { AMMO_PER_TIER } from '../../characters/roster';
import { canSuckYolk, canUseSlot, coffeeFailChance, isCoffee, weaponForTier, YOLK_SUCKER, yolkTier } from '../../game/game';
import type { GameState, Player } from '../../game/state';
import { byId, el } from '../../ui/dom';
import { keyed, type Part } from './part';

export function weapons(): Part {
  const weaponsEl = byId('weapons');
  return keyed(
    (state, { p }) =>
      `${p.id}|${p.loadout.join(',')}|${p.ammo.join(',')}|${p.selectedTier}|${state.phase === 'aiming'}|${yolkTier(p)}|${canSuckYolk(p)}|${state.turn}|${p.coffee?.turn}|${p.coffee?.failChance}`,
    (state, { p }) => weaponsEl.replaceChildren(...p.loadout.map((_, tier) => weaponButton(state, p, tier))),
  );
}

/** Slot `tier`'s button. */
function weaponButton(state: GameState, p: Player, tier: number): HTMLButtonElement {
  const w = weaponForTier(p, tier);
  const left = p.ammo[tier] ?? 0;
  // Usable now (loadout.ts: rounds left; Yolk Sucker: health to even out; Diced Coffee: not had one this turn).
  const ok = canUseSlot(state, p, tier);
  const btn = el('button', 'weapon');
  btn.dataset.tier = String(tier);
  btn.classList.toggle('selected', tier === p.selectedTier);
  btn.setAttribute('aria-pressed', String(tier === p.selectedTier));
  const name = el('span', 'wname');
  btn.disabled = !ok || state.phase !== 'aiming';
  if (tier === yolkTier(p)) {
    // torikloud's spent Twins: Yolk Sucker, a bonus move as often as there's health to even out.
    btn.classList.add('yolk');
    btn.setAttribute('aria-label', `${YOLK_SUCKER.name}, bonus move${ok ? '' : ': health already even'}`);
    name.textContent = YOLK_SUCKER.name;
    name.classList.add('long');
    btn.append(name, el('span', 'pips bonus', ok ? 'bonus' : 'even'));
    return btn;
  }
  if (isCoffee(p, tier)) {
    // Diced Coffee: once a turn until it spills; the note says the odds (or why not).
    const risk = `${Math.round(coffeeFailChance(p, tier) * 100)}%`;
    const why = left <= 0 ? 'spilt' : ok ? `${risk} risk` : 'had one';
    btn.classList.add('coffee');
    btn.setAttribute('aria-label', `${w.name}, bonus move: ${left <= 0 ? 'spilt' : ok ? `${risk} chance of full cream` : 'one a turn'}`);
    name.textContent = w.shortName;
    name.classList.add('long');
    btn.append(name, el('span', 'pips bonus', why));
    return btn;
  }
  btn.setAttribute('aria-label', `${w.name}, ${left} left`);
  name.textContent = w.shortName;
  name.classList.toggle('long', w.shortName.length > 8);
  name.classList.toggle('longer', w.shortName.length > 11);
  btn.append(name, pips(left, AMMO_PER_TIER[tier] ?? left));
  return btn;
}

/** Rounds left as pips: ●●○ (on the weapon buttons and the steal roulette's cards). */
export function pips(left: number, max: number): HTMLElement {
  return el('span', 'pips', '●'.repeat(left) + '○'.repeat(Math.max(0, max - left)));
}

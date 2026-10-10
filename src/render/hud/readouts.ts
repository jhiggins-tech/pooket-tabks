/** The HUD's readouts: angle, power, fuel and the twin's aim switch. They move while you aim and drive, so they're just text and a width. */
import { getCharacter } from '../../characters/roster';
import { FUEL_PER_MATCH } from '../../game/constants';
import { aimedTank } from '../../game/game';
import type { GameState, Player } from '../../game/state';
import { byId, query } from '../../ui/dom';
import { keyed, type Part } from './part';

export function readouts(): Part {
  const angleEl = byId('angle');
  const powerEl = byId('power');
  const aimSwitch = byId('aim-switch');
  const fuelEl = byId('fuel-fill');
  const fuelLabel = query('.fuel small');
  const driveEl = query('.drive');
  // torikloud with a twin: the readouts are for whichever tank is being aimed, and the switch picks which
  // (the one ◀ ▶ drive, too: so it's there even with a weapon that doesn't aim).
  const twinSwitch = (state: GameState, p: Player, remote: boolean) => !!p.twin && state.phase === 'aiming' && !remote;
  return keyed(
    (state, { p, remote }) => {
      const aim = aimedTank(p);
      return `${aim.angle}|${aim.power}|${Math.round(p.fuel)}|${p.characterId}|${state.phase}|${twinSwitch(state, p, remote)}|${p.aimTwin}`;
    },
    (state, { p, remote }) => {
      const aim = aimedTank(p);
      angleEl.textContent = angleLabel(aim.angle);
      powerEl.textContent = `${aim.power}`;
      aimSwitch.hidden = !twinSwitch(state, p, remote);
      aimSwitch.textContent = p.aimTwin && p.twin ? '🎯 Twin' : '🎯 Main tank';
      aimSwitch.setAttribute('aria-pressed', String(p.aimTwin && !!p.twin));
      fuelEl.style.width = `${(p.fuel / FUEL_PER_MATCH) * 100}%`;
      fuelLabel.textContent = getCharacter(p.characterId).movement === 'hop' ? 'HOPS' : 'FUEL';
      const empty = p.fuel <= 0.5;
      driveEl.dataset.empty = String(empty);
      for (const b of driveEl.querySelectorAll('button')) b.disabled = state.phase !== 'aiming' || empty;
    },
  );
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

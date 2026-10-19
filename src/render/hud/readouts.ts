/** The HUD's readouts: angle, power, fuel and the twin's aim switch. They move while you aim and drive, so they're just text and a width. */
import { getCharacter } from '../../characters/roster';
import { FUEL_PER_MATCH } from '../../game/constants';
import { aimedTank, canDriveNow } from '../../game/game';
import type { GameState, Player } from '../../game/state';
import { byId, el, query } from '../../ui/dom';
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
      return `${aim.angle}|${aim.power}|${Math.round(p.fuel)}|${p.characterId}|${p.dieselCans}|${state.phase}|${twinSwitch(state, p, remote)}|${p.aimTwin}`;
    },
    (state, { p, remote }) => {
      const aim = aimedTank(p);
      angleEl.textContent = angleLabel(aim.angle);
      powerEl.textContent = `${aim.power}`;
      aimSwitch.hidden = !twinSwitch(state, p, remote);
      aimSwitch.textContent = p.aimTwin && p.twin ? '🎯 Twin' : '🎯 Main tank';
      aimSwitch.setAttribute('aria-pressed', String(p.aimTwin && !!p.twin));
      fuelEl.style.width = `${(p.fuel / FUEL_PER_MATCH) * 100}%`;
      fuelLabel.replaceChildren(...fuelName(p));
      const empty = p.fuel <= 0.5;
      driveEl.dataset.empty = String(empty);
      // (Driving's before firing, and while sneaking off under Sly.)
      for (const b of driveEl.querySelectorAll('button')) b.disabled = !canDriveNow(state) || empty;
    },
  );
}

/** The fuel gauge's label: HOPS for a frog; ShotDownBoyz's DIESEL, with a jerry can for each in reserve. */
function fuelName(p: Player): (string | Node)[] {
  if (getCharacter(p.characterId).movement === 'hop') return ['HOPS'];
  if (p.characterId !== 'shotdownboyz') return ['FUEL'];
  const cans = el('span', 'diesel-cans');
  cans.setAttribute('aria-label', `${p.dieselCans} jerry can${p.dieselCans === 1 ? '' : 's'} in reserve`);
  for (let i = 0; i < p.dieselCans; i++) cans.append(jerryCan());
  return ['DIESEL', cans];
}

/** A little red jerry can. */
function jerryCan(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 9 11');
  svg.setAttribute('aria-hidden', 'true');
  const body = document.createElementNS(ns, 'path');
  body.setAttribute('d', 'M1 3.5 3 1.5h5v9H1z');
  body.setAttribute('fill', '#dc2626');
  body.setAttribute('stroke', '#7f1d1d');
  body.setAttribute('stroke-width', '0.8');
  const cross = document.createElementNS(ns, 'path');
  cross.setAttribute('d', 'M2.6 4.5 6.6 9M6.6 4.5 2.6 9');
  cross.setAttribute('stroke', '#fca5a5');
  cross.setAttribute('stroke-width', '0.7');
  svg.append(body, cross);
  return svg;
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

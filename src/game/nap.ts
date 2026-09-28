import { AMMO_PER_TIER, getCharacter } from '../characters/roster';
import { getWeapon } from '../weapons/registry';
import type { WeaponDef } from '../weapons/types';
import { MAX_HP } from './constants';
import { sound, spawnFloater } from './fx';
import type { Stepper } from './mechanics';
import type { GameState, Nap, Player } from './state';
import { tankCentre } from './tanks';

/** larinovsky's Take a Nap: doze off (two cats curl up alongside, drawn in render/draw/nap.ts), then wake at full health with the other weapons restocked. */

/** Doze, with z's drifting up, then wake at full health and full ammo (except the nap). Returns true once awake. */
export function stepNap(state: GameState, n: Nap, dt: number): boolean {
  const p = state.players[n.playerId]!;
  const spec = getWeapon(n.weaponId).heal!;
  n.elapsed += dt;
  n.nextZ -= dt;
  if (n.nextZ <= 0 && n.elapsed < spec.napTime - 0.3) {
    const c = tankCentre(p);
    spawnFloater(state, c.x + 6, c.y - 4, n.elapsed < spec.napTime / 2 ? 'z' : 'Z', '#cfe3ff');
    n.nextZ = 0.45;
  }
  if (n.elapsed < spec.napTime) return false;
  sound(state, 'wake');
  if (p.alive && p.hp < MAX_HP) {
    const gained = MAX_HP - p.hp;
    p.hp = MAX_HP;
    const c = tankCentre(p);
    spawnFloater(state, c.x, c.y, `+${gained}`, '#7ee7a8');
  }
  if (p.alive && restock(p, n.weaponId)) {
    const c = tankCentre(p);
    spawnFloater(state, c.x, c.y - 14, 'Ammo restocked', '#ffe08a');
  }
  return true;
}

/** Every other weapon back to a full stock (a round stolen on top of that is kept). Returns true if anything changed. */
function restock(p: Player, napId: string): boolean {
  const loadout = getCharacter(p.characterId).loadout;
  let changed = false;
  loadout.forEach((id, tier) => {
    const full = AMMO_PER_TIER[tier] ?? 0;
    if (id === napId || (p.ammo[tier] ?? 0) >= full) return;
    p.ammo[tier] = full;
    changed = true;
  });
  return changed;
}

export function fireNap(state: GameState, p: Player, weapon: WeaponDef): void {
  state.naps.push({ playerId: p.id, weaponId: weapon.id, elapsed: 0, nextZ: 0 });
}

export const napStepper: Stepper = {
  step(state, dt) {
    state.naps = state.naps.filter((n) => !stepNap(state, n, dt));
  },
  busy: (state) => state.naps.length > 0,
};

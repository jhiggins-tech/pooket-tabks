import type { WeaponDef } from '../weapons/types';
import { TANK_BODY_HEIGHT } from './constants';
import { sound, spawnFloater } from './fx';
import type { GameState, Player, TankBody } from './state';

/**
 * Statuses: what a hit leaves behind, and how each runs its course. One place per status, for how it's
 * put on (`afflict`, from the weapon's effect flags, whatever kind of weapon it is), when it starts and
 * ends (`turnEnding`, `turnStarting`), and what it does (`offence` / `scaled`, `vulnerable`, `canMove`; a
 * burn's damage ticks in tanks.ts, as all damage does).
 *
 * | status | weapon flag | on | lasts |
 * |---|---|---|---|
 * | burn (Hyperfixate) | `dot` | the tank hit (main or twin) | `dot.turns` of its player's turns, damage as each comes up |
 * | cooked (the Rizzler) | `debuff` | the player | their next turn (everything they fire × `offenceMultiplier`) |
 * | tattoo (Tattoo Gun) | `tattoo` | the player | their next `tattoo.turns` turns (takes × `multiplier` damage) |
 * | pinned (Sew) | `pin` | the player | their next turn (no driving or hopping) |
 *
 * (Women in Scam is a bonus move's own business: scam.ts. Soak and toxin are damage on its way: tanks.ts.)
 * How they look is render/draw/tank.ts (on the tank) and render/hud.ts (badges by the name).
 */

/**
 * What a weapon's hit leaves on one of a player's tanks: its effect flags. `standing`: the tank is still
 * there as itself after the hit's damage (a burn needs something to burn); `shooterId` scales the burn.
 */
export function afflict(state: GameState, p: Player, tank: TankBody, weapon: WeaponDef, shooterId: number, standing: boolean): void {
  if (!p.alive) return;
  if (weapon.dot && standing) {
    // A fresh hit refreshes the burn rather than stacking it.
    tank.burn = { damagePerTurn: scaled(state, shooterId, weapon.dot.damagePerTurn), turnsLeft: weapon.dot.turns, colour: weapon.colour ?? BURN_COLOUR, by: shooterId, weaponId: weapon.id };
  }
  if (weapon.debuff) {
    p.cooked = { active: false, multiplier: weapon.debuff.offenceMultiplier };
    label(state, tank, 'COOKED', '#ff9f43');
    sound(state, 'cook');
  }
  if (weapon.tattoo) {
    if (!p.tattoo) {
      label(state, tank, 'TATTOOED', '#b8c4ff');
      sound(state, 'tattoo');
    }
    p.tattoo = { multiplier: weapon.tattoo.multiplier, turnsLeft: weapon.tattoo.turns };
  }
  if (weapon.pin) {
    p.pinned = { active: false };
    label(state, tank, 'PINNED', weapon.colour ?? '#f472b6');
    sound(state, 'pin');
  }
}

/** The colour of a burn from a weapon with none of its own. */
export const BURN_COLOUR = '#ff3df2';

function label(state: GameState, at: { x: number; y: number }, text: string, colour: string): void {
  spawnFloater(state, at.x, at.y - TANK_BODY_HEIGHT - 10, text, colour);
}

/** `ending`'s turn is over: the statuses that lasted for it go, and a tattoo has a turn fewer to run. */
export function turnEnding(ending: Player): void {
  if (ending.cooked?.active) ending.cooked = null;
  if (ending.pinned?.active) ending.pinned = null;
  if (ending.tattoo && --ending.tattoo.turnsLeft <= 0) ending.tattoo = null;
}

/** `up`'s turn starts: a pending cook or pin takes hold for it. (Their burns ticked as it came up.) */
export function turnStarting(up: Player): void {
  if (up.cooked) up.cooked.active = true;
  if (up.pinned) up.pinned.active = true;
}

/** Damage multiplier for everything a player fires: halved (etc.) while they're cooked. */
export function offence(state: GameState, playerId: number): number {
  const c = state.players[playerId]?.cooked;
  return c?.active ? c.multiplier : 1;
}

/** Tattooed tanks take extra damage from everything. */
export function vulnerable(p: Player, amount: number): number {
  return p.tattoo ? Math.round(amount * p.tattoo.multiplier) : amount;
}

/** Pinned players can't drive or hop this turn. */
export function canMove(p: Player): boolean {
  return !p.pinned?.active;
}

/** Scale an amount by the shooter's offence and round it (a real amount never rounds down to 0). */
export function scaled(state: GameState, shooterId: number, amount: number): number {
  if (Math.round(amount) <= 0) return 0;
  return Math.max(1, Math.round(amount * offence(state, shooterId)));
}

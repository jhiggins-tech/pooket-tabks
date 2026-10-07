import { kindOf, weaponOf } from '../weapons/registry';
import { settleTurn } from './bodies';
import { sound, spawnFloater } from './fx';
import { newJet } from './jetpack';
import { canUseSlot, reselect, weaponForTier } from './loadout';
import type { CoffeeSpin, GameState, Player } from './state';
import { tankCentre } from './tanks';

/**
 * garyoldmancorp's Diced Coffee: a bonus move (a win doesn't use the turn: aim and fire as usual after it).
 * A spinner with a full cream slice (the chance it fails: `failChance`, plus `failStep` after every win)
 * and a lactose free one spins to a stop, decided up front from the seeded RNG.
 *
 * - **Lactose free**: the tank drinks it, and when this turn ends the player goes again (the next enemy
 *   turn is skipped: game.ts `endTurn`, by `Player.extraTurn`). The next spin is riskier.
 * - **Full cream**: a little ten-2 straight up (the weapon's own `jetpack`, harmless mud), then the turn
 *   is over (no shot this turn), and its round is gone for the match (greyed out).
 *
 * Once a turn (`Player.coffee.turn`), as many turns as it keeps winning. It's no shot: with only Diced
 * Coffee left a player has nothing to fire, so game.ts `hasAmmo` leaves it out (its kind's `keepsInPlay`) and they
 * sit out like anyone empty.
 */

/** How long the spinner spins before it stops (s). */
export const COFFEE_SPIN = 2.6;
/** How long a win's drink lasts after the spinner stops (s). */
export const COFFEE_SIP = 1.7;
/** How long a spill's result shows at least (the little jetpack usually takes longer). */
const COFFEE_SPILL = 1.2;
/** Whole turns of the wheel before it settles on the result. */
const COFFEE_TURNS = 4;
/** The spill's launch: straight up, at this power (× the jetpack's thrust). */
const SPILL_POWER = 100;

/** The chance `p`'s next Diced Coffee (from `tier`) fails. */
export function coffeeFailChance(p: Player, tier: number): number {
  const w = weaponOf(p.loadout[tier]!, 'coffee');
  return p.coffee?.failChance ?? w.coffee.failChance;
}

/** Whether tier `tier` is a Diced Coffee. */
export function isCoffee(p: Player, tier: number): boolean {
  const id = p.loadout[tier];
  return id !== undefined && kindOf(weaponForTier(p, tier)) === 'coffee';
}

/** Whether `p` can drink a Diced Coffee from `tier` now: it isn't spilt, and they haven't had one this turn (loadout.ts). */
export function canDrinkCoffee(state: GameState, p: Player, tier: number): boolean {
  return isCoffee(p, tier) && canUseSlot(state, p, tier);
}

/** Spin the wheel (FIRE on Diced Coffee). */
export function startCoffee(state: GameState, p: Player, tier: number): boolean {
  if (!canDrinkCoffee(state, p, tier)) return false;
  const w = weaponOf(p.loadout[tier]!, 'coffee');
  const failChance = coffeeFailChance(p, tier);
  const fail = state.rng() < failChance;
  // Somewhere well inside the slice it lands on (not on the line: no arguing with the wheel).
  const within = 0.15 + 0.7 * state.rng();
  const stop = fail ? failChance * within : failChance + (1 - failChance) * within;
  p.coffee = { failChance, turn: state.turn };
  state.coffee = { playerId: p.id, tier, weaponId: w.id, failChance, fail, stop, t: 0, landed: false };
  state.phase = 'coffee';
  sound(state, 'fire', w.id);
  return true;
}

/** How far round the wheel has turned (in turns; the pointer reads `spun % 1`): fast, easing to a stop. */
export function coffeeSpun(c: CoffeeSpin): number {
  const x = Math.min(1, c.t / COFFEE_SPIN);
  return (COFFEE_TURNS + c.stop) * (1 - (1 - x) ** 3);
}

/** Spin on; once the wheel stops, the drink or the spill. (The spill's jetpack is stepped with the other steppers.) */
export function stepCoffee(state: GameState, dt: number): void {
  const c = state.coffee;
  if (!c) return;
  const slices = (spun: number) => Math.floor(spun * 12);
  const before = slices(coffeeSpun(c));
  c.t += dt;
  if (!c.landed && slices(coffeeSpun(c)) !== before) sound(state, 'tick');
  if (c.landed || c.t < COFFEE_SPIN) return;
  c.landed = true;
  const p = state.players[c.playerId]!;
  const w = weaponOf(c.weaponId, 'coffee');
  const at = tankCentre(p);
  if (c.fail) {
    p.ammo[c.tier] = 0;
    spawnFloater(state, at.x, at.y - 18, 'FULL CREAM 🥛', '#fff4dc');
    sound(state, 'spill');
    state.jets.push(newJet(p.id, c.weaponId, Math.PI / 2, { angle: 90, power: SPILL_POWER }));
  } else {
    p.extraTurn = true;
    p.coffee = { failChance: Math.min(1, c.failChance + w.coffee.failStep), turn: state.turn };
    spawnFloater(state, at.x, at.y - 18, 'LACTOSE FREE ☕ GO AGAIN', '#b8f5c8');
    sound(state, 'slurp');
  }
}

/** Whether the coffee has played out (the spill's jetpack aside: the caller waits for the steppers). */
export function coffeeDone(state: GameState): boolean {
  const c = state.coffee;
  return !c || (c.landed && c.t >= COFFEE_SPIN + (c.fail ? COFFEE_SPILL : COFFEE_SIP));
}

/**
 * After a win, back to the turn: aiming, with a shot selected. A spill ends the turn (the penalty), and so
 * does having no shot left to fire (Diced Coffee alone; a win still skips the next enemy turn).
 */
export function finishCoffee(state: GameState): void {
  const c = state.coffee;
  state.coffee = null;
  const p = c ? state.players[c.playerId] : undefined;
  // With the coffee (or an empty tier) selected, select the lowest tier with a round that isn't coffee.
  const shot = p ? reselect(p, { inPlay: true }) : false;
  if (c && !c.fail && shot) {
    state.phase = 'aiming';
    return;
  }
  settleTurn(state);
}

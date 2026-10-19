import { kindRow } from '../weapons/kinds';
import { getWeapon, kindOf } from '../weapons/registry';
import type { WeaponDef } from '../weapons/types';
import { currentPlayer } from './bodies';
import type { GameState, Player } from './state';

/**
 * A player's weapons and rounds: which weapon is in a tier, what each slot is and whether it can be used
 * now (the one place for those rules: selectTier, fire and hasAmmo in game.ts, the HUD's buttons and FIRE),
 * and keeping a loaded tier selected.
 */

export function weaponForTier(p: Player, tier: number): WeaponDef {
  return getWeapon(p.loadout[tier]!);
}

/**
 * What a slot holds: a weapon, by what firing it does to the turn (weapons/kinds.ts: `shot`, `free` for
 * Steal, `bonus` for a bonus move), or `yolk`: torikloud's spent Twins while the twin stands, which is
 * Yolk Sucker (a bonus move with no rounds: copies.ts). Null: there's no such slot.
 */
export type SlotKind = 'shot' | 'free' | 'bonus' | 'yolk';

export function slotAt(p: Player, tier: number): SlotKind | null {
  if (tier >= 0 && tier === yolkTier(p)) return 'yolk';
  const id = p.loadout[tier];
  return id === undefined ? null : kindRow(kindOf(getWeapon(id))).turn;
}

/** The slot that's Yolk Sucker for `p` (a spent Twins, while the twin stands), or -1. */
export function yolkTier(p: Player): number {
  if (!p.twin || !p.alive) return -1;
  return p.loadout.findIndex((id, tier) => kindOf(getWeapon(id)) === 'twin' && (p.ammo[tier] ?? 0) <= 0);
}

/** Whether Yolk Sucker would change anything: the twins' health is more than one apart. */
export function canSuckYolk(p: Player): boolean {
  return yolkTier(p) >= 0 && Math.abs(p.hp - p.twin!.hp) > 1;
}

/**
 * Whether `p` can use slot `tier` now (select it, and fire it on their turn): Yolk Sucker while there's
 * health to even out; anything else while it has a round, and a once-a-turn bonus move (Diced Coffee) only
 * if it hasn't had one this turn (`Player.coffee.turn`, `Player.diggerTurn` or `Player.pokemon.turn`).
 */
export function canUseSlot(state: GameState, p: Player, tier: number): boolean {
  if (slotAt(p, tier) === 'yolk') return canSuckYolk(p);
  if ((p.ammo[tier] ?? 0) <= 0) return false;
  const id = p.loadout[tier];
  if (id === undefined) return true;
  const row = kindRow(kindOf(getWeapon(id)));
  if (row.turn !== 'bonus' || row.per !== 'turn') return true;
  const kind = kindOf(getWeapon(id));
  if (kind === 'digger') return p.diggerTurn !== state.turn;
  if (kind === 'pokemon') return p.pokemon?.turn !== state.turn;
  return p.coffee?.turn !== state.turn;
}

/**
 * Whether the current player can fire now: whenever this is false, game.ts `fire` refuses. Their turn to
 * aim, not in the middle of a hop or a flight, and the selected slot usable (canUseSlot). (Even then Steal can come to
 * nothing, with no enemy rounds to take: it says so, and the turn carries on.)
 */
export function canFire(state: GameState): boolean {
  // Band Aid is fired when the drumming's over (game/drums.ts).
  if (state.phase === 'drumming') return !!state.drums?.done;
  // Sly is fired when time's up, or sooner with FIRE (game/sly.ts): not mid-hop or mid-flight.
  if (state.phase === 'sneaking') return !currentPlayer(state).hop && !currentPlayer(state).flight;
  // 007 is fired once the question's answered (or time's up: game/bond.ts).
  if (state.phase === 'quizzing') return !!state.quiz?.done;
  // Who's That Pokémon? likewise (game/pokemon.ts); once fired, the answer's showing.
  if (state.phase === 'guessing') return !!state.guess?.done && state.guess.outro === null;
  if (state.phase !== 'aiming') return false;
  const p = currentPlayer(state);
  return !p.hop && !p.flight && canUseSlot(state, p, p.selectedTier);
}

/**
 * Whether slot `tier` has a round that keeps `p` taking turns: any round but Diced Coffee's (KINDS
 * `keepsInPlay`: it's no shot). Steal and Women in Scam count. A player with none sits out (game.ts `hasAmmo`).
 */
export function roundKeepsInPlay(p: Player, tier: number): boolean {
  if ((p.ammo[tier] ?? 0) <= 0) return false;
  const id = p.loadout[tier];
  return id === undefined || kindRow(kindOf(getWeapon(id))).keepsInPlay !== false;
}

/**
 * The selected tier has run out: select the lowest tier that still has rounds. Returns whether any tier
 * does (a player with none sits out, game.ts). With `inPlay`, only rounds that keep a player in play
 * count (roundKeepsInPlay): after a Diced Coffee, a selected coffee gives way to the lowest such tier.
 */
export function reselect(p: Player, opts: { inPlay?: boolean } = {}): boolean {
  const ok = (tier: number) => (opts.inPlay ? roundKeepsInPlay(p, tier) : (p.ammo[tier] ?? 0) > 0);
  if (ok(p.selectedTier)) return true;
  const next = p.ammo.findIndex((_, tier) => ok(tier));
  if (next < 0) return false;
  p.selectedTier = next;
  return true;
}

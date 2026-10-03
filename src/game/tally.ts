import { kindOf } from '../weapons/registry';
import type { WeaponDef } from '../weapons/types';
import type { GameState, Player, PlayerTally } from './state';

/**
 * Each player's numbers for the stats viewer (net/results.ts writes them out when a match ends): shots,
 * hits, damage done and taken, kills. Kept in the match state (so both phones agree and snapshots carry
 * them) but never read by the simulation.
 *
 * - A shot counts (`shots`, and `hits` if it touched an enemy tank or decoy) when its weapon can do damage:
 *   not Twins, Trollogram or Take a Nap, nor bonus moves and free actions (they aren't shots).
 * - Damage is credited in `hurt` (every hit on a tank goes through it), capped at the health that was
 *   there: to whoever caused it, with which weapon. A burn remembers who lit it (it ticks on the victim's
 *   turn); anything else during a shot is the shooter's (soak and toxin included).
 * - A kill: the hit that put a player out.
 */

/** Kinds of shot that never do damage themselves (so they're left out of shots and accuracy). */
const HARMLESS = new Set(['twin', 'decoy', 'heal']);

export function newTally(): PlayerTally {
  return { shots: {}, hits: {}, dealt: {}, taken: 0, self: 0, kills: 0 };
}

/** Who caused some damage, and with what ('' when it can't be told). */
export interface DamageSource {
  by: number;
  weaponId: string;
}

/** A shot has been fired: count it, if it's the kind that can hurt. */
export function tallyShot(state: GameState, p: Player, weapon: WeaponDef): void {
  state.tallyShot = null;
  if (HARMLESS.has(kindOf(weapon))) return;
  const t = tallyOf(state, p.id);
  t.shots[weapon.id] = (t.shots[weapon.id] ?? 0) + 1;
  state.tallyShot = { playerId: p.id, weaponId: weapon.id, hit: false };
}

/** The shot in play touched `t` (a tank or a decoy): a hit, if it's an enemy's (once per shot). */
export function tallyHit(state: GameState, ownerOfTarget: number, shooterId: number): void {
  const s = state.tallyShot;
  if (!s || s.hit || s.playerId !== shooterId || ownerOfTarget === shooterId) return;
  s.hit = true;
  const t = tallyOf(state, shooterId);
  t.hits[s.weaponId] = (t.hits[s.weaponId] ?? 0) + 1;
}

/** Whoever's to blame for damage with no source of its own: the shooter of the shot in play. */
export function defaultSource(state: GameState): DamageSource {
  const shot = state.lastShot;
  return shot ? { by: shot.playerId, weaponId: shot.weaponId } : { by: state.current, weaponId: '' };
}

/** `victim` lost `lost` health (already capped at what they had) to `source`; `out`: that put them out. */
export function tallyDamage(state: GameState, victim: Player, lost: number, source: DamageSource, out: boolean): void {
  if (lost <= 0) return;
  const v = tallyOf(state, victim.id);
  if (source.by === victim.id) {
    v.self += lost;
    return;
  }
  v.taken += lost;
  const a = state.tally[source.by];
  if (!a) return;
  const key = source.weaponId || 'other';
  a.dealt[key] = (a.dealt[key] ?? 0) + lost;
  if (out) a.kills++;
}

function tallyOf(state: GameState, id: number): PlayerTally {
  return (state.tally[id] ??= newTally());
}

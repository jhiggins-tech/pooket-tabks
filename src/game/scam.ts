import { getWeapon } from '../weapons/registry';
import { SETTLE_TIME } from './constants';
import { sound, spawnFloater } from './fx';
import type { GameState, Player } from './state';
import { reselect } from './loadout';
import { tankCentre } from './bodies';

/**
 * larinovsky's Women in Scam: a bonus move (it doesn't use the turn: aim and fire as usual after it).
 * Until the end of the next enemy turn, an enemy attack that hits larinovsky's own tank (not anything
 * else) earns them a round of the weapon that enemy fired that turn, to keep: one round per enemy turn,
 * however many times it hits. The hit is noted in `damagePlayer`; the round is paid out in `endTurn`.
 */

/** Use the bonus move: spend its round and carry on aiming (or, with nothing left to fire, end the turn). */
export function armScam(state: GameState, p: Player, tier: number): boolean {
  p.ammo[tier]!--;
  p.scam = { loot: null };
  const c = tankCentre(p);
  spawnFloater(state, c.x, c.y - 18, 'SCAM ON 💅', '#ff9ad5');
  sound(state, 'fire', p.loadout[tier]);
  if (!reselect(p)) {
    // Nothing left to fire: the scam still stands for the next enemy turn.
    state.phase = 'settling';
    state.settleTimer = SETTLE_TIME;
  }
  return true;
}

/** Called when `p`'s own tank takes damage. */
export function noteScamHit(state: GameState, p: Player): void {
  const shot = state.lastShot;
  if (!p.scam || p.scam.loot || !shot || shot.playerId !== state.current || shot.playerId === p.id) return;
  p.scam.loot = shot.weaponId;
}

/** At the end of each turn: an enemy turn has come and gone for everyone scamming, so pay out and stand down. */
export function endScams(state: GameState): void {
  for (const p of state.players) {
    if (!p.scam || p.id === state.current) continue; // their own turn ending: the enemy's is still to come
    const loot = p.scam.loot;
    p.scam = null;
    if (!loot || !p.alive) continue;
    let tier = p.loadout.indexOf(loot);
    if (tier < 0) {
      tier = p.loadout.length;
      p.loadout.push(loot);
      p.ammo.push(0);
    }
    p.ammo[tier]!++;
    const c = tankCentre(p);
    spawnFloater(state, c.x, c.y - 18, `SCAMMED +1 ${getWeapon(loot).shortName}`, '#ff9ad5');
    sound(state, 'scammed');
  }
}


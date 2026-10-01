import { ring, sound, spawnFloater } from './fx';
import { reselect, weaponForTier } from './loadout';
import type { GameState, Heist, Player } from './state';
import { tankCentre } from './tanks';

/** kie's Steal: the roulette over an enemy's rounds. */

/** How long the Steal roulette spins before it lands, and how long the result shows. */
export const STEAL_SPIN = 3.4;

export const STEAL_HOLD = 1.3;

const STEAL_TICKS = 19;

/** Enemy rounds that can be stolen: any tier with ammo left, except another Steal. */
function stealable(state: GameState, thief: Player): { victim: Player; tier: number }[] {
  return state.players
    .filter((q) => q !== thief && q.alive)
    .flatMap((victim) => victim.ammo.map((n, tier) => ({ victim, tier, n })))
    .filter(({ victim, tier, n }) => n > 0 && weaponForTier(victim, tier).kind !== 'steal')
    .map(({ victim, tier }) => ({ victim, tier }));
}

/** Pick a random enemy weapon to steal from and start the roulette. False if there's nothing to take. */
export function startHeist(state: GameState, p: Player, tier: number): boolean {
  const loot = stealable(state, p);
  if (loot.length === 0) {
    const c = tankCentre(p);
    spawnFloater(state, c.x, c.y - 18, 'NOTHING TO STEAL', '#cfd6ff');
    sound(state, 'nothing');
    return false;
  }
  const { victim, tier: victimTier } = loot[Math.min(loot.length - 1, Math.floor(state.rng() * loot.length))]!;
  const options = [...victim.loadout];
  // Round and round the victim's weapons (empty ones too, for the near misses), landing on the pick.
  const sequence = Array.from({ length: STEAL_TICKS }, (_, i) => {
    const n = options.length;
    return (((victimTier - (STEAL_TICKS - 1 - i)) % n) + n) % n;
  });
  // Quick ticks to start with, slowing right down at the end.
  const times = sequence.map((_, i) => {
    const x = i / (STEAL_TICKS - 1);
    return STEAL_SPIN * (0.35 * x + 0.65 * x ** 3);
  });
  p.ammo[tier] = 0; // the Steal is spent; the stolen round takes its slot when it lands
  state.heist = { thiefId: p.id, thiefTier: tier, victimId: victim.id, victimTier, options, sequence, times, t: 0, locked: false };
  state.phase = 'stealing';
  sound(state, 'fire', 'steal');
  return true;
}

/** The victim tier the roulette is lit on right now. */
export function heistIndex(h: Heist): number {
  let i = 0;
  while (i + 1 < h.times.length && h.times[i + 1]! <= h.t) i++;
  return h.sequence[i]!;
}

export function stepHeist(state: GameState, dt: number): void {
  const h = state.heist;
  if (!h) {
    state.phase = 'aiming';
    return;
  }
  const before = heistIndex(h);
  h.t += dt;
  if (!h.locked && heistIndex(h) !== before) sound(state, 'tick');
  if (!h.locked && h.t >= STEAL_SPIN) {
    sound(state, 'stolen');
    h.locked = true;
    const thief = state.players[h.thiefId]!;
    const victim = state.players[h.victimId]!;
    const weapon = weaponForTier(victim, h.victimTier);
    victim.ammo[h.victimTier]!--;
    reselect(victim);
    thief.loadout[h.thiefTier] = weapon.id;
    thief.ammo[h.thiefTier] = 1;
    thief.selectedTier = h.thiefTier;
    const v = tankCentre(victim);
    const t = tankCentre(thief);
    ring(state, v.x, v.y, thief.colour);
    ring(state, t.x, t.y, thief.colour);
    spawnFloater(state, v.x, v.y - 18, `−1 ${weapon.shortName}`, victim.colour);
    spawnFloater(state, t.x, t.y - 18, `+ ${weapon.shortName}`, thief.colour);
  }
  if (h.t >= STEAL_SPIN + STEAL_HOLD) {
    state.heist = null;
    state.phase = 'aiming';
  }
}

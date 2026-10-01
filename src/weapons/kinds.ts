/**
 * Kinds of weapon: how each is delivered, and what the rest of the game needs to know about it. How each
 * one actually goes off is `FIRE` (shots) and `FREE_ACTIONS` in game/mechanics.ts, and its numbers are
 * its spec on the weapon (types.ts). A new kind is a row here, an entry there, and its spec type.
 *
 * - `aims`: uses the aim (angle and power); otherwise just press FIRE.
 * - `turn`: what firing it does to the turn. `shot`: spends it (the shot plays out, then the next player);
 *   `free`: the turn carries on (Steal); `bonus`: the turn carries on, and it's a once-a-match move.
 */
export const KINDS = {
  /** Projectiles launched from the barrel, pulled by gravity (bursts, volleys, bouncers, walkers, homers, words). */
  ballistic: { aims: true, turn: 'shot' },
  /** An instant straight line from the barrel, no gravity (power doesn't matter). */
  beam: { aims: true, turn: 'shot' },
  /** Projectiles fall across the whole stage. */
  rain: { aims: false, turn: 'shot' },
  /** A jet of liquid whose pressure ramps up, holds, then eases off. */
  stream: { aims: true, turn: 'shot' },
  /** Hologram copies of the firer's tank appear (decoys to swap into); a hit one blows up. */
  decoy: { aims: false, turn: 'shot' },
  /** The firer's own tank charges up, then launches along the aim, spraying propellant. */
  jetpack: { aims: true, turn: 'shot' },
  /** A short-range gush of chunky gunk from the barrel. */
  spew: { aims: true, turn: 'shot' },
  /** Expanding arcs of sound along the aim, through terrain. */
  sonic: { aims: true, turn: 'shot' },
  /** The firer naps and wakes at full health. */
  heal: { aims: false, turn: 'shot' },
  /** A second tank appears and the firer's health is split between the two; it copies their shots. */
  twin: { aims: false, turn: 'shot' },
  /** A needle and thread stitching along the aim through terrain. */
  sew: { aims: true, turn: 'shot' },
  /** A marathon runner jogs towards the nearest enemy a leg at a time, turn after turn. */
  runner: { aims: false, turn: 'shot' },
  /** Takes one round of a random enemy weapon, which replaces it in the slot. */
  steal: { aims: false, turn: 'free' },
  /** Women in Scam: an enemy hit on the firer next turn earns them a round of the weapon that did it. */
  scam: { aims: false, turn: 'bonus' },
} as const satisfies Record<string, { aims: boolean; turn: 'shot' | 'free' | 'bonus' }>;

export type WeaponKind = keyof typeof KINDS;

/** Kinds whose firing spends the turn (the rest are free actions or bonus moves). */
export type ShotKind = { [K in WeaponKind]: (typeof KINDS)[K]['turn'] extends 'shot' ? K : never }[WeaponKind];

export function isShotKind(kind: WeaponKind): kind is ShotKind {
  return KINDS[kind].turn === 'shot';
}

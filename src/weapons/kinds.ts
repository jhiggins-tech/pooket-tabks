/**
 * Kinds of weapon: how each is delivered, and what the rest of the game needs to know about it. How each
 * one actually goes off is `FIRE` (shots) and `FREE_ACTIONS` in game/mechanics.ts, and its numbers are
 * its spec on the weapon (types.ts). A new kind is a row here, an entry there, and its spec type.
 *
 * - `aims`: uses the aim (angle and power); otherwise just press FIRE.
 * - `turn`: what firing it does to the turn. `shot`: spends it (the shot plays out, then the next player);
 *   `free`: the turn carries on (Steal); `bonus`: the turn carries on, and it's a bonus move.
 * - `per` (bonus moves): how often it can be used. `match`: once for each round it has (one, so once a
 *   match); `turn`: once a turn while it has its round (Diced Coffee, until it fails: game/loadout.ts).
 * - `keepsInPlay` (default true): whether a round of it keeps its player taking turns (game.ts `hasAmmo`).
 *   Diced Coffee's doesn't: with only that left there's nothing to fire, and they sit out.
 * - `harmless`: it never does damage itself, so the stats leave it out of shots and accuracy (game/tally.ts).
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
  decoy: { aims: false, turn: 'shot', harmless: true },
  /** The firer's own tank charges up, then launches along the aim, spraying propellant. */
  jetpack: { aims: true, turn: 'shot' },
  /** A short-range gush of chunky gunk from the barrel. */
  spew: { aims: true, turn: 'shot' },
  /** Expanding arcs of sound along the aim, through terrain. */
  sonic: { aims: true, turn: 'shot' },
  /** The firer naps and wakes at full health. */
  heal: { aims: false, turn: 'shot', harmless: true },
  /** A second tank appears and the firer's health is split between the two; it copies their shots. */
  twin: { aims: false, turn: 'shot', harmless: true },
  /** A needle and thread stitching along the aim through terrain. */
  sew: { aims: true, turn: 'shot' },
  /** Thrown out along the aim, curling round and back to the thrower, through terrain (kiwicore's flat cap). */
  boomerang: { aims: true, turn: 'shot' },
  /** A marathon runner jogs towards the nearest enemy a leg at a time, turn after turn. */
  runner: { aims: false, turn: 'shot' },
  /** Takes one round of a random enemy weapon, which replaces it in the slot. */
  steal: { aims: false, turn: 'free' },
  /** Women in Scam: an enemy hit on the firer next turn earns them a round of the weapon that did it. */
  scam: { aims: false, turn: 'bonus', per: 'match' },
  /** Diced Coffee: a spinner; a win skips the next enemy turn (go again), a loss spills it for good. */
  coffee: { aims: false, turn: 'bonus', per: 'turn', keepsInPlay: false },
} as const satisfies Record<string, KindRow>;

/** A row of KINDS (see the list above): a bonus move must say how often it can be used. */
export type KindRow = { aims: boolean; keepsInPlay?: boolean; harmless?: boolean } & ({ turn: 'shot' | 'free' } | { turn: 'bonus'; per: 'match' | 'turn' });

export type WeaponKind = keyof typeof KINDS;

/** A kind's row, with every column (the optional ones may be missing). */
export function kindRow(kind: WeaponKind): KindRow {
  return KINDS[kind];
}

/** Kinds whose firing spends the turn (the rest are free actions or bonus moves). */
export type ShotKind = { [K in WeaponKind]: (typeof KINDS)[K]['turn'] extends 'shot' ? K : never }[WeaponKind];

export function isShotKind(kind: WeaponKind): kind is ShotKind {
  return KINDS[kind].turn === 'shot';
}

/** Sprites a projectile can be drawn with (see src/render/sprites.ts). */
export type SpriteId = 'ice-cream-cone' | 'pill';

/**
 * How a weapon is delivered:
 * - `ballistic` (default): projectiles launched from the barrel, pulled by gravity.
 * - `beam`: instant straight line from the barrel, no gravity (ignores power).
 * - `rain`: projectiles fall across the whole stage; aiming is ignored.
 */
export type WeaponKind = 'ballistic' | 'beam' | 'rain';

export interface WeaponDef {
  id: string;
  name: string;
  /** Short label for thumb-sized buttons. */
  shortName: string;
  kind?: WeaponKind;
  /** Crater radius in world pixels (for a beam: the hole it burns where it hits ground). */
  blastRadius: number;
  /** Damage at the centre of each blast, falling off linearly to the edge (for a beam: direct-hit damage). */
  damage: number;
  /**
   * Fire several projectiles per round, fanned evenly across ±spreadDeg of the aim
   * (e.g. count 2, spread 2 → aim −2° and aim +2°). Defaults to a single shot.
   */
  volley?: { count: number; spreadDeg: number };
  /** Rain weapons: how many projectiles fall. */
  rainCount?: number;
  /** Bounce off the ground this many times, detonating on the next contact. Default 0. */
  bounces?: number;
  /** Fraction of speed kept (along the surface normal) on each bounce. */
  restitution?: number;
  /** Direct hit applies a burn that deals damage at the start of each of the victim's next turns. */
  dot?: { damagePerTurn: number; turns: number };
  /** Whether blasts hurt the player who fired them. Default true. */
  friendlyFire?: boolean;
  /** Draw the projectile as a sprite pointing along its flight path; default is a plain shell. */
  sprite?: SpriteId;
  /** Draw a dotted trail behind projectiles. Default true. */
  trail?: boolean;
  /** Beam colour. */
  colour?: string;
}

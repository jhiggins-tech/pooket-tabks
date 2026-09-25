/** Sprites a projectile can be drawn with (see src/render/sprites.ts). */
export type SpriteId = 'ice-cream-cone';

export interface WeaponDef {
  id: string;
  name: string;
  /** Short label for thumb-sized buttons. */
  shortName: string;
  /** Crater radius in world pixels. */
  blastRadius: number;
  /** Damage dealt at the centre of each blast, falling off linearly to the edge. */
  damage: number;
  /**
   * Fire several projectiles per round, fanned evenly across ±spreadDeg of the aim
   * (e.g. count 2, spread 2 → aim −2° and aim +2°). Defaults to a single shot.
   */
  volley?: { count: number; spreadDeg: number };
  /** Draw the projectile as a sprite pointing along its flight path; default is a plain shell. */
  sprite?: SpriteId;
}

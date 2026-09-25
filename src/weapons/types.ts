export interface WeaponDef {
  id: string;
  name: string;
  /** Short label for thumb-sized buttons. */
  shortName: string;
  /** Crater radius in world pixels. */
  blastRadius: number;
  /** Damage dealt at the centre of the blast, falling off linearly to the edge. */
  damage: number;
}

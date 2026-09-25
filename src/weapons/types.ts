export interface WeaponDef {
  id: string;
  name: string;
  /** Crater radius in world pixels. */
  blastRadius: number;
  /** Damage dealt at the centre of the blast, falling off linearly to the edge. */
  damage: number;
}

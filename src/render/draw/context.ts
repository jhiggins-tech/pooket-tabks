import type { Hoop } from '../../game/state';
import type { SpriteId } from '../../weapons/types';
import type { LoadedSprite } from '../sprites';

/** What the draw functions draw with: the canvas (in world coordinates), the animation clock, the sprites, and what they keep between frames (cosmetic, the renderer's own). */
export interface Draw {
  ctx: CanvasRenderingContext2D;
  /** Seconds since the renderer started (for wobbles, flickers and cycles). */
  time: number;
  sprites: Record<SpriteId, LoadedSprite>;
  /** Scooter riders, by player id: where each was last drawn, and until when (`time`) they count as riding, which way (draw/tank.ts). */
  rides: Map<number, ScooterRide>;
  /** Hoop Dreamz's hoop as last drawn: where, since when (`time`) it's been showing, and when it was last there (draw/hoop.ts). */
  hoop: { h: Hoop; since: number; last: number } | null;
  /** Who's looking, for what's hidden from whom (Sly: draw/sly.ts): a player id (online, this phone's seat), -1 nobody's (a spectator), null everyone's (a shared phone). */
  viewer: number | null;
}

/** A scooter rider as last drawn: where, until when they count as riding, and which way (±1). */
export interface ScooterRide {
  x: number;
  until: number;
  dir: number;
}

import type { SpriteId } from '../../weapons/types';
import type { LoadedSprite } from '../sprites';

/** What the draw functions draw with: the canvas (in world coordinates), the animation clock and the sprites. */
export interface Draw {
  ctx: CanvasRenderingContext2D;
  /** Seconds since the renderer started (for wobbles, flickers and cycles). */
  time: number;
  sprites: Record<SpriteId, LoadedSprite>;
}

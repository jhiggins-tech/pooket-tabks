import iceCreamConeUrl from '../assets/sprites/ice-cream-cone.svg';
import pillUrl from '../assets/sprites/pill.svg';
import weaselUrl from '../assets/sprites/weasel.svg';
import kookaburraUrl from '../assets/sprites/kookaburra.svg';
import type { SpriteId } from '../weapons/types';

interface SpriteDef {
  url: string;
  /** Drawn size in world pixels, before rotation (sprites point along +x). */
  width: number;
  height: number;
}

const SPRITES: Record<SpriteId, SpriteDef> = {
  'ice-cream-cone': { url: iceCreamConeUrl, width: 30, height: 15 },
  pill: { url: pillUrl, width: 14, height: 7 },
  weasel: { url: weaselUrl, width: 32, height: 16 },
  kookaburra: { url: kookaburraUrl, width: 46, height: 40 },
};

export interface LoadedSprite extends SpriteDef {
  image: HTMLImageElement;
}

/** Start loading every sprite up front; draw code falls back to a plain shell until ready. */
export function loadSprites(): Record<SpriteId, LoadedSprite> {
  const out = {} as Record<SpriteId, LoadedSprite>;
  for (const [id, def] of Object.entries(SPRITES) as [SpriteId, SpriteDef][]) {
    const image = new Image();
    image.decoding = 'async';
    image.src = def.url;
    out[id] = { ...def, image };
  }
  return out;
}

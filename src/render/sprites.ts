import icedCoffeeUrl from '../assets/sprites/iced-coffee.svg';
import iceCreamConeUrl from '../assets/sprites/ice-cream-cone.svg';
import pillUrl from '../assets/sprites/pill.svg';
import pillBlueUrl from '../assets/sprites/pill-blue.svg';
import pillRoundUrl from '../assets/sprites/pill-round.svg';
import pillOvalUrl from '../assets/sprites/pill-oval.svg';
import weaselUrl from '../assets/sprites/weasel.svg';
import kookaburraUrl from '../assets/sprites/kookaburra.svg';
import rizzUrl from '../assets/sprites/rizz.svg';
import inkNeedleUrl from '../assets/sprites/ink-needle.svg';
import catGingerUrl from '../assets/sprites/cat-ginger.svg';
import catGreyUrl from '../assets/sprites/cat-grey.svg';
import type { SpriteId } from '../weapons/types';

/** Weapon sprites: SVGs from src/assets/sprites/, each with its drawn size (a new one needs its id in SpriteId too). */

interface SpriteDef {
  url: string;
  /** Drawn size in world pixels, before rotation (sprites point along +x). */
  width: number;
  height: number;
}

const SPRITES: Record<SpriteId, SpriteDef> = {
  'ice-cream-cone': { url: iceCreamConeUrl, width: 30, height: 15 },
  pill: { url: pillUrl, width: 14, height: 7 },
  // Pill Pusher's mixed handful (bigger than Unmedicated's rain of little pills).
  'pill-red': { url: pillUrl, width: 18, height: 9 },
  'pill-blue': { url: pillBlueUrl, width: 18, height: 9 },
  'pill-round': { url: pillRoundUrl, width: 11, height: 11 },
  'pill-oval': { url: pillOvalUrl, width: 17, height: 8.5 },
  weasel: { url: weaselUrl, width: 32, height: 16 },
  kookaburra: { url: kookaburraUrl, width: 46, height: 40 },
  rizz: { url: rizzUrl, width: 20, height: 18 },
  'ink-needle': { url: inkNeedleUrl, width: 16, height: 5 },
  // Take a Nap's cats (not a weapon, but drawn the same way).
  'cat-ginger': { url: catGingerUrl, width: 20, height: 12 },
  'cat-grey': { url: catGreyUrl, width: 20, height: 12 },
  // Diced Coffee's drink (upright, held by the tank: not a projectile).
  'iced-coffee': { url: icedCoffeeUrl, width: 10, height: 15 },
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

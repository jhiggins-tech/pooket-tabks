import { TANK_HALF_WIDTH } from '../../game/constants';
import type { GameState } from '../../game/state';
import { getWeapon } from '../../weapons/registry';
import type { SpriteId } from '../../weapons/types';
import type { Draw } from './context';

/** larinovsky's Take a Nap: two cats curl up asleep either side of the napping tank. */

const CATS: { side: -1 | 1; sprite: SpriteId }[] = [
  { side: -1, sprite: 'cat-ginger' },
  { side: 1, sprite: 'cat-grey' },
];
/** How far from the tank's centre each cat settles. */
const CAT_GAP = TANK_HALF_WIDTH + 13;

/** The cats pop in as the nap starts, breathe while it lasts, and slip away just before the wake-up. */
export function drawNapCats(d: Draw, state: GameState): void {
  const { ctx } = d;
  for (const n of state.naps) {
    const p = state.players[n.playerId];
    if (!p?.alive) continue;
    const napTime = getWeapon(n.weaponId).heal!.napTime;
    const fadeOut = Math.min(1, Math.max(0, (napTime - n.elapsed) / 0.3));
    for (const [i, cat] of CATS.entries()) {
      const sprite = d.sprites[cat.sprite];
      if (!sprite.image.complete || sprite.image.naturalWidth === 0) continue;
      // Each cat turns up a moment after the last, with a little bounce.
      const t = Math.max(0, n.elapsed - i * 0.15) / 0.3;
      if (t <= 0) continue;
      const pop = t >= 1 ? 1 : 1 + 0.25 * Math.sin(Math.PI * t) - (1 - t) * (1 - t);
      const x = Math.max(0, Math.min(state.terrain.width - 1, p.x + cat.side * CAT_GAP));
      const y = state.terrain.surfaceY(x);
      const slope = Math.atan2(state.terrain.surfaceY(x + 6) - state.terrain.surfaceY(x - 6), 12);
      const breathe = 1 + 0.05 * Math.sin(d.time * 3.2 + i * 1.7);
      const { width: w, height: h } = sprite;
      ctx.save();
      ctx.globalAlpha = fadeOut * Math.min(1, t);
      ctx.translate(x, y + 1);
      ctx.rotate(Math.max(-0.5, Math.min(0.5, slope)));
      ctx.scale(-cat.side * pop, pop * breathe); // facing the tank
      ctx.drawImage(sprite.image, -w / 2, -h, w, h);
      ctx.restore();
    }
  }
}

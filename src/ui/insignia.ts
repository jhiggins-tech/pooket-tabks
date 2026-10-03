import type { InsigniaShape, Rank } from '../stats/ranks';

/**
 * A rank's insignia (stats/ranks.ts): a small badge in the rank's colours and shape, shown next to verified
 * players' names (in game, the lobby, the menus, the stats). Higher ranks sparkle (`sparkle-1` a shimmer,
 * `-2` twinkles, `-3` twinkles and a glow: style.css; still for anyone who prefers reduced motion).
 */

const SVG = 'http://www.w3.org/2000/svg';

const SHAPES: Record<InsigniaShape, string> = {
  shield: 'M12 1.5 21 4.8V11c0 5.6-3.9 9.6-9 11.5C6.9 20.6 3 16.6 3 11V4.8Z',
  hex: 'M12 1.5 21.3 6.8v10.4L12 22.5 2.7 17.2V6.8Z',
  star: 'M12 1.2l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.3 5.6 20.8 7 13.7 1.7 8.7l7.2-.9Z',
  crown: 'M2.5 7.5 7.4 11 12 3.5 16.6 11l4.9-3.5L19.6 19H4.4ZM4.4 20.2h15.2v2.3H4.4Z',
};

let gradients = 0;

export type InsigniaSize = 'sm' | 'md' | 'lg';

export function insignia(rank: Rank, size: InsigniaSize = 'sm'): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = `insignia insignia-${size} rank-${rank.id} sparkle-${rank.sparkle}`;
  wrap.title = `${rank.name} rank`;
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', `${rank.name} rank`);
  wrap.style.setProperty('--rank-light', rank.colours[0]);
  wrap.style.setProperty('--rank-dark', rank.colours[1]);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const id = `rank-grad-${++gradients}`;
  const defs = document.createElementNS(SVG, 'defs');
  const grad = document.createElementNS(SVG, 'linearGradient');
  grad.id = id;
  for (const [k, v] of Object.entries({ x1: '0', y1: '0', x2: '0.4', y2: '1' })) grad.setAttribute(k, v);
  for (const [offset, colour] of [['0', rank.colours[0]], ['1', rank.colours[1]]]) {
    const stop = document.createElementNS(SVG, 'stop');
    stop.setAttribute('offset', offset!);
    stop.setAttribute('stop-color', colour!);
    grad.append(stop);
  }
  defs.append(grad);
  const body = document.createElementNS(SVG, 'path');
  body.setAttribute('d', SHAPES[rank.shape]);
  body.setAttribute('fill', `url(#${id})`);
  body.setAttribute('stroke', rank.colours[1]);
  body.setAttribute('stroke-width', '1.2');
  body.setAttribute('stroke-linejoin', 'round');
  // A glint across the top: reads as metal at any size.
  const glint = document.createElementNS(SVG, 'path');
  glint.setAttribute('d', 'M7 6.5 12 4.6l5 1.9');
  glint.setAttribute('fill', 'none');
  glint.setAttribute('stroke', 'rgba(255,255,255,0.75)');
  glint.setAttribute('stroke-width', '1.3');
  glint.setAttribute('stroke-linecap', 'round');
  // (Only where there's a flat top for it: on a star or a crown it would stick out.)
  svg.append(defs, body, ...(rank.shape === 'shield' || rank.shape === 'hex' ? [glint] : []));
  wrap.append(svg);
  return wrap;
}

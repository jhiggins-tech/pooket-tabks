import type { Rank } from '../stats/ranks';
import { SHAPES } from './insignia-shapes';

/**
 * A rank's insignia (stats/ranks.ts): a small badge in the rank's colours and shape, shown next to verified
 * players' names (in game, the lobby, the menus, the stats). Higher ranks sparkle (`sparkle-1` a shimmer,
 * `-2` twinkles, `-3` twinkles and a glow: style.css; still for anyone who prefers reduced motion).
 */

const SVG = 'http://www.w3.org/2000/svg';

let gradients = 0;

export type InsigniaSize = 'sm' | 'md' | 'lg';

export function insignia(rank: Rank, size: InsigniaSize = 'sm'): HTMLElement {
  const shape = SHAPES[rank.shape];
  const [light, dark] = rank.colours;
  const wrap = document.createElement('span');
  wrap.className = `insignia insignia-${size} rank-${rank.id} sparkle-${rank.sparkle}`;
  wrap.title = `${rank.name} rank`;
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', `${rank.name} rank`);
  wrap.style.setProperty('--rank-light', light);
  wrap.style.setProperty('--rank-dark', dark);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const id = `rank-grad-${++gradients}`;
  const defs = document.createElementNS(SVG, 'defs');
  const grad = document.createElementNS(SVG, 'linearGradient');
  grad.id = id;
  for (const [k, v] of Object.entries({ x1: '0', y1: '0', x2: '0.4', y2: '1' })) grad.setAttribute(k, v);
  for (const [offset, colour] of [['0', light], ['1', dark]] as const) {
    const stop = document.createElementNS(SVG, 'stop');
    stop.setAttribute('offset', offset);
    stop.setAttribute('stop-color', colour);
    grad.append(stop);
  }
  defs.append(grad);
  const body = document.createElementNS(SVG, 'path');
  body.setAttribute('d', shape.body);
  if (shape.evenodd) body.setAttribute('fill-rule', 'evenodd');
  body.setAttribute('fill', `url(#${id})`);
  body.setAttribute('stroke', rank.stroke ?? dark);
  body.setAttribute('stroke-width', '1.2');
  body.setAttribute('stroke-linejoin', 'round');
  svg.append(defs, body);
  // The shape's own details (our own fixed drawings, never anything typed in), and a glint across a flat top.
  const extras = document.createElementNS(SVG, 'g');
  extras.innerHTML = `${shape.glint ? '<path d="M7 6.5 12 4.6l5 1.9" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="1.3" stroke-linecap="round"/>' : ''}${shape.details?.(light, dark) ?? ''}`;
  svg.append(extras);
  wrap.append(svg);
  return wrap;
}

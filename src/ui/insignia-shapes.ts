import type { InsigniaShape } from '../stats/ranks';

/**
 * The insignia's drawings (ui/insignia.ts): each shape is a body path in a 24 × 24 box, filled with the
 * rank's colours, and optionally details drawn over it (`light` / `dark` are the rank's two colours).
 * `glint`: a shine across a flat top (shields and hexagons). `evenodd`: the body has a hole.
 * A new shape: add its name to `InsigniaShape` (stats/ranks.ts) and its drawing here.
 */

export interface ShapeDef {
  body: string;
  evenodd?: true;
  glint?: true;
  details?: (light: string, dark: string) => string;
}

/** An n-pointed burst: points alternate between radius `ro` and `ri`. */
function burst(n: number, ro: number, ri: number): string {
  let d = '';
  for (let k = 0; k < n * 2; k++) {
    const a = (k * Math.PI) / n - Math.PI / 2;
    const r = k % 2 ? ri : ro;
    d += `${k ? 'L' : 'M'}${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`;
  }
  return `${d}Z`;
}

const stroke = (colour: string, opacity: number, width: number) => `fill="none" stroke="${colour}" stroke-opacity="${opacity}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`;
const CIRCLE = 'M12 2.4a9.6 9.6 0 1 0 0 19.2 9.6 9.6 0 0 0 0-19.2Z';

export const SHAPES: Record<InsigniaShape, ShapeDef> = {
  shield: { body: 'M12 1.5 21 4.8V11c0 5.6-3.9 9.6-9 11.5C6.9 20.6 3 16.6 3 11V4.8Z', glint: true },
  hex: { body: 'M12 1.5 21.3 6.8v10.4L12 22.5 2.7 17.2V6.8Z', glint: true },
  star: { body: 'M12 1.2l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.3 5.6 20.8 7 13.7 1.7 8.7l7.2-.9Z' },
  crown: { body: 'M2.5 7.5 7.4 11 12 3.5 16.6 11l4.9-3.5L19.6 19H4.4ZM4.4 20.2h15.2v2.3H4.4Z' },
  potato: {
    body: 'M3.5 12.6C3.1 8 6.4 4.5 11.6 4.4c5.3-.1 9 3.1 9 7.7 0 5-3.7 8.3-8.5 8.3-4.8 0-8.3-3.1-8.6-7.8Z',
    details: (_l, d) => `<circle cx="9" cy="10.6" r=".95" fill="${d}" opacity=".8"/><circle cx="14.7" cy="9.4" r=".95" fill="${d}" opacity=".8"/><circle cx="12.6" cy="15.3" r=".95" fill="${d}" opacity=".8"/><path d="M6.8 8.4c1.2-1.4 2.9-2 4.6-2.1" ${stroke('#fff', 0.55, 1.1)}/>`,
  },
  log: {
    body: 'M12 2.2a9.8 9.8 0 1 0 0 19.6 9.8 9.8 0 0 0 0-19.6Z',
    details: (_l, d) => `<circle cx="12" cy="12" r="6.6" ${stroke(d, 0.6, 1)}/><circle cx="12" cy="12" r="3.4" ${stroke(d, 0.6, 1)}/><circle cx="12" cy="12" r="1" fill="${d}" opacity=".7"/><path d="M12 12 18.4 9.2" ${stroke(d, 0.45, 0.9)}/>`,
  },
  brick: {
    body: 'M3 10.2h18v8.8c0 .9-.7 1.6-1.6 1.6H4.6C3.7 20.6 3 19.9 3 19ZM6 6.4h4.4v3.8H6ZM13.6 6.4H18v3.8h-4.4Z',
    details: (_l, d) => `<path d="M3 16.2h18" ${stroke(d, 0.35, 1)}/><path d="M4.6 11.6h14" ${stroke('#fff', 0.5, 1.1)}/>`,
  },
  box: {
    body: 'M12 2.6 21 7.2v9.6L12 21.4 3 16.8V7.2Z',
    details: (_l, d) => `<path d="M3 7.2l9 4.6 9-4.6M12 11.8v9.6" ${stroke(d, 0.7, 1)}/><path d="M7.4 4.9l9 4.6" ${stroke('#fff', 0.45, 2)}/>`,
  },
  glass: {
    body: 'M5.2 3.5h13.6l-1.9 16.2a1.6 1.6 0 0 1-1.6 1.4H8.7a1.6 1.6 0 0 1-1.6-1.4Z',
    details: () => `<path d="M6.1 10.6h11.8" ${stroke('#fff', 0.7, 1.2)}/><path d="M8.1 6l.9 11" ${stroke('#fff', 0.75, 1.1)}/>`,
  },
  tower: {
    body: 'M5 21V10l1.5-1.5V4h2.7v2.2h1.7V4h2.2v2.2h1.7V4h2.7v4.5L19 10v11Z',
    details: (_l, d) => `<path d="M10 21v-4a2 2 0 0 1 4 0v4Z" fill="${d}" opacity=".7"/><path d="M11.4 11.4h1.2v2.6h-1.2Z" fill="${d}" opacity=".7"/>`,
  },
  marble: {
    body: CIRCLE,
    details: (_l, d) => `<path d="M4.8 9c3 2 4 5.5 8 6.5s5 3.5 6.2 4.6M8.2 3.6c.4 3 3.4 4 4.4 6.2" ${stroke(d, 0.45, 1)}/><path d="M6.4 6.6a7 7 0 0 1 4-2.7" ${stroke('#fff', 0.8, 1.3)}/>`,
  },
  emerald: {
    body: 'M8.5 2.5h7L19 6v12l-3.5 3.5h-7L5 18V6Z',
    details: () => `<path d="M9.2 6.2h5.6l1.7 1.7v8.2l-1.7 1.7H9.2l-1.7-1.7V7.9Z" ${stroke('#fff', 0.5, 0.9)}/><path d="M9.2 6.2 7.5 7.9M14.8 6.2l1.7 1.7M9.2 17.8l-1.7-1.7M14.8 17.8l1.7-1.7" ${stroke('#fff', 0.3, 0.8)}/>`,
  },
  gem: {
    body: 'M7.2 3.5h9.6L21.5 9 12 21.2 2.5 9Z',
    details: () => `<path d="M2.5 9h19M7.2 3.5 9.5 9 12 3.5 14.5 9l2.3-5.5M9.5 9 12 21.2 14.5 9" ${stroke('#fff', 0.5, 0.9)}/>`,
  },
  shard: {
    body: 'M12 1.8l5.4 6.4 2.9 6.8-5.7 6.7-3.9-3.4-6 2.2 1.1-8.5L8.3 6.4Z',
    details: () => `<path d="M12 1.8 10.7 18.3M12 1.8 14 12.5 20.3 15M8.3 6.4l5.7 6.1-8.2-.5" ${stroke('#fff', 0.5, 0.9)}/>`,
  },
  tile: {
    body: 'M5.5 2.5h13A3 3 0 0 1 21.5 5.5v13a3 3 0 0 1-3 3h-13a3 3 0 0 1-3-3v-13a3 3 0 0 1 3-3Z',
    details: (_l, d) => `<path d="M5.5 4.9h13" ${stroke('#fff', 0.55, 1)}/><text x="12" y="16.4" font-size="9.6" font-weight="800" text-anchor="middle" fill="${d}" font-family="system-ui,sans-serif">Ti</text><text x="5.4" y="8.4" font-size="3.6" font-weight="700" fill="${d}" opacity=".75" font-family="system-ui,sans-serif">22</text>`,
  },
  ring: {
    body: 'M12 2.4a9.6 9.6 0 1 0 0 19.2 9.6 9.6 0 0 0 0-19.2ZM12 7.3a4.7 4.7 0 1 1 0 9.4 4.7 4.7 0 0 1 0-9.4Z',
    evenodd: true,
    details: () => `<path d="M5.2 8.8A8.2 8.2 0 0 1 11 3.9" ${stroke('#fff', 0.8, 1.2)}/>`,
  },
  ingot: {
    body: 'M7.4 5h9.2l4.8 12.4H2.6Z',
    details: () => `<path d="M7.4 5h9.2l1.2 3.2H6.2Z" fill="#fff" opacity=".28"/><circle cx="9.2" cy="13.6" r=".95" fill="#f5c542"/><circle cx="14.6" cy="12.2" r=".8" fill="#f5c542"/><circle cx="12" cy="15.6" r=".7" fill="#f5c542"/><circle cx="17" cy="15.4" r=".7" fill="#f5c542"/>`,
  },
  claws: {
    body: 'M2 21.5h3.6L9.4 2.5h-4ZM7.2 21.5h3.6l3.8-19h-4ZM12.4 21.5H16l3.8-19h-4Z',
    details: () => `<path d="M6.3 5.2 5.1 11M11.5 5.2 10.3 11M16.7 5.2 15.5 11" ${stroke('#fff', 0.55, 1)}/>`,
  },
  orb: {
    body: CIRCLE,
    details: (_l, d) => `<text x="12" y="17.4" font-size="14" font-weight="800" text-anchor="middle" fill="${d}" opacity=".85" font-family="system-ui,sans-serif">?</text><path d="M6.4 6.6a7 7 0 0 1 4-2.7" ${stroke('#fff', 0.8, 1.3)}/>`,
  },
  duck: {
    body: 'M14.2 3.7a3.7 3.7 0 1 1 0 7.4 3.7 3.7 0 0 1 0-7.4ZM3.4 15.3c0-3 2.3-5 5.5-5 1.2 0 2.3.4 3.2 1 .8.4 1.6.6 2.4.6 2.9.2 5 2.2 5 4.8 0 3.2-3.4 4.8-8.2 4.8-5.2 0-7.9-1.5-7.9-6.2Z',
    details: () => `<path d="M17.6 6.5l4 1-4 1.5Z" fill="#ff9d2e" stroke="#c76a00" stroke-width=".6" stroke-linejoin="round"/><circle cx="15.2" cy="6.6" r=".85" fill="#3b2a12"/><path d="M7.4 15.4c1.7 2 4.9 2 6.3-.3" ${stroke('#000', 0.3, 1)}/>`,
  },
  stone: {
    body: 'M4.2 14.6 6.4 7.8 11.6 4.2 18 6.4l2.8 6.4-2.6 6.2H8.2Z',
    details: (_l, d) => `<path d="M11.6 4.2 10.2 11l4.3 3.2M10.2 11 6.4 7.8M14.5 14.2 18.2 19" ${stroke(d, 0.6, 0.9)}/>`,
  },
  can: {
    body: 'M5 6.5c0-1.7 3.1-3 7-3s7 1.3 7 3v11c0 1.7-3.1 3-7 3s-7-1.3-7-3Z',
    details: (_l, d) => `<path d="M5 6.5c0 1.7 3.1 3 7 3s7-1.3 7-3M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" ${stroke(d, 0.55, 0.9)}/><path d="M8 10.6v7.2" ${stroke('#fff', 0.7, 1.2)}/>`,
  },
  anvil: {
    body: 'M2.5 6.5h15.8c2.3 0 3.7.8 3.2 3.2-.6 2.6-3 3.2-5.8 3.3-.8 0-1.2.6-1.2 1.4V16h2.5v3.5H6.5V16H9v-2.2c0-.8-.4-1.4-1.2-1.4C5.6 12.3 4 10.2 2.5 8Z',
    details: () => `<path d="M5 8h14.5" ${stroke('#fff', 0.5, 1.1)}/>`,
  },
  cheese: {
    body: 'M2.2 11.8 21.8 5.6c.4-.1.7.2.7.6v11.4c0 .9-.7 1.6-1.6 1.6H3.8c-.9 0-1.6-.7-1.6-1.6Z',
    details: (_l, d) => `<path d="M2.2 11.8H22.5" ${stroke(d, 0.4, 0.9)}/><circle cx="7" cy="15.5" r="1.5" fill="${d}" opacity=".55"/><circle cx="13" cy="14.5" r="1.1" fill="${d}" opacity=".55"/><circle cx="17.6" cy="16.6" r="1.4" fill="${d}" opacity=".55"/><circle cx="10.6" cy="17.7" r=".8" fill="${d}" opacity=".55"/>`,
  },
  crystal: {
    body: 'M12 1.8 18 7v9.8L12 22.2 6 16.8V7Z',
    details: () => `<path d="M6 7l6 3.6L18 7M12 10.6v11.6" ${stroke('#fff', 0.5, 0.9)}/>`,
  },
  oval: {
    body: 'M12 2.5c4.4 0 7.5 4.4 7.5 9.5s-3.1 9.5-7.5 9.5S4.5 17.1 4.5 12 7.6 2.5 12 2.5Z',
    details: () => `<path d="M12 6.4c2.3 0 3.9 2.6 3.9 5.6s-1.6 5.6-3.9 5.6S8.1 15 8.1 12 9.7 6.4 12 6.4Z" ${stroke('#fff', 0.5, 0.9)}/><path d="M4.5 12h15M12 2.5v19" ${stroke('#fff', 0.25, 0.8)}/>`,
  },
  bolt: {
    body: 'M13.6 1.8 4.6 13.4h6.1l-1.9 8.8 9.6-12.6h-6.4Z',
    details: () => `<path d="M12.4 4.6 8 11.4" ${stroke('#fff', 0.7, 1)}/>`,
  },
  nova: {
    body: burst(8, 10.8, 5.4),
    details: () => `<circle cx="12" cy="12" r="2.6" fill="#fff" opacity=".85"/>`,
  },
  hole: {
    body: 'M12 3.6c5.2 0 9.5 3.7 9.5 8.4S17.2 20.4 12 20.4 2.5 16.7 2.5 12 6.8 3.6 12 3.6ZM12 7.2c-2.6 0-4.8 2.1-4.8 4.8s2.2 4.8 4.8 4.8 4.8-2.1 4.8-4.8S14.6 7.2 12 7.2Z',
    evenodd: true,
    details: () => `<circle cx="12" cy="12" r="4.6" fill="#07040f" stroke="#8b5cf6" stroke-width=".9"/><path d="M3.4 10.6c3-3.2 9.6-4.4 17.2-.5" ${stroke('#fff', 0.6, 1)}/>`,
  },
};

/**
 * kiwicore's Long Exposure (game/camera.ts): the camera's settings and the light it's shot in. Everything
 * moves in real full stops, and the exposure, depth of field and shake follow the real rules of thumb
 * (the formulas are in game/camera.ts), so a photographer's instincts work.
 */

/** The lenses: focal length (mm), and the widest aperture it opens to (an index into `APERTURES`). */
export const LENSES = [
  { mm: 24, widest: 1, name: '24mm f/2.8' },
  { mm: 50, widest: 0, name: '50mm f/1.8' },
  { mm: 200, widest: 1, name: '200mm f/2.8' },
] as const;

/** f-numbers, wide open to stopped down. */
export const APERTURES = [1.8, 2.8, 4, 5.6, 8, 11, 16] as const;

/** Shutter speeds, slow to fast: seconds, and how the viewfinder and the top LCD say them. */
export const SHUTTERS = [
  { s: 1 / 15, label: '1/15', lcd: '15' },
  { s: 1 / 30, label: '1/30', lcd: '30' },
  { s: 1 / 60, label: '1/60', lcd: '60' },
  { s: 1 / 125, label: '1/125', lcd: '125' },
  { s: 1 / 250, label: '1/250', lcd: '250' },
  { s: 1 / 500, label: '1/500', lcd: '500' },
  { s: 1 / 1000, label: '1/1000', lcd: '1000' },
  { s: 1 / 2000, label: '1/2000', lcd: '2000' },
] as const;

export const ISOS = [100, 200, 400, 800, 1600, 3200, 6400] as const;

/**
 * White balance: Auto (kelvin 0), the four presets, then the Kelvin setting in 500K steps (a real camera's
 * K mode goes in 100s; coarser here, so a dial gets there in time). `PRESETS` of them are the presets.
 */
export const WHITE_BALANCE: readonly { kelvin: number; lcd: string; name: string }[] = [
  { kelvin: 0, lcd: 'AWB', name: 'Auto' },
  { kelvin: 3200, lcd: 'TUNGSTEN', name: 'Tungsten' },
  { kelvin: 5500, lcd: 'DAYLIGHT', name: 'Daylight' },
  { kelvin: 6500, lcd: 'CLOUDY', name: 'Cloudy' },
  { kelvin: 7500, lcd: 'SHADE', name: 'Shade' },
  ...[2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500, 8000, 8500, 9000, 9500, 10000].map((k) => ({ kelvin: k, lcd: `K${k}`, name: `${k}K` })),
];
/** How many of `WHITE_BALANCE` are Auto and the presets (the rest are Kelvin). */
export const PRESETS = 5;

/**
 * The mode dial. P: the camera sets the aperture and shutter; Tv: you set the shutter, it sets the
 * aperture; Av: the other way round; M: both yours. The easier the mode, the less a photo can do (`cap`).
 */
export const MODES = [
  { id: 'P', cap: 35 },
  { id: 'Tv', cap: 60 },
  { id: 'Av', cap: 60 },
  { id: 'M', cap: 77 },
] as const;
export type ModeId = (typeof MODES)[number]['id'];

/**
 * The light a match is shot in (picked by the seed): its exposure value at ISO 100 (sunny 16 is EV 15),
 * its colour temperature, and how the viewfinder grades the battlefield to look it (`grade`: a colour laid
 * over it, how strongly, and its brightness).
 */
export const SCENES = [
  { name: 'Golden hour', ev: 11, kelvin: 3500, grade: '#ff9a3c', strength: 0.22, brightness: 1 },
  { name: 'Sunny', ev: 15, kelvin: 5500, grade: '#fff3c4', strength: 0.08, brightness: 1.06 },
  { name: 'Overcast', ev: 12, kelvin: 6500, grade: '#9aa7b8', strength: 0.22, brightness: 0.94 },
  { name: 'Dusk', ev: 8, kelvin: 9000, grade: '#2c3f8f', strength: 0.32, brightness: 0.78 },
] as const;

/** How far the battlefield is, for the focus ring and depth of field: world px per metre. */
export const PX_PER_M = 10;

/**
 * The frame in world px: `FRAME_SPAN / mm` wide (a 24mm sees most of the field, a 200mm about a tank and a
 * half), `FRAME_ASPECT` wide to high. The viewfinder on the screen shows exactly that.
 */
export const FRAME_SPAN = 14000;
export const FRAME_ASPECT = 1.85;

/** The focus ring's distance scale: 0 is the closest it focuses (0.45 m), 100 is infinity. */
export const RING_MIN_M = 0.45;
export const RING_RANGE = 222;

import { APERTURES, FRAME_ASPECT, FRAME_SPAN, ISOS, LENSES, MODES, PRESETS, PX_PER_M, RING_MIN_M, RING_RANGE, SCENES, SHUTTERS, WHITE_BALANCE } from '../weapons/camera';
import type { WeaponOf } from '../weapons/types';
import { kindOf, weaponOf } from '../weapons/registry';
import { TANK_BODY_HEIGHT, TANK_HALF_WIDTH, WORLD_H, WORLD_W } from './constants';
import { sound, spawnFloater } from './fx';
import { canUseSlot, weaponForTier } from './loadout';
import type { Stepper } from './mechanics';
import type { Camera, GameState, Photo, Player, TargetMark } from './state';
import { blind } from './statuses';
import { allTargets, applyHit, currentPlayer, scaled, tankCentre, targetOf, targetOwner, targetPos, type Target } from './tanks';
import { clamp } from './util';

/**
 * kiwicore's Long Exposure: FIRE and he raises a camera (the `shooting` phase). The screen becomes its
 * viewfinder on the battlefield, with the body's controls round it (render/hud/camera.ts): the mode dial,
 * WB and ISO, the flash, the lens, AF/MF and AF-ON, the main and quick control dials, the shutter, the top
 * LCD and the focus ring. A memory card holds three shots, `camera.shotTime` s each (at zero the shutter
 * fires by itself); after each he can take the next or keep the best so far. The best photo's damage
 * lands on whoever is in it.
 *
 * Each card starts with the camera in a mess (`scramble`, from the seed: exposure 1.5 to 3.5 stops out,
 * the white balance 1500K or more off, the focus far off and the camera pointed away from the enemy), in
 * the light the match is shot in (`sceneOf`, from the seed). A photo is scored on six factors, 0.4 to 1
 * each, and does `floor + range × their product` damage (a Perfect Shot, every factor 0.95 or better,
 * `perfect` more), up to the mode's cap (weapons/camera.ts `MODES`):
 *
 * | factor | full marks | the rule |
 * |---|---|---|
 * | exposure | within 1/3 stop | EV = log2(N²/t) − log2(ISO/100), against the scene's EV |
 * | focus | the subject in the depth of field | the hyperfocal formula, circle of confusion 0.03 mm |
 * | sharpness | shutter 1/focal length or faster (and 1/125 for the tank's idle bob) | the reciprocal rule |
 * | noise | ISO 400 or less | a stop of grain for each stop above |
 * | white balance | within 10 mireds of the light | mireds: 1,000,000 ÷ kelvin |
 * | composition | on a rule-of-thirds point, filling a tenth of the frame | |
 *
 * The flash adds two stops to a dark photo (exposure capped at 0.8) and blinds whoever's in it: no aim
 * guide on their next turn (statuses.ts). Hand shake grows with the lens (`shake`): what he sees through
 * a 200mm wanders.
 *
 * Like 007 (bond.ts) it's this phone's input: only his phone runs its clock (`cameraClock`) and takes the
 * controls (`cameraInput`); the other phone and spectators see the same viewfinder, following it in the
 * aim previews (net/follow.ts, `followCamera`). Once the card's done (`cameraReady`) his phone fires it,
 * and that shot is the best photo developing (`DEVELOP`), then its damage (`cameraStepper`).
 */

/** How long the best photo shows once it's fired (s), and when its damage lands. */
export const DEVELOP = { hit: 1.6, end: 2.6 } as const;

/** The six factors, in the order a photo's `scores` keep them. */
export const FACTORS = ['Exposure', 'Focus', 'Sharpness', 'Noise', 'White balance', 'Composition'] as const;

/** The hand shake's size, in world px (it looks bigger the longer the lens, as the frame is smaller). */
const SHAKE = 3;
/** Every factor's floor. */
const FLOOR = 0.4;

/** What the camera can be told to do (one tap, or one notch of a dial). */
export type CameraAction =
  | { k: 'mode' }
  | { k: 'lens' }
  | { k: 'dial'; dial: 'main' | 'quick'; d: 1 | -1 }
  | { k: 'fn'; fn: 'iso' | 'wb' }
  | { k: 'set' }
  | { k: 'flash' }
  | { k: 'afmf' }
  | { k: 'afon' }
  | { k: 'focus'; ring: number }
  | { k: 'pan'; dx: number; dy: number }
  | { k: 'shutter' }
  | { k: 'next' }
  | { k: 'keep' };

/** Whether tier `tier` is a Long Exposure. */
export function isCamera(p: Player, tier: number): boolean {
  return p.loadout[tier] !== undefined && kindOf(weaponForTier(p, tier)) === 'camera';
}

/** The light this match is shot in (`SCENES`), from its seed. */
export function sceneOf(state: GameState): number {
  return (((state.seed >>> 0) * 2654435761) >>> 0) % SCENES.length;
}

/** FIRE on Long Exposure: the camera comes up, scrambled (the round is spent when it's fired, once the card's done). */
export function startCamera(state: GameState): boolean {
  const p = currentPlayer(state);
  if (state.phase !== 'aiming' || p.hop || p.flight || !isCamera(p, p.selectedTier) || !canUseSlot(state, p, p.selectedTier)) return false;
  const w = weaponOf(p.loadout[p.selectedTier]!, 'camera');
  const scene = sceneOf(state);
  state.camera = {
    playerId: p.id,
    weaponId: w.id,
    scene,
    mode: MODES.length - 1,
    fn: null,
    flash: false,
    af: false,
    ...scramble(state, p, scene),
    t: 0,
    left: w.camera.shotTime,
    view: 'aim',
    photos: [],
    done: false,
    outro: null,
  };
  state.phase = 'shooting';
  sound(state, 'camera-up', w.id);
  return true;
}

/**
 * A fresh card's settings, from the gameplay RNG: a lens; an exposure 1.5 to 3.5 stops out; a Kelvin white
 * balance 1500K or more off; the focus near or at infinity; pointed somewhere on his side of the field.
 */
function scramble(state: GameState, p: Player, scene: number): Pick<Camera, 'lens' | 'ap' | 'sh' | 'iso' | 'wb' | 'ring' | 'x' | 'y'> {
  const r = (n: number) => Math.min(n - 1, Math.floor(state.rng() * n));
  const light = SCENES[scene]!;
  let pick = { lens: 0, ap: APERTURES.length - 1, sh: SHUTTERS.length - 1, iso: 0, wb: PRESETS };
  for (let i = 0; i < 200; i++) {
    const lens = r(LENSES.length);
    const ap = Math.max(LENSES[lens]!.widest, r(APERTURES.length));
    const sh = r(SHUTTERS.length);
    const iso = r(ISOS.length);
    const wb = PRESETS + r(WHITE_BALANCE.length - PRESETS);
    const err = Math.abs(evError(ap, sh, iso, light.ev));
    if (err < 1.5 || err > 3.5 || Math.abs(WHITE_BALANCE[wb]!.kelvin - light.kelvin) < 1500) continue;
    pick = { lens, ap, sh, iso, wb };
    break;
  }
  const ring = state.rng() < 0.5 ? 5 + r(40) : 90 + r(11);
  // Over his own shoulder: somewhere between him and the near edge of the field.
  const side = p.x < WORLD_W / 2 ? -1 : 1;
  const x = clamp(p.x + side * (60 + r(140)), 0, WORLD_W);
  const y = clamp(p.y - 60 - r(80), 0, WORLD_H);
  return { ...pick, ring, x, y };
}

/** How many stops a setting is under (+) or over (−) exposed, in light of exposure value `ev`. */
function evError(ap: number, sh: number, iso: number, ev: number): number {
  const n = APERTURES[ap]!;
  return Math.log2((n * n) / SHUTTERS[sh]!.s) - Math.log2(ISOS[iso]! / 100) - ev;
}

/** The aperture and shutter the camera's using: in Tv, Av and P it picks the ones you don't set. */
export function exposureOf(c: Camera): { ap: number; sh: number } {
  const mode = MODES[c.mode]!.id;
  const lens = LENSES[c.lens]!;
  const ev = SCENES[c.scene]!.ev;
  let ap = Math.max(c.ap, lens.widest);
  let sh = c.sh;
  const bestShutter = (a: number) => nearest(SHUTTERS.length, (s) => Math.abs(evError(a, s, c.iso, ev)));
  if (mode === 'Av') sh = bestShutter(ap);
  if (mode === 'Tv') ap = lens.widest + nearest(APERTURES.length - lens.widest, (i) => Math.abs(evError(i + lens.widest, sh, c.iso, ev)));
  if (mode === 'P') {
    // Spot on if it can be, hand-holdable if it can be, and near f/5.6.
    let best = Infinity;
    for (let a = lens.widest; a < APERTURES.length; a++) {
      const s = bestShutter(a);
      const cost = Math.abs(evError(a, s, c.iso, ev)) * 10 + (SHUTTERS[s]!.s > 1 / lens.mm ? 3 : 0) + Math.abs(Math.log2(APERTURES[a]! / 5.6)) * 0.5;
      if (cost < best) [best, ap, sh] = [cost, a, s];
    }
  }
  return { ap, sh };
}

/** The index (0 to n−1) where `cost` is least (the first, on a tie). */
function nearest(n: number, cost: (i: number) => number): number {
  let best = 0;
  for (let i = 1; i < n; i++) if (cost(i) < cost(best)) best = i;
  return best;
}

/** The frame's size in world px with the lens on. */
export function frameOf(c: Camera): { w: number; h: number } {
  const w = FRAME_SPAN / LENSES[c.lens]!.mm;
  return { w, h: w / FRAME_ASPECT };
}

/** Where the frame's centre is right now: where it's pointed, plus the hand shake. */
export function frameCentre(c: Camera): { x: number; y: number } {
  const t = c.t;
  return {
    x: c.x + SHAKE * (Math.sin(t * 1.7) + 0.5 * Math.sin(t * 3.1 + 1) + 0.25 * Math.sin(t * 7.3 + 2)),
    y: c.y + SHAKE * (Math.cos(t * 1.3) + 0.5 * Math.sin(t * 2.3) + 0.25 * Math.cos(t * 6.1 + 0.5)),
  };
}

/** The focus ring's distance (m; Infinity at the end), for a ring position 0 to 100. */
export function ringMetres(ring: number): number {
  return ring >= 100 ? Infinity : RING_MIN_M * Math.pow(RING_RANGE, ring / 100);
}

/** The ring position (0 to 100) that focuses at `m` metres. */
export function ringFor(m: number): number {
  return m === Infinity ? 100 : clamp((Math.log(m / RING_MIN_M) / Math.log(RING_RANGE)) * 100, 0, 100);
}

/** Where a target looks to be (the middle of its hull) and how big it is, in world px. */
function subjectBox(t: Target): { x: number; y: number; w: number; h: number } {
  const at = targetPos(t);
  return { x: at.x, y: at.y - TANK_BODY_HEIGHT * 0.6, w: TANK_HALF_WIDTH * 2, h: TANK_BODY_HEIGHT + 4 };
}

/** The enemy targets he can see (a tank hidden by Sly isn't there for him), nearest the frame's centre first, in the frame. */
function subjectsInFrame(state: GameState, c: Camera): Target[] {
  const { w, h } = frameOf(c);
  const f = frameCentre(c);
  return allTargets(state)
    .filter((t) => targetOwner(t) !== c.playerId && !(t.kind === 'tank' && t.player.hidden))
    .filter((t) => {
      const b = subjectBox(t);
      return Math.abs(b.x - f.x) < w / 2 && Math.abs(b.y - f.y) < h / 2;
    })
    .sort((a, b) => dist2(subjectBox(a), f) - dist2(subjectBox(b), f));
}

const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** How far from him `at` is, in metres. */
function metresTo(state: GameState, c: Camera, at: { x: number; y: number }): number {
  const me = tankCentre(state.players[c.playerId]!);
  return Math.max(RING_MIN_M, Math.hypot(at.x - me.x, at.y - me.y) / PX_PER_M);
}

/** Below 1 a factor is linear from 1 at `full` to the floor at `worst`. */
function falloff(off: number, full: number, worst: number): number {
  if (off <= full) return 1;
  return Math.max(FLOOR, 1 - ((1 - FLOOR) * (off - full)) / (worst - full));
}

/** How the photo would come out right now, factor by factor (and what it's of). */
export function meter(state: GameState, c: Camera): {
  scores: number[];
  subject: Target | null;
  /** Stops under (+) or over (−), before the flash. */
  err: number;
  /** Stops of blur from the shutter being too slow. */
  slow: number;
  /** Mireds off: + too warm, − too cool (0 on Auto). */
  mireds: number;
  noise: number;
  /** How sharp the viewfinder looks (0.4 to 1): the subject's focus, or with none, what's at the frame's centre. */
  look: number;
} {
  const light = SCENES[c.scene]!;
  const lens = LENSES[c.lens]!;
  const { ap, sh } = exposureOf(c);
  const n = APERTURES[ap]!;
  const iso = ISOS[c.iso]!;
  const err = evError(ap, sh, c.iso, light.ev);
  // Exposure: the flash fills in up to two stops of a dark photo, but flattens the light.
  const lit = c.flash && err > 0 ? Math.max(0, err - 2) : err;
  let E = falloff(Math.abs(lit), 1 / 3, 2);
  if (c.flash) E = Math.min(E, 0.8);
  const subject = subjectsInFrame(state, c)[0] ?? null;
  // Focus: the hyperfocal distance, the near and far limits of what's sharp, and how far out the subject is.
  const f = lens.mm;
  const hyper = (f * f) / (n * 0.03) + f;
  const s = Math.min(ringMetres(c.ring), 1e6) * 1000;
  const near = (s * (hyper - f)) / (hyper + s - 2 * f);
  const far = s >= hyper ? Infinity : (s * (hyper - f)) / (hyper - s);
  const focusAt = (mm: number) => {
    const off = mm < near ? near - mm : mm > far ? mm - far : 0;
    return 1 - (1 - FLOOR) * Math.min(1, off / Math.max(Math.min(far - near, 1e9), 500) / 3);
  };
  const F = subject ? focusAt(metresTo(state, c, subjectBox(subject)) * 1000) : FLOOR;
  const centre = frameCentre(c);
  const ground = state.terrain.isSolid(Math.round(centre.x), Math.round(centre.y));
  const look = subject ? F : focusAt(ground ? metresTo(state, c, centre) * 1000 : 1e12);
  // Sharpness: the reciprocal rule (and the tank's bob).
  const slow = Math.log2(SHUTTERS[sh]!.s / Math.min(1 / f, 1 / 125));
  const S = slow <= 0.05 ? 1 : Math.max(FLOOR, 1 - 0.2 * slow);
  const noise = Math.max(0, Math.log2(iso / 400));
  const N = 1 - 0.15 * noise;
  // White balance in mireds: a setting warmer than the light makes the photo warm.
  const kelvin = WHITE_BALANCE[c.wb]!.kelvin;
  const mireds = kelvin === 0 ? 0 : 1e6 / light.kelvin - 1e6 / kelvin;
  const W = kelvin === 0 ? 0.85 : falloff(Math.abs(mireds), 10, 100);
  // Composition: on a thirds point, and big enough in the frame.
  let C = FLOOR;
  if (subject) {
    const { w, h } = frameOf(c);
    const fc = frameCentre(c);
    const b = subjectBox(subject);
    const sx = b.x - (fc.x - w / 2);
    const sy = b.y - (fc.y - h / 2);
    const diag = Math.hypot(w, h);
    const thirds = Math.min(...[1, 2].flatMap((i) => [1, 2].map((j) => Math.hypot(sx - (w * i) / 3, sy - (h * j) / 3))));
    const placed = 1 - (1 - FLOOR) * Math.min(1, Math.max(0, thirds - 0.03 * diag) / (0.15 * diag));
    const size = Math.min(1, 0.5 + 0.5 * Math.sqrt((b.w * b.h) / (w * h) / 0.1));
    C = Math.max(FLOOR, placed * size);
  }
  return { scores: [E, F, S, N, W, C], subject, err, slow, mireds, noise, look };
}

/** The shutter: a photo for the card, scored now. `auto`: the clock ran out and it fired itself. */
function takePhoto(state: GameState, c: Camera, auto: boolean): Photo {
  const w = weaponOf(c.weaponId, 'camera');
  const m = meter(state, c);
  const mode = MODES[c.mode]!;
  const perfect = !!m.subject && m.scores.every((v) => v >= 0.95);
  const raw = Math.round(w.camera.floor + w.camera.range * m.scores.reduce((a, b) => a * b, 1)) + (perfect ? w.camera.perfect : 0);
  const damage = m.subject ? Math.min(mode.cap, raw) : 0;
  const { ap, sh } = exposureOf(c);
  const wb = WHITE_BALANCE[c.wb]!;
  return {
    scores: m.scores,
    damage,
    perfect,
    capped: !!m.subject && raw > mode.cap,
    flash: c.flash,
    auto,
    mark: m.subject ? markOf(m.subject) : null,
    settings: `${mode.id} · ${LENSES[c.lens]!.mm}mm · ${SHUTTERS[sh]!.label} · f/${APERTURES[ap]} · ISO ${ISOS[c.iso]} · ${wb.kelvin ? `${wb.kelvin}K` : 'AWB'}`,
    tip: tipFor(c, m),
  };
}

function markOf(t: Target): TargetMark {
  return t.kind === 'hologram' ? { kind: 'hologram', id: t.holo.id } : { kind: 'tank', playerId: t.player.id, twin: t.tank !== t.player };
}

/** What to fix next time: the weakest factor's advice. */
function tipFor(c: Camera, m: ReturnType<typeof meter>): string {
  if (!m.subject) return 'No enemy in the frame, so nothing lands. Pan until a tank’s in the viewfinder.';
  if (m.scores.every((v) => v >= 0.95)) return 'Perfect Shot. kiwicore would frame this one.';
  const worst = m.scores.indexOf(Math.min(...m.scores));
  const mm = LENSES[c.lens]!.mm;
  switch (FACTORS[worst]) {
    case 'Exposure':
      return m.err > 0 ? 'Too dark: open the aperture, slow the shutter, raise the ISO, or pop the flash.' : 'Too bright: stop down, use a faster shutter, or lower the ISO.';
    case 'Focus':
      return c.af ? 'Soft: put the centre AF point on the tank and press AF-ON, then recompose.' : 'Soft: turn the focus ring until the green dot lights.';
    case 'Sharpness':
      return `Shake blur: hand-held at ${mm}mm wants ${mm >= 200 ? '1/250' : '1/125'} or faster.`;
    case 'Noise':
      return `Grainy: ISO ${ISOS[c.iso]} is noisy. Find the light with the aperture or the shutter instead.`;
    case 'White balance':
      return m.mireds === 0 ? 'Auto WB played it safe. Read the light and set the Kelvin to match.' : m.mireds > 0 ? 'Too warm: set a lower Kelvin.' : 'Too cool: set a higher Kelvin.';
    default:
      return 'Composition: put the tank on a thirds point, and use a longer lens to fill the frame.';
  }
}

/** His phone: the clocks run, and at zero the shutter fires by itself. */
export function cameraClock(state: GameState, dt: number): void {
  const c = state.camera;
  if (state.phase !== 'shooting' || !c || c.done || c.view !== 'aim') return;
  c.t += dt;
  c.left = Math.max(0, c.left - dt);
  if (c.left <= 0) shoot(state, c, true);
}

function shoot(state: GameState, c: Camera, auto: boolean): void {
  const photo = takePhoto(state, c, auto);
  c.photos.push(photo);
  c.fn = null;
  c.view = c.photos.length >= weaponOf(c.weaponId, 'camera').camera.shots ? 'card' : 'review';
  sound(state, photo.flash ? 'camera-flash' : 'camera-shutter', c.weaponId);
}

/** His phone: a control on the camera. */
export function cameraInput(state: GameState, a: CameraAction): void {
  const c = state.camera;
  if (state.phase !== 'shooting' || !c || c.done) return;
  const w = weaponOf(c.weaponId, 'camera');
  if (c.view !== 'aim') {
    // Looking at a photo: take the next, or keep the best so far (and the card at the end: done).
    if (a.k === 'next' && c.view === 'review') {
      c.view = 'aim';
      c.left = w.camera.shotTime;
    } else if (a.k === 'keep') {
      if (c.view === 'card') c.done = true;
      else c.view = 'card';
    }
    return;
  }
  const lens = LENSES[c.lens]!;
  const mode = MODES[c.mode]!.id;
  switch (a.k) {
    case 'mode':
      c.mode = (c.mode + 1) % MODES.length;
      c.fn = null;
      break;
    case 'lens':
      c.lens = (c.lens + 1) % LENSES.length;
      c.ap = Math.max(c.ap, LENSES[c.lens]!.widest);
      break;
    case 'fn':
      c.fn = c.fn === a.fn ? null : a.fn;
      break;
    case 'set':
      c.fn = null;
      break;
    case 'flash':
      c.flash = !c.flash;
      break;
    case 'afmf':
      c.af = !c.af;
      break;
    case 'afon': {
      if (!c.af) return;
      // Focus on whatever's under the centre point: a tank, the ground, or the sky (infinity).
      const at = frameCentre(c);
      const hit = allTargets(state).find((t) => {
        const b = subjectBox(t);
        return Math.abs(b.x - at.x) < b.w / 2 + 2 && Math.abs(b.y - at.y) < b.h / 2 + 3;
      });
      const ground = state.terrain.isSolid(Math.round(at.x), Math.round(at.y));
      c.ring = ringFor(hit ? metresTo(state, c, subjectBox(hit)) : ground ? metresTo(state, c, at) : Infinity);
      sound(state, 'camera-af', c.weaponId);
      break;
    }
    case 'focus':
      if (!c.af) c.ring = clamp(a.ring, 0, 100);
      break;
    case 'pan':
      c.x = clamp(c.x + a.dx, 0, WORLD_W);
      c.y = clamp(c.y + a.dy, 0, WORLD_H);
      break;
    case 'dial': {
      sound(state, 'camera-click', c.weaponId);
      if (c.fn === 'iso') c.iso = clamp(c.iso + a.d, 0, ISOS.length - 1);
      else if (c.fn === 'wb') c.wb = clamp(c.wb + a.d, 0, WHITE_BALANCE.length - 1);
      else {
        // M: the main dial's the shutter, the quick dial the aperture; Tv and Av: both do theirs; P: the camera's.
        const sets = mode === 'M' ? (a.dial === 'main' ? 'sh' : 'ap') : mode === 'Tv' ? 'sh' : mode === 'Av' ? 'ap' : null;
        if (sets === 'sh') c.sh = clamp(c.sh + a.d, 0, SHUTTERS.length - 1);
        if (sets === 'ap') c.ap = clamp(Math.max(c.ap, lens.widest) + a.d, lens.widest, APERTURES.length - 1);
      }
      break;
    }
    case 'shutter':
      shoot(state, c, false);
      break;
  }
}

/** What a dial does right now (for its label). */
export function dialRole(c: Camera, dial: 'main' | 'quick'): string {
  if (c.fn === 'iso') return 'ISO';
  if (c.fn === 'wb') return 'WB';
  const mode = MODES[c.mode]!.id;
  if (mode === 'M') return dial === 'main' ? 'SHUTTER' : 'APERTURE';
  return mode === 'Tv' ? 'SHUTTER' : mode === 'Av' ? 'APERTURE' : 'AUTO';
}

/** The card's done, and waiting for his phone to fire it. */
export function cameraReady(state: GameState): boolean {
  return state.phase === 'shooting' && !!state.camera?.done;
}

/** The best photo on a card (the first, on a tie), or null with none. */
export function bestPhoto(c: Camera): Photo | null {
  let best: Photo | null = null;
  for (const p of c.photos) if (!best || p.damage > best.damage) best = p;
  return best;
}

/** Another phone's Long Exposure, as its previews show it (net/follow.ts): the same viewfinder here. */
export function followCamera(state: GameState, next: Camera): void {
  if (state.phase !== 'shooting' || !state.camera) sound(state, 'camera-up', next.weaponId);
  state.camera = next;
  state.phase = 'shooting';
}

/** Fired (game.ts `fire`, once the card's done): the best photo develops, then its damage lands. */
export function fireCamera(state: GameState, _p: Player, _weapon: WeaponOf<'camera'>): void {
  const c = state.camera;
  if (c) c.outro = 0;
}

/** The best photo developing, then its damage on whoever's in it (and the flash's blinding). */
export const cameraStepper: Stepper = {
  step(state, dt) {
    const c = state.camera;
    if (!c || c.outro === null) return;
    const was = c.outro;
    c.outro += dt;
    if (was < DEVELOP.hit && c.outro >= DEVELOP.hit) {
      const best = bestPhoto(c);
      const target = best?.mark ? targetOf(state, best.mark) : null;
      const me = tankCentre(state.players[c.playerId]!);
      if (!best || !target || best.damage <= 0) {
        spawnFloater(state, me.x, me.y - 30, 'NOTHING IN THE FRAME', '#cfd6ff');
      } else {
        const weapon = weaponOf(c.weaponId, 'camera');
        const at = targetPos(target);
        sound(state, best.perfect ? 'camera-perfect' : 'camera-hit', c.weaponId);
        applyHit(state, target, weapon, c.playerId, scaled(state, c.playerId, best.damage), weapon.colour);
        if (best.perfect) spawnFloater(state, at.x, at.y - TANK_BODY_HEIGHT - 30, 'PERFECT SHOT', '#facc15');
        if (best.flash && target.kind === 'tank') blind(state, target.player, target.tank);
      }
    }
    if (c.outro >= DEVELOP.end) state.camera = null;
  },
  busy: (state) => state.camera !== null && state.camera.outro !== null,
};

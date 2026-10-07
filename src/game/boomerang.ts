import { getCharacter } from '../characters/roster';
import { weaponOf } from '../weapons/registry';
import type { BoomerangSpec, WeaponOf } from '../weapons/types';
import { sound } from './fx';
import type { Stepper } from './mechanics';
import type { Boomerang, GameState, Player } from './state';
import { applyHit, scaled, tankCentre, targetAt, targetKey, targetOwner } from './tanks';

/**
 * kiwicore's béretta M2: his flat cap, thrown like a boomerang. It flies a teardrop loop through anything
 * (terrain doesn't stop it, and it leaves no mark): out from his dome (the barrel's pivot, where every aim
 starts; it's drawn lifting off his head), curling out on one side
 * of the aim line to the far end of the loop (exactly along the aim, as far as the power says), and back
 * home on the other side, slowing as it turns. Each enemy target it passes through is hit once on the way
 * out and once on the way back at most (`hits` is cleared when it turns for home), and he catches it: no
 * harm to him. While it's out he's bare-headed (`wearsCap`).
 */

/** How far above the dome's centre the cap sits when he's wearing it. */
export const CAP_REST = 8;
/** Every throw takes at least this long, however short (s), plus its spec's `flight` per 100 px of reach. */
const MIN_FLIGHT = 0.6;
/** Hit-testing step along the loop (px): fine enough that no tank is skipped. */
const STEP_PX = 1.5;

/** How far a throw at `power` (0–100) reaches along the aim (px). */
export function boomerangReach(spec: BoomerangSpec, power: number): number {
  return spec.minRange + (spec.maxRange - spec.minRange) * (power / 100);
}

/** How long a throw that reaches `range` px takes, out and home (s). */
export function boomerangFlight(spec: BoomerangSpec, range: number): number {
  return MIN_FLIGHT + (spec.flight * range) / 100;
}

/** Where the cap rests on `p`'s dome. */
export function capSpot(p: Player): { x: number; y: number } {
  const c = tankCentre(p);
  return { x: c.x, y: c.y - CAP_REST };
}

/** Whether `p` has a flat cap on (kiwicore, unless it's been thrown and isn't back yet). */
export function wearsCap(state: GameState, p: Player): boolean {
  return getCharacter(p.characterId).hat === 'flat-cap' && !state.boomerangs.some((b) => b.ownerId === p.id);
}

/** Where the boomerang is `s` (0 → 1) of the way round its loop: out along the aim to `range` and back, `curl` × range wide. */
export function boomerangPoint(b: Boomerang, curl: number, s: number): { x: number; y: number } {
  const ux = Math.cos(b.angle);
  const uy = -Math.sin(b.angle);
  const along = b.range * Math.sin(Math.PI * s);
  const across = b.side * curl * b.range * Math.sin(2 * Math.PI * s);
  // Across is to the left of the aim (screen y is down): (uy, −ux).
  return { x: b.x0 + ux * along + uy * across, y: b.y0 + uy * along - ux * across };
}

/** Throw it: from the dome along the aim; power is how far it reaches. */
export function throwBoomerang(state: GameState, p: Player, weapon: WeaponOf<'boomerang'>): void {
  const spec = weapon.boomerang;
  const at = tankCentre(p);
  const angle = (p.angle * Math.PI) / 180;
  const range = boomerangReach(spec, p.power);
  state.boomerangs.push({
    ownerId: p.id,
    weaponId: weapon.id,
    x0: at.x,
    y0: at.y,
    angle,
    range,
    // Out above the aim line (thrown left or right alike), back below it.
    side: Math.cos(angle) >= 0 ? 1 : -1,
    t: 0,
    duration: boomerangFlight(spec, range),
    back: false,
    hits: [],
  });
}

/** Fly on round the loop, hitting what it passes through. Returns true once it's home (caught). */
export function stepBoomerang(state: GameState, b: Boomerang, dt: number): boolean {
  const weapon = weaponOf(b.weaponId, 'boomerang');
  const spec = weapon.boomerang;
  const from = b.t;
  const to = Math.min(b.duration, b.t + dt);
  // Its fastest (leaving and coming home) is π × range × √(1 + 4 curl²) per loop.
  const fastest = (Math.PI * b.range * Math.sqrt(1 + 4 * spec.curl * spec.curl)) / b.duration;
  const n = Math.max(1, Math.ceil((fastest * (to - from)) / STEP_PX));
  for (let i = 1; i <= n; i++) {
    const s = (from + ((to - from) * i) / n) / b.duration;
    if (!b.back && s >= 0.5) {
      b.back = true;
      b.hits = [];
    }
    const pt = boomerangPoint(b, spec.curl, s);
    const target = targetAt(state, pt.x, pt.y);
    if (target && targetOwner(target) !== b.ownerId && !b.hits.includes(targetKey(target))) {
      b.hits.push(targetKey(target));
      applyHit(state, target, weapon, b.ownerId, scaled(state, b.ownerId, spec.damage), weapon.colour);
    }
  }
  b.t = to;
  if (b.t < b.duration) return false;
  sound(state, 'catch', b.weaponId);
  return true;
}

export const boomerangStepper: Stepper = {
  step(state, dt) {
    state.boomerangs = state.boomerangs.filter((b) => !stepBoomerang(state, b, dt));
  },
  busy: (state) => state.boomerangs.length > 0,
};

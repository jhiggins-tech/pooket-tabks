import { randRange } from '../core/rng';
import { COMMS, TYPE_RATE } from '../weapons/comms';
import { weaponOf } from '../weapons/registry';
import type { WeaponOf } from '../weapons/types';
import { TANK_BODY_HEIGHT } from './constants';
import { sound, spawnFloater } from './fx';
import type { Stepper } from './mechanics';
import { settleTanks } from './bodies';
import type { AirStrike, GameState, Player } from './state';
import { applyHit, explode, markFor, scaled, tankCentre, targetAt, targetOf, targetPos } from './tanks';

/**
 * doctorfox's Air Strike, his tier 3: no aiming. A ping of light on the horizon, and three Arwings come in
 * from it over the enemy target nearest him (a decoy counts; a tank hidden by Sly doesn't, as for 007),
 * growing as they close. One of the Star Fox team comes over the comm (weapons/comms.ts, picked at random:
 * drawn by render/draw/comm.ts). They strafe the target with blue lasers, each bolt aimed somewhere across
 * it (`aims`, picked when it's called in) and stopping at the first ground or tank in its way, then the
 * lead ship drops a bomb on it: the weapon's blast. The run follows the target if it moves (a crater
 * under it), and carries on where it was if it's destroyed. The ships hold back on approach while the
 * comm plays, and only make their run once it's over. All on `strikeClock`, in `strikeStepper`.
 */

/**
 * The run's opening (s from FIRE): the ping on the horizon until `ping`; the ships come out of it from
 * `arrive` and are on approach, holding back, by `hold`; the comm switches on at `comm`. The rest waits
 * for the comm to finish (`strikeClock`): it switches on and off in `switch`, types its line out at
 * TYPE_RATE and stays up `read` s once it has; then the ships take `dive` s to dive in, `strafe` s over
 * the target (the first laser `laser` s in, then one every `gap`), drop the bomb, which goes off `bomb`
 * s later, are gone `away` s after the drop, and it's over `end` s after the bomb.
 */
export const STRIKE = { ping: 0.7, arrive: 0.5, hold: 1.5, comm: 1.0, switch: 0.16, read: 1.2, dive: 0.6, strafe: 1.5, laser: 0.1, gap: 0.16, bomb: 0.45, away: 1.0, end: 1.25 } as const;

/** When each part of strike `s` happens (s from FIRE), after its comm. */
export interface StrikeClock {
  commEnd: number;
  dive: number;
  strafe: number;
  drop: number;
  bomb: number;
  away: number;
  end: number;
}

/** Strike `s`'s clock: the run starts once its comm (however long its line is) is over. */
export function strikeClock(s: AirStrike): StrikeClock {
  const line = COMMS[s.pilot]?.line.length ?? 0;
  const commEnd = STRIKE.comm + STRIKE.switch * 2 + line / TYPE_RATE + STRIKE.read;
  const dive = commEnd + 0.1;
  const strafe = dive + STRIKE.dive;
  const drop = strafe + STRIKE.strafe;
  const bomb = drop + STRIKE.bomb;
  return { commEnd, dive, strafe, drop, bomb, away: drop + STRIKE.away, end: bomb + STRIKE.end };
}

/** How high over the target the ships strafe (px above its hull, kept on screen). */
const CRUISE = 170;
/** How far before and after the target the strafing run starts and ends (px). */
const RUN = 150;
/** How far back from the target the ping on the horizon is, and how high (px from the top). */
const HORIZON_BACK = 300;
const HORIZON_Y = 85;
/** The wingmen's places off the lead (px, behind it and above or below; at full size). */
const WINGS = [{ back: 0, up: 0 }, { back: 26, up: 13 }, { back: 26, up: -13 }] as const;
/** How far a bolt can go (px). */
const BOLT_REACH = 900;

/** Where the ping on the horizon is (the ships come out of it). */
export function horizonOf(s: AirStrike): { x: number; y: number } {
  return { x: Math.max(40, Math.min(1060, s.x - s.dir * HORIZON_BACK)), y: HORIZON_Y };
}

/** Where ship `i` (0 the lead, 1 and 2 the wingmen) is at `t`, how big it's drawn (1: full size, far off: smaller), or null before it's in. */
export function shipAt(s: AirStrike, i: number, t: number): { x: number; y: number; scale: number } | null {
  if (t < STRIKE.arrive) return null;
  const c = strikeClock(s);
  const cruiseY = Math.max(36, s.y - CRUISE);
  const start = { x: s.x - s.dir * RUN, y: cruiseY };
  const h = horizonOf(s);
  /** A point `k` of the way from the horizon to the start of the run. */
  const along = (k: number) => ({ x: h.x + (start.x - h.x) * k, y: h.y + (start.y - h.y) * k });
  let at: { x: number; y: number };
  let scale = 1;
  if (t < STRIKE.hold) {
    // Out of the ping on the horizon, onto their approach.
    const k = (t - STRIKE.arrive) / (STRIKE.hold - STRIKE.arrive);
    at = along(0.4 * (1 - (1 - k) ** 2));
    scale = 0.06 + 0.44 * k;
  } else if (t < c.dive) {
    // On approach while the comm plays: closing slowly, bobbing in formation.
    const k = Math.min(1, (t - STRIKE.hold) / Math.max(0.01, c.dive - STRIKE.hold));
    at = along(0.4 + 0.1 * k);
    at.y += Math.sin((t - STRIKE.hold) * 2.4) * 4;
    scale = 0.5 + 0.1 * k;
  } else if (t < c.strafe) {
    // Diving in to the start of the run.
    const k = (t - c.dive) / STRIKE.dive;
    const e = k * k * (3 - 2 * k);
    const from = along(0.5);
    at = { x: from.x + (start.x - from.x) * e, y: from.y + Math.sin((t - STRIKE.hold) * 2.4) * 4 * (1 - e) + (start.y - from.y) * e };
    scale = 0.6 + 0.4 * e;
  } else if (t < c.drop) {
    // The strafing run, across the target.
    const k = (t - c.strafe) / STRIKE.strafe;
    at = { x: start.x + s.dir * 2 * RUN * k, y: cruiseY + Math.sin(k * Math.PI) * 14 };
  } else {
    // Pulling up and away.
    const k = (t - c.drop) / STRIKE.away;
    at = { x: s.x + s.dir * (RUN + 260 * k), y: cruiseY - 300 * k * k };
    scale = 1 + 0.3 * k;
  }
  const { x, y } = at;
  const w = WINGS[i]!;
  return { x: x - s.dir * w.back * scale, y: y - w.up * scale, scale };
}

/** When laser `i` of strike `s` goes off (s from FIRE); ship `i % 3` fires it. */
export function laserTime(s: AirStrike, i: number): number {
  return strikeClock(s).strafe + STRIKE.laser + i * STRIKE.gap;
}

/** Fired: three Arwings called in on the enemy nearest doctorfox (nothing, if there's nobody to see). */
export function fireAirStrike(state: GameState, p: Player, weapon: WeaponOf<'airstrike'>): void {
  const found = markFor(state, p);
  if (!found) {
    const c = tankCentre(p);
    spawnFloater(state, c.x, c.y - 30, 'NO TARGET', '#cfd6ff');
    return;
  }
  const at = targetPos(found.target);
  const spec = weapon.airstrike;
  const pilot = Math.min(COMMS.length - 1, Math.floor(state.rng() * COMMS.length));
  const aims = Array.from({ length: spec.lasers }, () => randRange(state.rng, -spec.spread, spec.spread));
  state.airstrike = { ownerId: p.id, weaponId: weapon.id, mark: found.mark, x: at.x, y: at.y, dir: at.x >= p.x ? 1 : -1, pilot, aims, bolts: [], t: 0, bombed: false };
  sound(state, 'kira', weapon.id);
}

/** Laser `i`: from its ship's nose down through its aim on the target, to the first ground or tank in the way. */
function fireLaser(state: GameState, s: AirStrike, i: number): void {
  const weapon = weaponOf(s.weaponId, 'airstrike');
  const ship = shipAt(s, i % WINGS.length, s.t)!;
  const x1 = ship.x + s.dir * 16;
  const y1 = ship.y + 2;
  const tx = s.x + s.aims[i]!;
  const ty = s.y - TANK_BODY_HEIGHT / 2;
  const len = Math.hypot(tx - x1, ty - y1) || 1;
  const dx = (tx - x1) / len;
  const dy = (ty - y1) / len;
  const { terrain } = state;
  let x = x1;
  let y = y1;
  for (let d = 0; d <= BOLT_REACH; d++) {
    x = x1 + dx * d;
    y = y1 + dy * d;
    if (x < 0 || x >= terrain.width || y >= terrain.height) break;
    if (y < 0) continue;
    const target = targetAt(state, x, y);
    if (target) {
      applyHit(state, target, weapon, s.ownerId, scaled(state, s.ownerId, weapon.airstrike.laserDamage), weapon.colour);
      break;
    }
    if (terrain.isSolid(x, y)) break;
  }
  s.bolts.push({ x1, y1, x2: x, y2: y, t: s.t });
  const r = weapon.airstrike.laserRadius;
  terrain.carveCircle(x, y, r);
  state.fx.explosions.push({ x, y, radius: r, age: 0, duration: 0.3 });
  sound(state, 'laser', weapon.id);
  settleTanks(state);
}

/** Following the target (wherever it's settled to), the lasers on their beats, then the bomb. */
export const strikeStepper: Stepper = {
  step(state, dt) {
    const s = state.airstrike;
    if (!s) return;
    const was = s.t;
    s.t += dt;
    const target = targetOf(state, s.mark);
    if (target) ({ x: s.x, y: s.y } = targetPos(target));
    if (was < STRIKE.arrive && s.t >= STRIKE.arrive) sound(state, 'arwings', s.weaponId);
    if (was < STRIKE.comm && s.t >= STRIKE.comm) sound(state, 'comm', s.weaponId, COMMS[s.pilot]!.line.length);
    s.aims.forEach((_, i) => {
      if (was < laserTime(s, i) && s.t >= laserTime(s, i)) fireLaser(state, s, i);
    });
    const c = strikeClock(s);
    if (was < c.dive && s.t >= c.dive) sound(state, 'arwings', s.weaponId);
    if (!s.bombed && s.t >= c.bomb) {
      s.bombed = true;
      sound(state, 'smart-bomb', s.weaponId);
      explode(state, s.x, s.y - TANK_BODY_HEIGHT / 2, weaponOf(s.weaponId, 'airstrike'), s.ownerId);
    }
    if (s.t >= c.end) state.airstrike = null;
  },
  busy: (state) => state.airstrike !== null,
};

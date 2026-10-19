import { randRange } from '../core/rng';
import { AMMO_PER_TIER } from '../characters/roster';
import { kindOf, weaponOf } from '../weapons/registry';
import { STRATAGEMS, stratagemOf, type Arrow, type StratagemDef } from '../weapons/stratagems';
import type { WeaponOf } from '../weapons/types';
import { GRAVITY, MAX_SPEED, TANK_BODY_HEIGHT, TANK_HALF_WIDTH, TANK_HIT_RADIUS } from './constants';
import { settleTanks, tankCentre } from './bodies';
import { sound, spawnFloater } from './fx';
import { canUseSlot, slotAt, weaponForTier } from './loadout';
import type { Stepper } from './mechanics';
import type { Call, GameState, Player, Projectile, Sentry, StratagemDrop } from './state';
import { allTargets, applyHit, explode, forEachTargetPos, gone, muzzle, scaled, targetAt, targetPos } from './tanks';
import { hash } from './util';

/**
 * ShotDownBoyz's Stratagem, Helldivers style. Each match he gets `offered` of the stratagems in
 * weapons/stratagems.ts (drawn from the seed: `drawStratagems`) and Resupply. FIRE brings up the d-pad
 * (`startCall`: phase `calling`), and he keys a combo (`pressArrow`, ▲▼◀▶ or W A S D): stratagems whose
 * combo no longer fits grey out, an arrow that fits none wipes the input, and the one whose combo is
 * finished is picked. Like 007 (bond.ts) it's this phone's input: his phone runs the clock (`callClock`) and
 * the other phone follows it in the previews (`followCall`). Picked, his phone fires it for real
 * (`fireStratagem`: the round spent, and it re-arms for its `cooldown` of his turns), a beacon thrown along
 * his aim; out of time, it's called off with nothing spent (`cancelCall`).
 *
 * Where the beacon lands (`landBeacon`) its light goes up for `BEACON_TIME`, then (`dropStepper`):
 * - ordnance: the Orbital Laser burns down in pulses, drifting toward an enemy close by; the Railcannon is
 *   one round straight down. Both hurt anyone close, him included.
 * - a turret: a sentry drops (`state.sentries`) and fires each time anyone fires (`fireSentries`, from
 *   game.ts `fire`, like a marathon runner's legs), until its `shots` are gone. Only the Autocannon aims
 *   itself; the rockets go roughly at the enemy and tilt toward one close by; the Tesla zaps every tank in
 *   reach, his too.
 * - a weapon or Resupply: a pod drops (it hurts a tank it lands on) and waits on the ground (`state.crates`)
 *   until he drives into it (`pickUpCrates`): a weapon takes his tier 1's place (its rounds stay); Resupply
 *   is a diesel can in reserve, 3 tier 1 rounds and 1 tier 2 round (not past full).
 */

/** Seconds the beacon's light shows before what it called in arrives. */
export const BEACON_TIME = 1.2;
/** The Orbital Laser: how long it burns, how often it pulses, how far it looks for an enemy and how fast it drifts there (px/s). */
export const LASER_TIME = 2.6;
const LASER_PULSE = 0.15;
const LASER_SEEK = 120;
const LASER_DRIFT = 45;
/** The Railcannon's round lands this long after the beacon's light, and its streak shows for `RAIL_SHOW`. */
const RAIL_SHOW = 0.5;
/** How fast a pod falls (px/s), and how close to it a tank has to drive to pick it up. */
const POD_SPEED = 650;
const CRATE_REACH = TANK_HALF_WIDTH + 6;
/** The Tesla Tower's reach (px from its coil). */
export const TESLA_RANGE = 80;
/** How high a sentry's gun (or coil) is off the ground. */
export const SENTRY_HEIGHT = 14;
/** How far off a Rocket Sentry's launch can be (a fraction of the speed that would land it on them). */
const ROCKET_SLOP = 0.12;

/** Whether tier `tier` is a Stratagem. */
export function isStratagem(p: Player, tier: number): boolean {
  return p.loadout[tier] !== undefined && kindOf(weaponForTier(p, tier)) === 'stratagem';
}

/**
 * The stratagems player `playerId` gets this match: the Stratagem's `offered` of them, shuffled from the
 * seed (hashed, leaving the gameplay RNG alone, as game.ts firstPlayer does), then Resupply.
 */
export function drawStratagems(seed: number, playerId: number, offered = weaponOf('stratagem', 'stratagem').stratagem.offered): string[] {
  const pool = STRATAGEMS.filter((s) => s.category !== 'supply').map((s) => s.id);
  const keyed = pool.map((id, i) => ({ id, k: hash(seed * 0.001 + playerId * 7.31 + i * 1.618) }));
  keyed.sort((a, b) => a.k - b.k || (a.id < b.id ? -1 : 1));
  return [...keyed.slice(0, offered).map((x) => x.id), 'resupply'];
}

/** His stratagems that are ready (not re-arming). */
export function readyStratagems(p: Player): StratagemDef[] {
  return p.stratagems.filter((s) => s.rearm <= 0).map((s) => stratagemOf(s.id));
}

/** The ready stratagems whose combo starts with `input`. */
export function candidates(p: Player, input: string): StratagemDef[] {
  return readyStratagems(p).filter((s) => s.combo.startsWith(input));
}

/** FIRE on Stratagem: the d-pad goes up (the round's spent when the beacon's thrown). */
export function startCall(state: GameState): boolean {
  const p = state.players[state.current]!;
  if (state.phase !== 'aiming' || p.hop || p.flight || !isStratagem(p, p.selectedTier) || !canUseSlot(state, p, p.selectedTier)) return false;
  state.call = { playerId: p.id, weaponId: p.loadout[p.selectedTier]!, input: '', t: 0, wrongAt: null, picked: null, done: false };
  state.phase = 'calling';
  sound(state, 'call');
  return true;
}

/** His phone: the clock runs down, and it's over (nothing picked) when time's up. */
export function callClock(state: GameState, dt: number): void {
  const c = state.call;
  if (state.phase !== 'calling' || !c || c.done) return;
  c.t += dt;
  if (c.t >= weaponOf(c.weaponId, 'stratagem').stratagem.time) c.done = true;
}

/** His phone: one arrow of a combo. One that fits no ready stratagem wipes what's been keyed. */
export function pressArrow(state: GameState, arrow: Arrow): void {
  const c = state.call;
  if (state.phase !== 'calling' || !c || c.done) return;
  const p = state.players[c.playerId]!;
  const next = c.input + arrow;
  const fits = candidates(p, next);
  if (fits.length === 0) {
    c.input = '';
    c.wrongAt = c.t;
    sound(state, 'call-wrong');
    return;
  }
  c.input = next;
  const done = fits.find((s) => s.combo === next);
  if (done) {
    c.picked = done.id;
    c.done = true;
    sound(state, 'call-done');
  } else sound(state, 'call-key');
}

/** A combo's been finished (or time's up), waiting for his phone to fire it (or call it off). */
export function callReady(state: GameState): boolean {
  return state.phase === 'calling' && !!state.call?.done;
}

/** Whole seconds left to key a combo (null: no d-pad up). */
export function callLeft(state: GameState): number | null {
  const c = state.phase === 'calling' ? state.call : null;
  if (!c) return null;
  return Math.max(0, Math.ceil(weaponOf(c.weaponId, 'stratagem').stratagem.time - c.t));
}

/** Out of time with nothing keyed: the d-pad goes, nothing's spent, and he's back to aiming. */
export function cancelCall(state: GameState): void {
  if (state.phase !== 'calling' || state.call?.picked) return;
  const p = state.players[state.call?.playerId ?? state.current]!;
  state.call = null;
  state.phase = 'aiming';
  const c = tankCentre(p);
  spawnFloater(state, c.x, c.y - 24, 'STRATAGEM CANCELLED', '#fca5a5');
  sound(state, 'call-off');
}

/** Another phone's Stratagem, as its previews show it (net/follow.ts): the d-pad here too, or gone. */
export function followCall(state: GameState, next: Call | null): void {
  if (!next) {
    if (state.phase === 'calling') {
      state.call = null;
      state.phase = 'aiming';
    }
    return;
  }
  if (state.phase !== 'calling' || !state.call) sound(state, 'call');
  else if (next.input.length > state.call.input.length) sound(state, next.done ? 'call-done' : 'call-key');
  else if (next.wrongAt !== state.call.wrongAt) sound(state, 'call-wrong');
  state.call = next;
  state.phase = 'calling';
}

/** Fired (game.ts `fire`, once a combo's finished): it starts re-arming, and the beacon's thrown along his aim. */
export function fireStratagem(state: GameState, p: Player, _weapon: WeaponOf<'stratagem'>): void {
  const id = state.call?.picked;
  state.call = null;
  if (!id) return;
  const def = stratagemOf(id);
  const slot = p.stratagems.find((s) => s.id === id);
  // (Re-arming counts down as each of his turns starts: +1 so it's out for `cooldown` whole turns.)
  if (slot) slot.rearm = def.cooldown + 1;
  const speed = (p.power / 100) * MAX_SPEED;
  const m = muzzle(p);
  const a = (p.angle * Math.PI) / 180;
  state.projectiles.push({ x: m.x, y: m.y, vx: Math.cos(a) * speed, vy: -Math.sin(a) * speed, weaponId: 'stratagem-beacon', ownerId: p.id, trail: [], bounces: 0, age: 0, walkDir: 0, walkTime: 0, stratagem: id });
  const c = tankCentre(p);
  spawnFloater(state, c.x, c.y - 24, def.name.toUpperCase(), '#fde047');
}

/** A beacon's down (projectiles.ts): its light goes up where it landed, and what it called in is on its way. */
export function landBeacon(state: GameState, pr: Projectile, x: number, y: number): void {
  const cx = Math.max(2, Math.min(state.terrain.width - 2, x));
  state.drops.push({ ownerId: pr.ownerId, stratagem: pr.stratagem!, x: cx, y: Math.min(y, state.terrain.height), t: 0, beamX: cx, beamY: Math.min(y, state.terrain.height), pulses: 0, podY: null, done: false });
  sound(state, 'beacon');
}

/** Straight down from the top of the sky at x: the first ground it meets, or the middle of the first tank (or decoy). */
function downAt(state: GameState, x: number): number {
  const { terrain } = state;
  for (let y = 0; y < terrain.height; y++) {
    const t = targetAt(state, x, y);
    if (t) return targetPos(t).y - TANK_BODY_HEIGHT;
    if (terrain.isSolid(x, y)) return y;
  }
  return terrain.height;
}

/** Every stratagem coming down: the light, then the strike or the pod. */
export const dropStepper: Stepper = {
  step(state, dt) {
    for (const d of state.drops) stepDrop(state, d, dt);
    state.drops = state.drops.filter((d) => !d.done);
    pickUpCrates(state);
  },
  busy: (state) => state.drops.length > 0,
};

function stepDrop(state: GameState, d: StratagemDrop, dt: number): void {
  const was = d.t;
  d.t += dt;
  if (d.t < BEACON_TIME) return;
  const def = stratagemOf(d.stratagem);
  if (def.category === 'ordnance' && def.strike === 'railcannon') {
    if (was < BEACON_TIME) {
      const y = downAt(state, d.x);
      state.beams.push({ x1: d.x, y1: 0, x2: d.x, y2: y, colour: '#e0f2fe', hitTank: true, age: 0, duration: RAIL_SHOW });
      sound(state, 'railcannon');
      explode(state, d.x, y, weaponOf('railcannon', 'ballistic'), d.ownerId);
    }
    if (d.t >= BEACON_TIME + RAIL_SHOW) d.done = true;
    return;
  }
  if (def.category === 'ordnance') {
    if (was < BEACON_TIME) sound(state, 'orbital-laser');
    stepLaser(state, d, dt);
    if (d.t >= BEACON_TIME + LASER_TIME) d.done = true;
    return;
  }
  // A pod: it falls from the top of the sky, and lands where the ground is.
  d.podY = (d.podY ?? -30) + POD_SPEED * dt;
  const ground = state.terrain.surfaceY(d.x);
  if (d.podY < ground) return;
  d.podY = ground;
  d.done = true;
  sound(state, 'pod');
  if (def.category === 'turret') {
    state.sentries.push({ id: state.nextId++, ownerId: d.ownerId, stratagem: def.id, x: d.x, y: ground, shots: def.shots, aim: 90, age: 0 });
    sound(state, 'sentry-up');
    return;
  }
  // A weapon or Resupply pod: it hurts any tank it comes down on, then waits to be driven into.
  const pod = weaponOf('supply-pod', 'ballistic');
  const spec = weaponOf('stratagem', 'stratagem').stratagem;
  for (const t of allTargets(state)) {
    const at = targetPos(t);
    if (Math.abs(at.x - d.x) <= TANK_HALF_WIDTH + 4 && Math.abs(at.y - ground) <= TANK_BODY_HEIGHT + 6) applyHit(state, t, pod, d.ownerId, spec.podDamage);
  }
  state.crates.push({ id: state.nextId++, ownerId: d.ownerId, stratagem: def.id, x: d.x, y: ground });
}

/** The Orbital Laser: drift toward the nearest enemy close by, and burn a pulse where the beam meets something. */
function stepLaser(state: GameState, d: StratagemDrop, dt: number): void {
  let goal: number | null = null;
  forEachTargetPos(state, (x, _y, owner) => {
    if (owner === d.ownerId || Math.abs(x - d.beamX) > LASER_SEEK) return;
    if (goal === null || Math.abs(x - d.beamX) < Math.abs(goal - d.beamX)) goal = x;
  }, true);
  if (goal !== null) {
    const step = LASER_DRIFT * dt;
    d.beamX += Math.max(-step, Math.min(step, goal - d.beamX));
  }
  const due = Math.min(Math.floor(LASER_TIME / LASER_PULSE), Math.floor((d.t - BEACON_TIME) / LASER_PULSE) + 1);
  const laser = weaponOf('orbital-laser', 'ballistic');
  while (d.pulses < due) {
    d.pulses++;
    d.beamY = downAt(state, d.beamX);
    burn(state, d.beamX, d.beamY, laser, d.ownerId);
  }
}

/** One pulse of the laser: a little hole, and its damage to every target it reaches (no fireball, no boom). */
function burn(state: GameState, x: number, y: number, weapon: WeaponOf<'ballistic'>, ownerId: number): void {
  state.terrain.carveCircle(x, y, weapon.blastRadius);
  const reach = weapon.blastRadius + TANK_HIT_RADIUS;
  for (const t of allTargets(state)) {
    if (gone(t)) continue;
    const at = targetPos(t);
    if (Math.hypot(at.x - x, at.y - TANK_BODY_HEIGHT - y) < reach) applyHit(state, t, weapon, ownerId, scaled(state, ownerId, weapon.damage), weapon.colour);
  }
  settleTanks(state);
}

/** Every sentry fires (each time anyone fires: game.ts `fire`), and one out of rounds packs up. */
export function fireSentries(state: GameState): void {
  for (const s of state.sentries) {
    const owner = state.players[s.ownerId];
    if (!owner?.alive || s.shots <= 0) continue;
    if (fireSentry(state, s)) s.shots--;
    if (s.shots <= 0) spawnFloater(state, s.x, s.y - 24, 'SENTRY OFFLINE', '#cbd5e1');
  }
  state.sentries = state.sentries.filter((s) => s.shots > 0 && state.players[s.ownerId]?.alive);
}

/** One sentry's turn: returns whether it fired (nobody to fire at, and it waits). */
function fireSentry(state: GameState, s: Sentry): boolean {
  const def = stratagemOf(s.stratagem);
  if (def.category !== 'turret') return false;
  const gunY = s.y - SENTRY_HEIGHT;
  if (def.sentry === 'tesla') {
    const zap = weaponOf('tesla-zap', 'ballistic');
    let any = false;
    for (const t of allTargets(state)) {
      if (gone(t)) continue;
      const at = targetPos(t);
      if (Math.hypot(at.x - s.x, at.y - TANK_BODY_HEIGHT / 2 - gunY) > TESLA_RANGE) continue;
      any = true;
      state.beams.push({ x1: s.x, y1: gunY, x2: at.x, y2: at.y - TANK_BODY_HEIGHT / 2, colour: zap.colour ?? '#7dd3fc', hitTank: true, age: 0, duration: 0.45 });
      applyHit(state, t, zap, s.ownerId, scaled(state, s.ownerId, zap.damage), zap.colour);
    }
    sound(state, 'zap');
    if (!any) state.beams.push({ x1: s.x, y1: gunY, x2: s.x, y2: gunY - 18, colour: zap.colour ?? '#7dd3fc', hitTank: false, age: 0, duration: 0.3 });
    return true;
  }
  const mark = nearestEnemy(state, s.x, gunY, s.ownerId);
  if (!mark) return false;
  const rocket = def.sentry === 'rocket';
  const weaponId = rocket ? 'sentry-rocket' : 'autocannon-shell';
  const v = launchAt(s.x, gunY, mark.x, mark.y, rocket ? [60, 70, 80] : [35, 50, 65]);
  if (!v) return false;
  // The rockets go roughly their way (their homing does the rest); the autocannon's spot on.
  const k = rocket ? 1 + randRange(state.rng, -ROCKET_SLOP, ROCKET_SLOP) : 1;
  s.aim = (Math.atan2(-v.vy, v.vx) * 180) / Math.PI;
  state.projectiles.push({ x: s.x, y: gunY, vx: v.vx * k, vy: v.vy * k, weaponId, ownerId: s.ownerId, trail: [], bounces: 0, age: 0, walkDir: 0, walkTime: 0 });
  sound(state, rocket ? 'sentry-rocket' : 'sentry-shell', weaponId);
  return true;
}

/** The enemy target (that can be seen) nearest (x, y): where its hull's middle is. */
function nearestEnemy(state: GameState, x: number, y: number, ownerId: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  forEachTargetPos(state, (tx, ty, owner) => {
    if (owner === ownerId) return;
    const d = Math.hypot(tx - x, ty - y);
    if (d < bestD) [best, bestD] = [{ x: tx, y: ty - TANK_BODY_HEIGHT / 2 }, d];
  }, true);
  return best;
}

/**
 * The launch velocity that lands a shell from (x0, y0) on (x1, y1) under gravity, at the first of `angles`
 * (degrees of elevation) that can reach it at no more than full power. Null: none can.
 */
export function launchAt(x0: number, y0: number, x1: number, y1: number, angles: number[]): { vx: number; vy: number } | null {
  const dx = Math.abs(x1 - x0);
  const rise = y0 - y1; // (up is positive)
  const side = x1 >= x0 ? 1 : -1;
  for (const deg of angles) {
    const a = (deg * Math.PI) / 180;
    const denom = 2 * Math.cos(a) ** 2 * (dx * Math.tan(a) - rise);
    if (denom <= 0) continue;
    const speed = Math.sqrt((GRAVITY * dx * dx) / denom);
    if (!Number.isFinite(speed) || speed > MAX_SPEED * 1.2) continue;
    return { vx: side * Math.cos(a) * speed, vy: -Math.sin(a) * speed };
  }
  return null;
}

/** Sentries unfold as they land (cosmetic clock), and wait between turns. */
export const sentryStepper: Stepper = {
  step(state, dt) {
    for (const s of state.sentries) s.age += dt;
  },
  busy: () => false,
};

/** Pods on the ground that their owner's tank has driven into (or come down beside): picked up. */
export function pickUpCrates(state: GameState): void {
  if (state.crates.length === 0) return;
  state.crates = state.crates.filter((c) => {
    const p = state.players[c.ownerId];
    if (!p?.alive || Math.abs(p.x - c.x) > CRATE_REACH || Math.abs(p.y - c.y) > TANK_BODY_HEIGHT + 8) return true;
    pickUp(state, p, stratagemOf(c.stratagem));
    return false;
  });
}

function pickUp(state: GameState, p: Player, def: StratagemDef): void {
  const c = tankCentre(p);
  sound(state, 'pickup');
  if (def.category === 'weapon') {
    p.loadout[0] = def.weaponId;
    spawnFloater(state, c.x, c.y - 24, `${def.name.toUpperCase()}!`, '#93c5fd');
    return;
  }
  // Resupply: a jerry can in reserve, and rounds for the first two tiers, never past full.
  p.dieselCans++;
  for (const [tier, n] of [[0, 3], [1, 1]] as const) p.ammo[tier] = Math.min(AMMO_PER_TIER[tier] ?? 0, (p.ammo[tier] ?? 0) + n);
  spawnFloater(state, c.x, c.y - 24, 'RESUPPLIED! +DIESEL', '#86efac');
}

/**
 * His turn's starting: each stratagem's a turn nearer re-armed. (If that leaves him nothing he can fire
 * at all, with only Stratagem rounds left and every one re-arming, the soonest is ready now: a turn
 * mustn't get stuck.)
 */
export function rearmStratagems(state: GameState, p: Player): void {
  for (const s of p.stratagems) s.rearm = Math.max(0, s.rearm - 1);
  const turnEnder = (tier: number) => slotAt(p, tier) === 'shot' || slotAt(p, tier) === 'free';
  const stuck = p.alive && p.loadout.some((_, tier) => turnEnder(tier) && (p.ammo[tier] ?? 0) > 0) && !p.loadout.some((_, tier) => turnEnder(tier) && canUseSlot(state, p, tier));
  if (!stuck || p.stratagems.length === 0) return;
  const soonest = p.stratagems.reduce((a, b) => (b.rearm < a.rearm ? b : a));
  soonest.rearm = 0;
}

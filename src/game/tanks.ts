import type { WeaponDef } from '../weapons/types';
import { BARREL_LENGTH, TANK_BODY_HEIGHT, TANK_HIT_RADIUS } from './constants';
import { sound, spawnFloater } from './fx';
import type { Stepper } from './mechanics';
import { settleTanks } from './movement';
import { noteScamHit } from './scam';
import type { GameState, Hologram, Player, TankBody } from './state';
import { afflict, scaled, vulnerable } from './statuses';

/**
 * Tanks and targets: where a tank is, what a shot at (x, y) hits (a player's tank, or a hologram), and
 * damage (blasts, soak, toxin, burns, cooking, tattoos). A player's tanks are the player itself (the main
 * tank) and, with Twins, `player.twin`: both are `TankBody`s and take damage the same way (`hurt`).
 */

/** Something a shot can hit: one of a player's tanks (`tank === player` for the main one), or a hologram. */
export type Target = { kind: 'tank'; player: Player; tank: TankBody } | { kind: 'hologram'; holo: Hologram };

const SOAK_FLUSH_INTERVAL = 0.18; // s between batched stream-damage numbers

export function currentPlayer(state: GameState): Player {
  return state.players[state.current]!;
}

export function tankCentre(p: Player): { x: number; y: number } {
  return { x: p.x, y: p.y - TANK_BODY_HEIGHT };
}

export function muzzle(p: Player): { x: number; y: number } {
  const c = tankCentre(p);
  const a = (p.angle * Math.PI) / 180;
  return { x: c.x + Math.cos(a) * BARREL_LENGTH, y: c.y - Math.sin(a) * BARREL_LENGTH };
}

// (How hard a player hits, for the mechanics that work it out: statuses.ts.)
export { offence, scaled } from './statuses';

/** Apply soaked-up stream damage in small batches so the numbers trickle rather than spam. */
export function stepSoak(state: GameState, dt: number, final: boolean): void {
  state.soakTimer += dt;
  if (!final && state.soakTimer < SOAK_FLUSH_INTERVAL) return;
  state.soakTimer = 0;
  const flush = (t: { soak: number }): number => {
    const whole = final ? Math.round(t.soak) : Math.floor(t.soak);
    t.soak = final ? 0 : t.soak - whole;
    return whole;
  };
  for (const p of state.players) {
    const tw = p.twin;
    for (const tank of tw ? [p, tw] : [p]) {
      const whole = flush(tank);
      if (whole > 0) hurt(state, p, tank, whole, tank.soakColour);
    }
  }
  for (const h of state.holograms) {
    const whole = flush(h);
    if (whole > 0) damageTarget(state, { kind: 'hologram', holo: h }, whole, h.soakColour);
  }
}

/** The tank (main or twin) or hologram whose hit circle contains (x, y). */
export function targetAt(state: GameState, x: number, y: number): Target | undefined {
  // The hottest path in the game (every projectile, droplet and blob of mud, every ~1px): no allocations
  // unless something is hit. Same order as allTargets: main tanks, then twins, then holograms.
  for (const player of state.players) if (player.alive && overHull(x, y, player)) return { kind: 'tank', player, tank: player };
  for (const player of state.players) if (player.alive && player.twin && overHull(x, y, player.twin)) return { kind: 'tank', player, tank: player.twin };
  for (const holo of state.holograms) if (state.players[holo.ownerId]?.alive && overHull(x, y, holo)) return { kind: 'hologram', holo };
  return undefined;
}

/** Is (x, y) within hit range of a hull resting at `at`? */
function overHull(x: number, y: number, at: { x: number; y: number }): boolean {
  const dx = x - at.x;
  const dy = y - (at.y - TANK_BODY_HEIGHT);
  return dx * dx + dy * dy <= TANK_HIT_RADIUS * TANK_HIT_RADIUS;
}

/** Where a target's hull rests (x centre, y = ground contact). */
export function targetPos(t: Target): { x: number; y: number } {
  return t.kind === 'tank' ? t.tank : t.holo;
}

/** Whether a tank is still on the field as its player's (not destroyed, nor a main tank the twin has taken over from). */
function onField(p: Player, tank: TankBody): boolean {
  return p.alive && (tank === p || tank === p.twin);
}

/** A target that has left the field since the target list was taken (dead, or a twin promoted/destroyed). */
export function gone(t: Target): boolean {
  return t.kind === 'tank' && !onField(t.player, t.tank);
}

/** Is it a player's second tank (their twin)? */
export function isTwin(t: Target): boolean {
  return t.kind === 'tank' && t.tank !== t.player;
}

export function targetOwner(t: Target): number {
  return t.kind === 'hologram' ? t.holo.ownerId : t.player.id;
}

export function targetKey(t: Target): string {
  return t.kind === 'hologram' ? `h${t.holo.id}` : `${isTwin(t) ? 't' : 'p'}${t.player.id}`;
}

export function allTargets(state: GameState): Target[] {
  const alive = state.players.filter((p) => p.alive);
  return [
    ...alive.map((player): Target => ({ kind: 'tank', player, tank: player })),
    ...alive.filter((p) => p.twin).map((player): Target => ({ kind: 'tank', player, tank: player.twin! })),
    ...state.holograms.filter((h) => state.players[h.ownerId]?.alive).map((holo): Target => ({ kind: 'hologram', holo })),
  ];
}

/** Every living tank body on the field (real tanks and twins), for collisions and spacing. */
export function tankBodies(state: GameState): { x: number; y: number; owner: Player; twin: boolean }[] {
  const out: { x: number; y: number; owner: Player; twin: boolean }[] = [];
  for (const p of state.players) {
    if (!p.alive) continue;
    out.push({ x: p.x, y: p.y, owner: p, twin: false });
    if (p.twin) out.push({ x: p.twin.x, y: p.twin.y, owner: p, twin: true });
  }
  return out;
}

/** Add damage-over-time "soak" (water, mud, sludge) to any kind of target. */
export function soakTarget(t: Target, amount: number, colour: string): void {
  const body = t.kind === 'tank' ? t.tank : t.holo;
  body.soak += amount;
  body.soakColour = colour;
}

/** A dose of toxin: a tank drains it into damage at `rate` per second; a hologram just soaks it up. */
export function doseTarget(t: Target, amount: number, rate: number, colour: string): void {
  if (t.kind === 'hologram') return soakTarget(t, amount, colour);
  t.tank.toxin += amount;
  t.tank.toxinRate = rate;
  t.tank.soakColour = colour;
}

/**
 * A hit from any weapon, by any mechanic (they all come through here): the damage (already scaled by the
 * shooter's offence), whatever the weapon's effect flags leave on a tank (statuses.ts), and a refund-on-miss
 * round knows it's hit someone. Returns whether the target is still standing as itself.
 */
export function applyHit(state: GameState, t: Target, weapon: WeaponDef, shooterId: number, amount: number, colour?: string): boolean {
  if (weapon.friendlyFire === false && targetOwner(t) === shooterId) return !gone(t);
  noteHit(state, t, shooterId);
  const standing = damageTarget(state, t, amount, colour);
  if (t.kind === 'tank') afflict(state, t.player, t.tank, weapon, shooterId, standing);
  return standing;
}

/** A shot has touched an enemy (or their decoy): its refund-on-miss round isn't coming back. */
export function noteHit(state: GameState, t: Target, shooterId: number): void {
  if (state.refund?.playerId === shooterId && targetOwner(t) !== shooterId) state.refund.hit = true;
}

/**
 * A player's tanks take the damage. Holograms put on a show (same floating number) and are marked as hit:
 * they blow up (copies.ts). Returns whether the target is still there afterwards, as itself (not
 * destroyed, nor a main tank whose twin has taken over).
 */
export function damageTarget(state: GameState, t: Target, amount: number, colour = '#ffffff'): boolean {
  if (t.kind === 'tank') return amount <= 0 ? !gone(t) : hurt(state, t.player, t.tank, amount, colour);
  if (amount <= 0) return true;
  // A decoy of a tattooed tank shows the same boosted number, so it gives nothing away.
  const shown = vulnerable(state.players[t.holo.ownerId]!, amount);
  t.holo.hit = true;
  spawnFloater(state, t.holo.x, t.holo.y - TANK_BODY_HEIGHT, `-${shown}`, colour);
  return false; // it'll blow up
}

export function explode(state: GameState, x: number, y: number, weapon: WeaponDef, ownerId?: number): void {
  const r = weapon.blastRadius;
  state.terrain.carveCircle(x, y, r);
  state.explosions.push({ x, y, radius: r, age: 0, duration: r < 15 ? 0.35 : 0.5 });
  sound(state, 'boom', weapon.id, r);

  const shooterId = ownerId ?? currentPlayer(state).id;
  for (const t of allTargets(state)) {
    if (gone(t)) continue; // e.g. a twin promoted by this very blast
    const pos = targetPos(t);
    const reach = r + TANK_HIT_RADIUS;
    const d = Math.hypot(pos.x - x, pos.y - TANK_BODY_HEIGHT - y);
    if (d >= reach) continue;
    applyHit(state, t, weapon, shooterId, scaled(state, shooterId, weapon.damage * (1 - d / reach)));
  }
  // Any blast knocks out a marathon runner caught in it ("did not finish").
  for (const rn of state.runners) {
    if (rn.out || Math.hypot(rn.x - x, rn.y - 6 - y) >= r + 6) continue;
    rn.out = true;
    spawnFloater(state, rn.x, rn.y - 20, 'DNF', '#f472b6');
    sound(state, 'dnf');
  }
  settleTanks(state);
}

/** Damage to a player's main tank. */
export function damagePlayer(state: GameState, p: Player, amount: number, colour = '#ffffff'): void {
  hurt(state, p, p, amount, colour);
}

/**
 * Damage to one of a player's tanks: every source of damage to a tank ends up here, so it always gets a
 * floating number. A destroyed twin is gone; a destroyed main tank hands over to the twin, if there is
 * one; otherwise the player is out. Returns whether the tank is still there, as itself.
 */
export function hurt(state: GameState, p: Player, tank: TankBody, amount: number, colour = '#ffffff'): boolean {
  if (!onField(p, tank)) return false;
  if (amount <= 0) return true;
  amount = vulnerable(p, amount);
  noteScamHit(state, p);
  tank.hp = Math.max(0, tank.hp - amount);
  spawnFloater(state, tank.x, tank.y - TANK_BODY_HEIGHT, `-${amount}`, colour);
  sound(state, 'hit', undefined, amount);
  if (tank.hp > 0) return true;
  if (tank === p && !p.twin) {
    p.alive = false;
    return false;
  }
  state.explosions.push({ x: tank.x, y: tank.y - TANK_BODY_HEIGHT, radius: 22, age: 0, duration: 0.5 });
  if (tank === p) Object.assign(p, tankBody(p.twin!)); // the twin carries on as the player's tank
  p.twin = null;
  return false;
}

/** A tank's own things (where it is, health, burn, soak, toxin): what a twin hands over when it takes over. */
function tankBody(t: TankBody): TankBody {
  return { x: t.x, y: t.y, hp: t.hp, burn: t.burn, soak: t.soak, soakColour: t.soakColour, toxin: t.toxin, toxinRate: t.toxinRate };
}

/** Burns tick as their player's turn comes up: the main tank's, then the twin's. */
export function tickBurn(state: GameState, p: Player): void {
  const tw = p.twin;
  for (const tank of tw ? [p, tw] : [p]) {
    const b = tank.burn;
    if (!b) continue;
    b.turnsLeft--;
    if (b.turnsLeft <= 0) tank.burn = null;
    hurt(state, p, tank, b.damagePerTurn, b.colour);
  }
}

/** Soaked-up damage, shown in small batches as it builds (the last batch is flushed when the turn settles). */
export const soakStepper: Stepper = {
  step: (state, dt) => stepSoak(state, dt, false),
  busy: () => false,
};

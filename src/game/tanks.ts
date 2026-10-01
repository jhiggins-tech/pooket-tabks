import type { WeaponDef } from '../weapons/types';
import { BARREL_LENGTH, TANK_BODY_HEIGHT, TANK_HIT_RADIUS } from './constants';
import { sound, spawnFloater } from './fx';
import type { Stepper } from './mechanics';
import { settleTanks } from './movement';
import { noteScamHit } from './scam';
import type { Burn, GameState, Hologram, Player } from './state';

/** Tanks and targets: where a tank is, what a shot at (x, y) hits (tank, twin or hologram), and damage (blasts, soak, burns, cooking, tattoos). */

/** Something a shot can hit: a real tank or a hologram of one. */
export type Target =
  | { kind: 'player'; player: Player }
  | { kind: 'hologram'; holo: Hologram }
  | { kind: 'twin'; player: Player };

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

/** Damage multiplier for everything a player fires: halved (etc.) while they're cooked. */
export function offence(state: GameState, playerId: number): number {
  const c = state.players[playerId]?.cooked;
  return c?.active ? c.multiplier : 1;
}

/** Scale a hit by the shooter's offence and round it (a real hit never rounds down to 0). */
export function scaled(state: GameState, shooterId: number, amount: number): number {
  if (Math.round(amount) <= 0) return 0;
  return Math.max(1, Math.round(amount * offence(state, shooterId)));
}

/** Apply soaked-up stream damage in small batches so the numbers trickle rather than spam. */
export function stepSoak(state: GameState, dt: number, final: boolean): void {
  state.soakTimer += dt;
  if (!final && state.soakTimer < SOAK_FLUSH_INTERVAL) return;
  state.soakTimer = 0;
  for (const p of state.players) {
    const whole = final ? Math.round(p.soak) : Math.floor(p.soak);
    if (whole > 0) damagePlayer(state, p, whole, p.soakColour);
    p.soak = final ? 0 : p.soak - whole;
  }
  for (const h of state.holograms) {
    const whole = final ? Math.round(h.soak) : Math.floor(h.soak);
    if (whole > 0) damageTarget(state, { kind: 'hologram', holo: h }, whole, h.soakColour);
    h.soak = final ? 0 : h.soak - whole;
  }
  for (const p of state.players) {
    const tw = p.twin;
    if (!tw) continue;
    const whole = final ? Math.round(tw.soak) : Math.floor(tw.soak);
    tw.soak = final ? 0 : tw.soak - whole;
    if (whole > 0) damageTwin(state, p, whole, tw.soakColour);
  }
}

/** The real tank, twin or hologram whose hit circle contains (x, y). */
export function targetAt(state: GameState, x: number, y: number): Target | undefined {
  // The hottest path in the game (every projectile, droplet and blob of mud, every ~1px): no allocations
  // unless something is hit. Same order as allTargets: tanks, then twins, then holograms.
  for (const player of state.players) if (player.alive && overHull(x, y, player)) return { kind: 'player', player };
  for (const player of state.players) if (player.alive && player.twin && overHull(x, y, player.twin)) return { kind: 'twin', player };
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
  return t.kind === 'player' ? t.player : t.kind === 'twin' ? t.player.twin! : t.holo;
}

/** A target that has left the field since the target list was taken (dead, or a twin promoted/destroyed). */
export function gone(t: Target): boolean {
  return t.kind === 'hologram' ? false : !t.player.alive || (t.kind === 'twin' && !t.player.twin);
}

export function targetOwner(t: Target): number {
  return t.kind === 'hologram' ? t.holo.ownerId : t.player.id;
}

export function targetKey(t: Target): string {
  return t.kind === 'player' ? `p${t.player.id}` : t.kind === 'twin' ? `t${t.player.id}` : `h${t.holo.id}`;
}

export function allTargets(state: GameState): Target[] {
  const alive = state.players.filter((p) => p.alive);
  return [
    ...alive.map((player): Target => ({ kind: 'player', player })),
    ...alive.filter((p) => p.twin).map((player): Target => ({ kind: 'twin', player })),
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
  if (t.kind === 'player') {
    t.player.soak += amount;
    t.player.soakColour = colour;
  } else if (t.kind === 'twin') {
    t.player.twin!.soak += amount;
    t.player.twin!.soakColour = colour;
  } else {
    t.holo.soak += amount;
    t.holo.soakColour = colour;
  }
}

/**
 * Real tanks and twins take the damage. Holograms put on a show (same floating number) and are marked
 * as hit: they blow up (copies.ts).
 */
export function damageTarget(state: GameState, t: Target, amount: number, colour = '#ffffff'): void {
  if (amount <= 0) return;
  if (t.kind === 'player') {
    damagePlayer(state, t.player, amount, colour);
  } else if (t.kind === 'twin') {
    damageTwin(state, t.player, amount, colour);
  } else {
    // A decoy of a tattooed tank shows the same boosted number, so it gives nothing away.
    const shown = vulnerable(state.players[t.holo.ownerId]!, amount);
    t.holo.hit = true;
    spawnFloater(state, t.holo.x, t.holo.y - TANK_BODY_HEIGHT, `-${shown}`, colour);
  }
}

function damageTwin(state: GameState, p: Player, amount: number, colour: string): void {
  const tw = p.twin;
  if (!tw || amount <= 0) return;
  amount = vulnerable(p, amount);
  noteScamHit(state, p);
  tw.hp = Math.max(0, tw.hp - amount);
  spawnFloater(state, tw.x, tw.y - TANK_BODY_HEIGHT, `-${amount}`, colour);
  if (tw.hp === 0) {
    state.explosions.push({ x: tw.x, y: tw.y - TANK_BODY_HEIGHT, radius: 22, age: 0, duration: 0.5 });
    p.twin = null;
  }
}

export function explode(state: GameState, x: number, y: number, weapon: WeaponDef, ownerId?: number): void {
  const r = weapon.blastRadius;
  state.terrain.carveCircle(x, y, r);
  state.explosions.push({ x, y, radius: r, age: 0, duration: r < 15 ? 0.35 : 0.5 });
  sound(state, 'boom', weapon.id, r);

  const shooterId = ownerId ?? currentPlayer(state).id;
  for (const t of allTargets(state)) {
    if (gone(t)) continue; // e.g. a twin promoted by this very blast
    if (weapon.friendlyFire === false && targetOwner(t) === shooterId) continue;
    const pos = targetPos(t);
    const reach = r + TANK_HIT_RADIUS;
    const d = Math.hypot(pos.x - x, pos.y - TANK_BODY_HEIGHT - y);
    if (d >= reach) continue;
    damageTarget(state, t, scaled(state, shooterId, weapon.damage * (1 - d / reach)));
    if (weapon.debuff && t.kind !== 'hologram' && t.player.alive) cook(state, t.player, weapon.debuff.offenceMultiplier, targetPos(t));
    if (weapon.tattoo && t.kind !== 'hologram' && t.player.alive) {
      if (!t.player.tattoo) {
        const c = targetPos(t);
        spawnFloater(state, c.x, c.y - TANK_BODY_HEIGHT - 10, 'TATTOOED', '#b8c4ff');
        sound(state, 'tattoo');
      }
      t.player.tattoo = { multiplier: weapon.tattoo.multiplier, turnsLeft: weapon.tattoo.turns };
    }
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

/** The Rizzler's debuff: halves (etc.) everything this player fires on their next turn. */
function cook(state: GameState, p: Player, multiplier: number, at: { x: number; y: number }): void {
  p.cooked = { active: false, multiplier };
  spawnFloater(state, at.x, at.y - TANK_BODY_HEIGHT - 10, 'COOKED', '#ff9f43');
  sound(state, 'cook');
}

/** Every source of damage goes through here so it always gets a floating number. */
/** Tattooed tanks take extra damage from everything. */
function vulnerable(p: Player, amount: number): number {
  return p.tattoo ? Math.round(amount * p.tattoo.multiplier) : amount;
}

export function damagePlayer(state: GameState, p: Player, amount: number, colour = '#ffffff'): void {
  if (amount <= 0 || !p.alive) return;
  amount = vulnerable(p, amount);
  noteScamHit(state, p);
  p.hp = Math.max(0, p.hp - amount);
  const c = tankCentre(p);
  spawnFloater(state, c.x, c.y, `-${amount}`, colour);
  sound(state, 'hit', undefined, amount);
  if (p.hp > 0) return;
  if (p.twin) {
    // The main tank is destroyed, but the twin carries on as the player's tank.
    state.explosions.push({ x: c.x, y: c.y, radius: 22, age: 0, duration: 0.5 });
    const tw = p.twin;
    p.x = tw.x;
    p.y = tw.y;
    p.hp = tw.hp;
    p.soak += tw.soak;
    p.burn = tw.burn; // the main tank's burn went with it; the twin's carries on
    p.twin = null;
    return;
  }
  p.alive = false;
}

/** Burns tick as their player's turn comes up: the main tank's, then the twin's. */
export function tickBurn(state: GameState, p: Player): void {
  const tick = (tank: { burn: Burn | null }): Burn | null => {
    const b = tank.burn;
    if (!b) return null;
    b.turnsLeft--;
    if (b.turnsLeft <= 0) tank.burn = null;
    return b;
  };
  const main = tick(p);
  if (main) damagePlayer(state, p, main.damagePerTurn, main.colour);
  const tw = p.twin;
  const twin = tw && tick(tw);
  if (twin) damageTwin(state, p, twin.damagePerTurn, twin.colour);
}

/** Soaked-up damage, shown in small batches as it builds (the last batch is flushed when the turn settles). */
export const soakStepper: Stepper = {
  step: (state, dt) => stepSoak(state, dt, false),
  busy: () => false,
};

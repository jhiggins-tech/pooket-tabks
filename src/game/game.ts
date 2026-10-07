import { AMMO_PER_TIER, getCharacter } from '../characters/roster';
import { createRng, randRange } from '../core/rng';
import { Terrain } from '../core/terrain';
import { flattenAround, generateHeights } from '../core/terrainGen';
import { ignoresAim, kindOf } from '../weapons/registry';
import { isShotKind, type ShotKind } from '../weapons/kinds';
import type { WeaponOf } from '../weapons/types';
import { FUEL_PER_MATCH, MAX_HP, TANK_HALF_WIDTH, WORLD_H, WORLD_W } from './constants';
import { settleTurn, tankBody } from './bodies';
import { coffeeDone, finishCoffee, stepCoffee } from './coffee';
import { resolveHolograms, stepPhaseFx, suckYolk } from './copies';
import { sound, spawnFloater, stepFloaters, stepSplashes, summonApparition } from './fx';
import { FREE_ACTIONS, fireShot, STEPPERS } from './mechanics';
import { canFire, canUseSlot, reselect, roundKeepsInPlay, slotAt, weaponForTier } from './loadout';
import { runLegs } from './runner';
import type { GameState, Player, PlayerConfig } from './state';
import { endScams } from './scam';
import { stepHeist } from './steal';
import { turnEnding, turnStarting } from './statuses';
import { currentPlayer, stepSoak, tankCentre, tickBurn } from './tanks';
import { newTally, tallyShot } from './tally';
import { clamp, normalizeAngle } from './util';

/**
 * The match: creating a game, aiming and weapon choice, firing (each weapon kind's mechanics live in
 * their own module), the fixed-step simulation and the turn state machine
 * (aiming → flying → settling → aiming | gameover). Pure logic, no DOM. The public API is re-exported
 * here, so the rest of the game imports from './game'.
 */
export { COFFEE_SIP, COFFEE_SPIN, canDrinkCoffee, coffeeFailChance, coffeeSpun, isCoffee } from './coffee';
export { DECOY_PICK_TIME, HOLOGRAM_BLAST_TIME, HOLOGRAM_PHASE_IN, YOLK_SUCKER, canPickDecoy, canSuckYolk, decoyPickLeft, finishDecoyPick, hologramAt, hologramsOf, pendingTwinSpot, placeTwin, toggleSwapTarget, twinSpotOk, yolkTier } from './copies';
export { isSpewing } from './gunk';
export { jetCharge } from './jetpack';
export { HOP_DISTANCE, HOP_FUEL, HOP_HEIGHT, HOP_TIME, drive } from './movement';
export { traceBeam, volleyOffsets } from './projectiles';
export { stitchPoint } from './sew';
export { PHASE_FOCUS, PHASE_RANGE, boomPhaseArcs, boomRadii } from './sonic';
export { STEAL_HOLD, STEAL_SPIN, heistIndex } from './steal';
export { streamDuration, streamPressure } from './stream';
export type { Target } from './tanks';
export { currentPlayer, damagePlayer, explode, muzzle, offence, tankCentre, targetAt, targetPos } from './tanks';
export { normalizeAngle } from './util';
export { WALKER_BODY } from './walkers';

export interface GameConfig {
  seed: number;
  players: PlayerConfig[];
  width?: number;
  height?: number;
  /** Who goes first: a player index (default 0), or 'random' (picked from the seed). */
  first?: number | 'random';
}

/**
 * Who goes first. 'random' is derived from the seed with integer maths (so both phones, and anyone
 * rebuilding the match from its seed, agree) and leaves the gameplay RNG untouched.
 */
export function firstPlayer(seed: number, count: number, first: GameConfig['first'] = 0): number {
  if (first !== 'random') return Math.min(Math.max(0, Math.floor(first)), count - 1);
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) % count;
}

export function createGame(cfg: GameConfig): GameState {
  if (cfg.players.length < 2) throw new Error('Need at least 2 players');
  const width = cfg.width ?? WORLD_W;
  const height = cfg.height ?? WORLD_H;
  const rng = createRng(cfg.seed);

  const heights = generateHeights(rng, width, height);
  const n = cfg.players.length;
  // Keep spawns out of the bottom corners, where the phone thumb controls sit.
  const xs = cfg.players.map((_, i) => {
    const base = width * (0.24 + (0.52 * i) / (n - 1));
    return Math.round(base + randRange(rng, -1, 1) * width * 0.02);
  });
  for (const x of xs) flattenAround(heights, x, TANK_HALF_WIDTH + 4);
  const terrain = Terrain.fromHeights(heights, width, height, rng);

  const players: Player[] = cfg.players.map((p, i) => {
    const x = xs[i]!;
    const character = getCharacter(p.characterId);
    return {
      id: i,
      name: p.name,
      colour: p.colour,
      ...tankBody({ x, y: terrain.surfaceY(x), hp: character.maxHp ?? MAX_HP }),
      maxHp: character.maxHp ?? MAX_HP,
      angle: x < width / 2 ? 45 : 135,
      power: 60,
      alive: true,
      characterId: character.id,
      loadout: [...character.loadout],
      ammo: character.loadout.map((_, tier) => AMMO_PER_TIER[tier] ?? 1),
      selectedTier: 0,
      cooked: null,
      tattoo: null,
      pinned: null,
      hop: null,
      twin: null,
      aimTwin: false,
      twinSpot: null,
      fuel: FUEL_PER_MATCH,
      scam: null,
      coffee: null,
      extraTurn: false,
      scooterCrash: 0,
    };
  });

  return {
    seed: cfg.seed,
    terrain,
    players,
    current: firstPlayer(cfg.seed, cfg.players.length, cfg.first),
    turn: 1,
    phase: 'aiming',
    heist: null,
    coffee: null,
    sfx: [],
    tunes: [],
    refund: null,
    lastShot: null,
    tally: cfg.players.map(() => newTally()),
    tallyShot: null,
    projectiles: [],
    beams: [],
    holograms: [],
    swapTargetId: null,
    decoyPick: 0,
    streams: [],
    jets: [],
    spews: [],
    stitches: [],
    runners: [],
    bursts: [],
    naps: [],
    booms: [],
    sludge: [],
    puddles: [],
    droplets: [],
    soakTimer: 0,
    rng,
    nextId: 0,
    fxSeq: 0,
    fx: { explosions: [], floaters: [], splashes: [], shimmers: [], ghosts: [], holoBlasts: [], apparitions: [] },
    settleTimer: 0,
    winner: null,
    endReason: null,
  };
}

/** `loserId` concedes (resigned, or out of time online): the match ends and the other player wins. */
export function concede(state: GameState, loserId: number, why: 'resigned' | 'timeout'): void {
  if (state.phase === 'gameover') return;
  state.phase = 'gameover';
  state.winner = state.players.find((p) => p.id !== loserId) ?? null;
  state.endReason = why;
  sound(state, 'gameover');
}

/** True when the current player's selected weapon ignores angle and power. */
export function isAimless(state: GameState): boolean {
  const p = currentPlayer(state);
  return ignoresAim(weaponForTier(p, p.selectedTier));
}

/** The tank the current player is aiming: the twin (with its own aim) if they've picked it, else the main tank. */
export function aimedTank(p: Player): { angle: number; power: number } {
  return p.aimTwin && p.twin ? p.twin : p;
}

export function setAim(state: GameState, angle: number, power: number): void {
  if (state.phase !== 'aiming' || isAimless(state)) return;
  const tank = aimedTank(currentPlayer(state));
  tank.angle = normalizeAngle(Math.round(angle));
  tank.power = clamp(Math.round(power), 0, 100);
}

export function adjustAim(state: GameState, dAngle: number, dPower: number): void {
  const tank = aimedTank(currentPlayer(state));
  setAim(state, tank.angle + dAngle, tank.power + dPower);
}

/** Aim the twin (true) or the main tank from now on (the twin only while there is one). */
export function aimTwin(state: GameState, twin: boolean): void {
  if (state.phase !== 'aiming') return;
  const p = currentPlayer(state);
  p.aimTwin = twin && !!p.twin;
}

/** Whether a player has anything to fire (Diced Coffee is no shot: alone, it doesn't keep them in). */
export function hasAmmo(p: Player): boolean {
  return p.ammo.some((_, tier) => roundKeepsInPlay(p, tier));
}

export { canFire, canUseSlot, slotAt, weaponForTier, type SlotKind } from './loadout';

/**
 * Choose which tier the current player fires next. Returns false if it can't be used now (canUseSlot: no
 * rounds left; Yolk Sucker: nothing to even out; Diced Coffee: already had one this turn).
 */
export function selectTier(state: GameState, tier: number): boolean {
  if (state.phase !== 'aiming') return false;
  const p = currentPlayer(state);
  if (!canUseSlot(state, p, tier)) return false;
  p.selectedTier = tier;
  return true;
}

export function fire(state: GameState): boolean {
  if (!canFire(state)) return false; // (not mid-hop either: land first)
  const p = currentPlayer(state);
  const tier = p.selectedTier;
  // torikloud's spent Twins slot, while the twin stands: Yolk Sucker, a bonus move (the turn carries on).
  if (slotAt(p, tier) === 'yolk') return suckYolk(state, p);
  const weapon = weaponForTier(p, tier);
  const kind = kindOf(weapon);
  // Not a shot (Steal, a bonus move): it does its thing, and the turn carries on.
  if (!isShotKind(kind)) return FREE_ACTIONS[kind](state, p, tier);
  p.ammo[tier]!--;
  reselect(p);
  // A miss gets the round back (checked when the turn ends).
  state.refund = weapon.refundOnMiss ? { playerId: p.id, tier, hit: false } : null;
  state.lastShot = { playerId: p.id, weaponId: weapon.id };
  tallyShot(state, p, weapon);
  fireShot(state, p, weapon as WeaponOf<ShotKind>, kind);
  sound(state, 'fire', weapon.id, p.power);
  runLegs(state);
  if (weapon.apparition) summonApparition(state, p, weapon.apparition);
  state.phase = 'flying';
  return true;
}

/** Advance the simulation by dt seconds. Pure logic: no DOM, safe to run in tests. */
export function step(state: GameState, dt: number): void {
  for (const e of state.fx.explosions) e.age += dt;
  state.fx.explosions = state.fx.explosions.filter((e) => e.age < e.duration);
  stepFloaters(state, dt);
  stepPhaseFx(state, dt);
  for (const a of state.fx.apparitions) a.age += dt;
  state.fx.apparitions = state.fx.apparitions.filter((a) => a.age < a.duration);

  stepSplashes(state, dt);

  if (state.phase === 'flying') {
    if (!runSteppers(state, dt)) {
      // The shot has played out: the last of the soak, then the turn settles.
      stepSoak(state, dt, true);
      settleTurn(state);
    }
  } else if (state.phase === 'stealing') {
    stepHeist(state, dt);
  } else if (state.phase === 'coffee') {
    stepCoffee(state, dt);
    // A spill's little jetpack (and its mud) plays out like a shot, then the turn carries on.
    const busy = runSteppers(state, dt);
    if (coffeeDone(state) && !busy) finishCoffee(state);
  } else if (state.phase === 'settling') {
    state.settleTimer -= dt;
    if (state.settleTimer <= 0) endTurn(state);
  }
}

/** Step everything that plays out during a shot (STEPPERS, in their order); returns whether any is still busy. */
function runSteppers(state: GameState, dt: number): boolean {
  for (const m of STEPPERS) m.step(state, dt);
  return STEPPERS.some((m) => m.busy(state));
}

function endTurn(state: GameState): void {
  // A refund-on-miss shot that didn't touch an enemy gives its round back.
  const refund = state.refund;
  state.refund = null;
  const shooter = refund && state.players[refund.playerId];
  if (refund && shooter && !refund.hit && shooter.alive) {
    shooter.ammo[refund.tier] = (shooter.ammo[refund.tier] ?? 0) + 1;
    const c = tankCentre(shooter);
    spawnFloater(state, c.x, c.y - 18, 'REFUNDED', '#ffcc1f');
    sound(state, 'refund');
  }
  const ending = currentPlayer(state);
  // Diced Coffee won this turn: the same player goes again (the next enemy turn is skipped).
  const again = ending.extraTurn;
  ending.extraTurn = false;
  turnEnding(ending);
  endScams(state);
  state.lastShot = null; // burns ticking below aren't this turn's attack
  state.tallyShot = null;
  resolveHolograms(state);
  // Burns tick at every turn change, whoever's turn it is: everyone burning takes their damage, round the
  // table from the next player. Then the turn goes to the next player alive with ammo.
  const n = state.players.length;
  for (let k = 1; k <= n; k++) {
    const p = state.players[(state.current + k) % n]!;
    if (p.alive) tickBurn(state, p);
  }
  let next = again && ending.alive && hasAmmo(ending) ? state.current : -1;
  for (let k = 1; k <= n && next < 0; k++) {
    const idx = (state.current + k) % n;
    const p = state.players[idx]!;
    if (p.alive && hasAmmo(p)) {
      next = idx;
      break;
    }
  }

  const alive = state.players.filter((p) => p.alive);
  if (alive.length <= 1) {
    sound(state, 'gameover');
    state.phase = 'gameover';
    state.winner = alive[0] ?? null;
    return;
  }
  if (next < 0) {
    // Everyone is out of ammo: highest HP wins, a tie is a draw.
    const total = (p: Player) => p.hp + (p.twin?.hp ?? 0);
    const best = Math.max(...alive.map(total));
    const leaders = alive.filter((p) => total(p) === best);
    sound(state, 'gameover');
    state.phase = 'gameover';
    state.winner = leaders.length === 1 ? leaders[0]! : null;
    return;
  }
  state.current = next;
  state.turn++;
  state.phase = 'aiming';
  turnStarting(state.players[next]!);
}

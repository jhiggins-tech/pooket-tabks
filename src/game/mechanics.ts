import type { ShotKind, WeaponKind } from '../weapons/kinds';
import type { WeaponOf } from '../weapons/types';
import { decoyPickStepper, fireDecoys, hologramBlastStepper, spawnTwin, twinGun } from './copies';
import { fireSpew, puddleStepper, sludgeStepper, spewStepper, toxinStepper } from './gunk';
import { fireJetpack, jetStepper } from './jetpack';
import { fireNap, napStepper } from './nap';
import { beamStepper, burstStepper, fireBeam, fireRain, fireRounds, projectileStepper } from './projectiles';
import { fireRunner, runnerStepper } from './runner';
import { fireSew, stitchStepper } from './sew';
import { boomStepper, fireSonic } from './sonic';
import type { GameState, Player } from './state';
import { armScam } from './scam';
import { startHeist } from './steal';
import { dropletStepper, fireStream, streamStepper } from './stream';
import { soakStepper } from './tanks';

/**
 * The weapon mechanics, in one place: how each kind goes off (`FIRE` for shots, `FREE_ACTIONS` for the rest:
 * the types insist on one per kind, from weapons/kinds.ts) and what plays out during a shot (`STEPPERS`).
 * A new kind of weapon: its row in weapons/kinds.ts and spec in weapons/types.ts, its module (fire +
 * stepper), its entry here and its stepper in STEPPERS.
 */

/** Sets a weapon of one kind going from player `p` (with its aim and power). */
export type FireFn<K extends ShotKind = ShotKind> = (state: GameState, p: Player, weapon: WeaponOf<K>) => void;

/** Fire a shot of whatever kind `weapon` is. */
export function fireShot(state: GameState, p: Player, weapon: WeaponOf<ShotKind>, kind: ShotKind): void {
  // (A weapon's kind picks its entry, so the weapon is always the kind that entry takes.)
  (FIRE[kind] as FireFn)(state, p, weapon);
}

/** Something that plays out while a shot is flying: advanced each tick, and holding the turn open while busy. */
export interface Stepper {
  step(state: GameState, dt: number): void;
  busy(state: GameState): boolean;
}

/** What a weapon that isn't a shot does (from tier `tier`): it spends its own round; the turn carries on. */
export type FreeActionFn = (state: GameState, p: Player, tier: number) => boolean;

export const FREE_ACTIONS: Record<Exclude<WeaponKind, ShotKind>, FreeActionFn> = {
  steal: startHeist,
  scam: armScam,
};

/** How each kind of shot goes off (each given a weapon of its kind: see `fireShot`). */
export const FIRE: { [K in ShotKind]: FireFn<K> } = {
  // A twin fires the same weapon from its own spot, with its own aim and power.
  ballistic: (state, p, weapon) => {
    fireRounds(state, p, weapon, 'main');
    if (p.twin) fireRounds(state, p, weapon, 'twin');
  },
  sonic: (state, p, weapon) => {
    fireSonic(state, p, weapon, p);
    if (p.twin) fireSonic(state, p, weapon, twinGun(p));
  },
  beam: fireBeam,
  rain: fireRain,
  stream: fireStream,
  decoy: fireDecoys,
  twin: (state, p) => spawnTwin(state, p),
  sew: fireSew,
  runner: fireRunner,
  spew: fireSpew,
  jetpack: fireJetpack,
  heal: fireNap,
};

/** Everything that moves during a shot, stepped in this order every tick (the order is part of the simulation). */
export const STEPPERS: Stepper[] = [
  projectileStepper,
  beamStepper,
  streamStepper,
  dropletStepper,
  soakStepper,
  jetStepper,
  spewStepper,
  burstStepper,
  stitchStepper,
  runnerStepper,
  napStepper,
  boomStepper,
  sludgeStepper,
  puddleStepper,
  toxinStepper,
  decoyPickStepper,
  hologramBlastStepper,
];

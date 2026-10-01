import type { WeaponDef, WeaponKind } from '../weapons/types';
import { decoyPickStepper, fireDecoys, hologramBlastStepper, spawnTwin, twinGun } from './copies';
import { fireSpew, puddleStepper, sludgeStepper, spewStepper, toxinStepper } from './gunk';
import { fireJetpack, jetStepper } from './jetpack';
import { fireNap, napStepper } from './nap';
import { beamStepper, burstStepper, fireBeam, fireRain, fireRounds, projectileStepper } from './projectiles';
import { fireRunner, runnerStepper } from './runner';
import { fireSew, stitchStepper } from './sew';
import { boomStepper, fireSonic } from './sonic';
import type { GameState, Player } from './state';
import { dropletStepper, fireStream, streamStepper } from './stream';
import { soakStepper } from './tanks';

/**
 * The weapon mechanics, in one place. A new kind of weapon needs: its module (fire + stepper), an entry
 * in FIRE (the type insists every kind has one) and its stepper in STEPPERS.
 */

/** Sets a weapon of one kind going from player `p` (with its aim and power). */
export type FireFn = (state: GameState, p: Player, weapon: WeaponDef) => void;

/** Something that plays out while a shot is flying: advanced each tick, and holding the turn open while busy. */
export interface Stepper {
  step(state: GameState, dt: number): void;
  busy(state: GameState): boolean;
}

/**
 * How each kind of weapon goes off. (Steal and Women in Scam aren't shots: `fire` hands them to the roulette
 * and the bonus move instead.)
 */
export const FIRE: Record<Exclude<WeaponKind, 'steal' | 'scam'>, FireFn> = {
  // A twin fires the same weapon with the same aim and power from its own spot.
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

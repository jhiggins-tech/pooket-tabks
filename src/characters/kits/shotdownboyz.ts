import type { WeaponDef } from '../../weapons/types';
import { kit } from '../kit';

/** His tier 1: a pistol, a single weak bullet on an arc. A weapon drop (a stratagem) takes its place. */
export const pistol = {
  id: 'pistol',
  name: 'Pistol',
  shortName: 'Pistol',
  info: 'A single bullet on an arc: weak, but it’s always there. A stratagem’s weapon drop takes its place (the rounds left stay).',
  blastRadius: 6,
  damage: 12,
} satisfies WeaponDef;

/**
 * Stratagem: FIRE brings up the d-pad and his stratagems (weapons/stratagems.ts) round the screen; he keys
 * one's combo, and a beacon flies along his aim. What it called in comes down where it lands
 * (game/stratagems.ts).
 */
export const stratagem = {
  id: 'stratagem',
  name: 'Stratagem',
  shortName: 'Stratagem',
  info:
    'FIRE, then key a stratagem’s combo on the d-pad (or W A S D) within 10 seconds, and a beacon flies along your aim. Where it lands: an Orbital Laser or Railcannon Strike; a Rocket, Tesla or Autocannon sentry that fires every turn, three times; or a pod to drive into, with a new tier 1 (W.A.S.P., Spear, Quasar, Grenade Pistol, SMG) or a Resupply. Every one is there every match; each one used re-arms for a few of your turns. Too close and it hurts you too, and anyone can drive into a pod: a weapon replaces their tier 1, and Resupply heals 30% (and refuels).',
  kind: 'stratagem',
  stratagem: { time: 10, podDamage: 8 },
} satisfies WeaponDef;

// ---- Weapon drops: each takes the Pistol's place when he drives into its pod. ----

/** A salvo of little missiles that tilt toward an enemy close by. */
export const wasp = {
  id: 'wasp',
  name: 'W.A.S.P. Launcher',
  shortName: 'W.A.S.P.',
  info: 'A stratagem’s weapon drop: a salvo of four little missiles that tilt toward an enemy they pass close to.',
  blastRadius: 12,
  damage: 14,
  burst: { count: 4, interval: 0.14, powerJitter: 0.04, aimJitterDeg: 3 },
  homing: { radius: 70, turnRate: 80, minSpeed: 200, soft: true },
  colour: '#fbbf24',
} satisfies WeaponDef;

/** A heavy missile that curves toward an enemy close by. */
export const spear = {
  id: 'spear',
  name: 'Spear',
  shortName: 'Spear',
  info: 'A stratagem’s weapon drop: a heavy anti-tank missile that curves toward an enemy it passes close to.',
  blastRadius: 22,
  damage: 50,
  homing: { radius: 110, turnRate: 60, minSpeed: 220, soft: true },
  colour: '#a3e635',
} satisfies WeaponDef;

/** A laser bolt, dead straight. */
export const quasar = {
  id: 'quasar',
  name: 'Quasar Cannon',
  shortName: 'Quasar',
  info: 'A stratagem’s weapon drop: a charged laser bolt that flies dead straight along your aim, no drop (power doesn’t matter).',
  kind: 'beam',
  blastRadius: 10,
  damage: 40,
  colour: '#60a5fa',
} satisfies WeaponDef;

/** A grenade that bounces once. */
export const grenadePistol = {
  id: 'grenade-pistol',
  name: 'Grenade Pistol',
  shortName: 'Gren. Pistol',
  info: 'A stratagem’s weapon drop: one grenade on an arc that bounces once, then goes off. Good for tanks behind cover.',
  blastRadius: 20,
  damage: 32,
  bounces: 1,
  restitution: 0.45,
} satisfies WeaponDef;

/** A spray of weak bullets. */
export const smg = {
  id: 'smg',
  name: 'Submachine Gun',
  shortName: 'SMG',
  info: 'A stratagem’s weapon drop: a spray of five weak bullets in a fan. A get-out-of-jail card up close.',
  blastRadius: 5,
  damage: 7,
  flat: true,
  volley: { count: 5, spreadDeg: 6 },
  trail: false,
} satisfies WeaponDef;

// ---- What the stratagems hit with (never in a slot: game/stratagems.ts uses them). ----

/** The beacon itself: it calls the stratagem in where it lands, and does nothing else. */
export const beacon = {
  id: 'stratagem-beacon',
  name: 'Stratagem Beacon',
  shortName: 'Beacon',
  info: 'The beacon a stratagem is called in with: where it lands, the stratagem comes down.',
  blastRadius: 0,
  damage: 0,
  plasma: true,
  colour: '#ef4444',
  trail: false,
} satisfies WeaponDef;

/** The Orbital Laser: each pulse of the beam as it burns down (`flat`: every pulse that catches a tank). */
export const orbitalLaser = {
  id: 'orbital-laser',
  name: 'Orbital Laser',
  shortName: 'Laser',
  info: 'Stratagem: a beam from orbit burns down on the beacon for a few seconds, drifting toward any enemy close by and cutting a trench.',
  blastRadius: 9,
  damage: 4,
  flat: true,
  colour: '#f43f5e',
} satisfies WeaponDef;

/** The Railcannon Strike: one round, straight down. */
export const railcannon = {
  id: 'railcannon',
  name: 'Railcannon Strike',
  shortName: 'Railcannon',
  info: 'Stratagem: one railgun round straight down on the beacon. Huge damage in a very small blast.',
  blastRadius: 13,
  damage: 95,
  colour: '#e0f2fe',
} satisfies WeaponDef;

/** The Rocket Sentry's rockets: launched roughly at the enemy, they tilt toward one close by. */
export const sentryRocket = {
  id: 'sentry-rocket',
  name: 'Rocket Sentry',
  shortName: 'Rockets',
  info: 'Stratagem: a sentry that fires a rocket toward the enemy every turn (anyone’s), three times; it tilts toward an enemy it passes close to.',
  blastRadius: 16,
  damage: 24,
  homing: { radius: 80, turnRate: 90, minSpeed: 220, soft: true },
  colour: '#fb923c',
} satisfies WeaponDef;

/** The Autocannon Sentry's shells: the one stratagem that aims itself. */
export const autocannonShell = {
  id: 'autocannon-shell',
  name: 'Autocannon Sentry',
  shortName: 'Autocannon',
  info: 'Stratagem: a sentry that works out the arc to the nearest enemy and lobs a shell at them every turn (anyone’s), three times.',
  blastRadius: 14,
  damage: 20,
} satisfies WeaponDef;

/** The Tesla Tower's zap: every tank close by, his own included. */
export const teslaZap = {
  id: 'tesla-zap',
  name: 'Tesla Tower',
  shortName: 'Tesla',
  info: 'Stratagem: a tower that zaps every tank close to it every turn (anyone’s), three times, his own included.',
  blastRadius: 0,
  damage: 16,
  colour: '#7dd3fc',
} satisfies WeaponDef;

/** A supply pod landing on a tank. */
export const supplyPod = {
  id: 'supply-pod',
  name: 'Supply Pod',
  shortName: 'Pod',
  info: 'Stratagem: a weapon or Resupply pod comes down where the beacon lands, and it hurts a little to be under it.',
  blastRadius: 0,
  damage: 8,
} satisfies WeaponDef;

/**
 * Prepper: he drills into the ground and a brick bunker builds round him, open only in a 35° slit along
 * his aim (game/bunker.ts). The bricks are terrain: shells hit them and blasts knock them out.
 */
export const prepper = {
  id: 'prepper',
  name: 'Prepper',
  shortName: 'Prepper',
  info:
    'He drills into the ground and a brick bunker builds round him, open only in a 35° slit where he’s aiming. Shells stop at the walls and blasts knock bricks out; a shot aimed outside the slit hits his own wall. The walls box him in like any terrain: blast a way out, or dig one with the Digger.',
  kind: 'bunker',
  bunker: { sink: 8, drillTime: 1.2, buildTime: 2.3, inner: 22, courses: 3, course: 3, brick: 7, slit: 35, standing: 0.4 },
} satisfies WeaponDef;

/** Bonus move: enter bulldozer mode for this turn. */
export const activateDigger = {
  id: 'activate-digger',
  name: 'Activate Digger',
  shortName: 'Digger',
  info:
    'Bonus move, once each turn: activate the bulldozer. ◀ ▶ then drive horizontally through any terrain, leaving a tunnel. The digger lasts until your turn ends and uses fuel as you move, but never uses up its bonus slot.',
  kind: 'digger',
} satisfies WeaponDef;

export const shotdownboyz = kit(
  {
    id: 'shotdownboyz',
    name: 'shotdownboyz',
    blurb: 'Beta: a Pistol, Helldivers stratagems called in on a d-pad, the Prepper bunker, a front-mounted bulldozer, and the Digger bonus move. When his fuel runs out, a jerry can of diesel in reserve refills it next turn.',
    colours: ['#f87171', '#fb7185', '#ef4444'],
    beta: true,
  },
  [pistol, stratagem, prepper, activateDigger],
  [wasp, spear, quasar, grenadePistol, smg, beacon, orbitalLaser, railcannon, sentryRocket, autocannonShell, teslaZap, supplyPod],
);

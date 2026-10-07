import { kindOf, weaponOf } from '../weapons/registry';
import type { DrumSpec, WeaponOf } from '../weapons/types';
import { sound, spawnFloater } from './fx';
import { canUseSlot, weaponForTier } from './loadout';
import type { Stepper } from './mechanics';
import type { Beat, DrumSet, GameState, Player } from './state';
import { currentPlayer, tankCentre } from './tanks';

/**
 * kiwicore's Band Aid: a rhythm minigame. A drum kit appears round his tank and a drumstick out of his
 * barrel; over a four-bar chiptune thrasher (after a bar's count-in), a note comes on every hit of the
 * chart, alternately on the left drum and the right one. Every tap, anywhere, hits the next note: the
 * turret swings over to that drum. Within `perfect` of the note it's a perfect hit, within `close` a close
 * one (worth half); a note let go by, or a tap with no note near, is a miss, and three misses end it. Hits
 * heal as they land: a flawless run gives back `maxHeal` of his full health (40%), never over full.
 *
 * It isn't a shot in flight: FIRE starts it (`startDrums`: phase `drumming`), and like aiming or driving
 * it's this phone's input. Only the drummer's phone runs its clock (`drumClock`) and taps (`drumTap`), and
 * the other phone and spectators see it through the aim previews (net/follow.ts). When it's over
 * (`drumsReady`) the drummer's phone fires it for real (the round spent, the pre-fire snapshot sent with
 * how it went), and that shot is the kit packing away (`drumStepper`).
 */

/** How long the kit takes to pack away once it's fired (s). */
export const DRUM_OUTRO = 1.2;

/** When each note comes (s from the start, count-in included). */
export function noteTimes(spec: DrumSpec): number[] {
  const beat = 60 / spec.bpm;
  return spec.notes.map((eighth) => spec.countIn * beat + (eighth * beat) / 2);
}

/** When the track is over (s): the last note, and its chance to be hit. */
export function trackEnd(spec: DrumSpec): number {
  return Math.max(...noteTimes(spec)) + spec.close;
}

/** Which drum note `i` is on: −1 left, +1 right (the first on the left). */
export function noteSide(i: number): number {
  return i % 2 === 0 ? -1 : 1;
}

/** Whether tier `tier` is a Band Aid. */
export function isDrum(p: Player, tier: number): boolean {
  return p.loadout[tier] !== undefined && kindOf(weaponForTier(p, tier)) === 'drum';
}

/** FIRE on Band Aid: the kit appears and the track starts (the round is spent when it's fired, at the end). */
export function startDrums(state: GameState): boolean {
  const p = currentPlayer(state);
  if (state.phase !== 'aiming' || p.hop || !isDrum(p, p.selectedTier) || !canUseSlot(state, p, p.selectedTier)) return false;
  const w = weaponOf(p.loadout[p.selectedTier]!, 'drum');
  state.drums = {
    playerId: p.id,
    weaponId: w.id,
    t: 0,
    beats: w.drum.notes.map((): Beat => 0),
    misses: 0,
    owed: 0,
    healed: 0,
    side: 1,
    swungAt: -1,
    last: null,
    done: false,
    outro: null,
  };
  state.phase = 'drumming';
  sound(state, 'tune', w.id);
  return true;
}

/** The drummer's phone: the track plays on; notes let go by are misses, and it's over at the end or on too many. */
export function drumClock(state: GameState, dt: number): void {
  const k = state.drums;
  if (state.phase !== 'drumming' || !k || k.done) return;
  const { drum } = weaponOf(k.weaponId, 'drum');
  k.t += dt;
  noteTimes(drum).forEach((at, i) => {
    if (k.beats[i] === 0 && k.t > at + drum.close) judge(state, k, i, 3);
  });
  if (k.misses >= drum.misses || k.t > trackEnd(drum)) finish(state, k);
}

/**
 * The drummer's phone: a tap, `ahead` s after the clock's last tick (when the finger came down, as near as
 * the main loop can tell). It hits the next note if one's near enough; otherwise it's a miss.
 */
export function drumTap(state: GameState, ahead = 0): void {
  const k = state.drums;
  if (state.phase !== 'drumming' || !k || k.done) return;
  const { drum } = weaponOf(k.weaponId, 'drum');
  const at = k.t + ahead;
  const times = noteTimes(drum);
  const i = k.beats.findIndex((b, j) => b === 0 && times[j]! >= at - drum.close);
  const off = i < 0 ? Infinity : Math.abs(at - times[i]!);
  // The stick goes to the next note's drum (or, with none left, back the other way).
  k.side = i < 0 ? -k.side : noteSide(i);
  k.swungAt = k.t;
  if (off <= drum.close) judge(state, k, i, off <= drum.perfect ? 1 : 2);
  else miss(state, k);
  if (k.misses >= drum.misses) finish(state, k);
}

/** Over, and waiting for the drummer's phone to fire it. */
export function drumsReady(state: GameState): boolean {
  return state.phase === 'drumming' && !!state.drums?.done;
}

/** Fired (game.ts `fire`, at the end of the track): how it went, and the kit packs away. */
export function playDrums(state: GameState, p: Player, weapon: WeaponOf<'drum'>): void {
  const k = state.drums;
  if (!k) return;
  k.outro = 0;
  const c = tankCentre(p);
  const hits = k.beats.filter((b) => b === 1 || b === 2).length;
  spawnFloater(state, c.x, c.y - 30, `BAND AID ${hits}/${weapon.drum.notes.length} · +${k.healed}`, '#86efac');
}

/**
 * Another phone's Band Aid, as its previews show it (net/follow.ts): the drumming as it stands there, with
 * the music and the hits to hear here (the drummer's phone plays its own as they happen).
 */
export function followDrums(state: GameState, next: DrumSet): void {
  const was = state.phase === 'drumming' ? state.drums : null;
  if (!was) sound(state, 'tune', next.weaponId);
  next.beats.forEach((b, i) => {
    if (b === 0 || (was?.beats[i] ?? 0) !== 0) return;
    if (b === 3) sound(state, 'whiff', next.weaponId);
    else sound(state, 'drum', next.weaponId, noteSide(i));
  });
  if (next.done && !was?.done) sound(state, 'tune-end', next.weaponId);
  state.drums = next;
  state.phase = 'drumming';
}

export const drumStepper: Stepper = {
  step(state, dt) {
    const k = state.drums;
    if (!k || k.outro === null) return;
    k.outro += dt;
    if (k.outro >= DRUM_OUTRO) state.drums = null;
  },
  busy: (state) => state.drums !== null,
};

/** Note `i`'s verdict: a hit heals (its share of the most it can give back), a miss counts. */
function judge(state: GameState, k: DrumSet, i: number, beat: Beat): void {
  k.beats[i] = beat;
  if (beat === 3) return miss(state, k);
  k.last = { beat, at: k.t };
  sound(state, 'drum', k.weaponId, noteSide(i));
  const p = state.players[k.playerId]!;
  const { drum } = weaponOf(k.weaponId, 'drum');
  const score = k.beats.reduce<number>((n, b) => n + (b === 1 ? 1 : b === 2 ? 0.5 : 0), 0);
  const owed = Math.round((p.maxHp * drum.maxHeal * score) / drum.notes.length);
  const gain = Math.max(0, Math.min(owed - k.owed, p.maxHp - p.hp));
  k.owed = owed;
  k.healed += gain;
  p.hp += gain;
}

function miss(state: GameState, k: DrumSet): void {
  k.misses++;
  k.last = { beat: 3, at: k.t };
  sound(state, 'whiff', k.weaponId);
}

/** Over: the track stops, and the drummer's phone fires it (`drumsReady`). */
function finish(state: GameState, k: DrumSet): void {
  if (k.done) return;
  k.done = true;
  sound(state, 'tune-end', k.weaponId);
}

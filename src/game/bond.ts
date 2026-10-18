import { BOND_ACTORS, BOND_TRIVIA } from '../weapons/trivia';
import type { WeaponOf } from '../weapons/types';
import { kindOf, weaponOf } from '../weapons/registry';
import { TANK_BODY_HEIGHT } from './constants';
import { sound, spawnFloater } from './fx';
import { canUseSlot, weaponForTier } from './loadout';
import type { Stepper } from './mechanics';
import type { GameState, Player, Quiz } from './state';
import { applyHit, currentPlayer, markFor, scaled, tankCentre, targetOf, targetPos } from './tanks';

/**
 * garyoldmancorp's 007: a Bond trivia question (weapons/trivia.ts) pops up, the answer always one of the
 * six Bond actors. A right answer and the gun barrel opens on the enemy target nearest him (a decoy
 * counts, so it gives nothing away; a tank hidden by Sly doesn't), the target silhouetted inside it, over
 * a little spy sting (render/draw/bond.ts, audio/sfx.ts); when the sting ends the shot rings out and they
 * lose `share` of the health they have left (a decoy: of its owner's, as any hit on it shows). A wrong
 * answer, or none in `time` s, does nothing.
 *
 * Like Band Aid (drums.ts) it isn't a shot in flight: FIRE puts the question up (`startQuiz`: phase
 * `quizzing`), and like aiming it's this phone's input. Only his phone runs its clock (`quizClock`) and
 * takes the answer (`answerQuiz`); the other phone and spectators follow it in the aim previews
 * (net/follow.ts, `followQuiz`). Once it's answered (`quizReady`) his phone fires it for real (the round
 * spent, the pre-fire snapshot sent with the answer), and that shot is the answer showing (`QUIZ_OUTRO`),
 * then the gun barrel (`BARREL`), both played out by `bondStepper`.
 */

/** How long the answer shows once it's fired (s); the gun barrel starts as it goes. */
export const QUIZ_OUTRO = 1.2;

/**
 * The gun barrel's clock (s from the shot): the white dot slides across from `dots`, the barrel opens
 * round the target at `open` (and the sting starts: it lasts `shot - open`), the shot at `shot` (the
 * damage), and it's all faded out by `end`.
 */
export const BARREL = { dots: QUIZ_OUTRO, open: QUIZ_OUTRO + 1, shot: QUIZ_OUTRO + 4.2, end: QUIZ_OUTRO + 5 } as const;

/** Whether tier `tier` is a 007. */
export function isBond(p: Player, tier: number): boolean {
  return p.loadout[tier] !== undefined && kindOf(weaponForTier(p, tier)) === 'bond';
}

/** FIRE on 007: a question goes up (the round is spent when it's fired, once it's answered). */
export function startQuiz(state: GameState): boolean {
  const p = currentPlayer(state);
  if (state.phase !== 'aiming' || p.hop || p.flight || !isBond(p, p.selectedTier) || !canUseSlot(state, p, p.selectedTier)) return false;
  const w = weaponOf(p.loadout[p.selectedTier]!, 'bond');
  const question = Math.min(BOND_TRIVIA.length - 1, Math.floor(state.rng() * BOND_TRIVIA.length));
  state.quiz = { playerId: p.id, weaponId: w.id, question, t: 0, picked: null, done: false, outro: null };
  state.phase = 'quizzing';
  sound(state, 'quiz', w.id);
  return true;
}

/** His phone: the clock runs down, and it's over (no answer) when time's up. */
export function quizClock(state: GameState, dt: number): void {
  const q = state.quiz;
  if (state.phase !== 'quizzing' || !q || q.done) return;
  q.t += dt;
  if (q.t >= weaponOf(q.weaponId, 'bond').bond.time) q.done = true;
}

/** His phone: he picks actor `i` (`BOND_ACTORS`), and that's his answer. */
export function answerQuiz(state: GameState, i: number): void {
  const q = state.quiz;
  if (state.phase !== 'quizzing' || !q || q.done || !(i >= 0 && i < BOND_ACTORS.length)) return;
  q.picked = i;
  q.done = true;
}

/** Answered (or out of time), and waiting for his phone to fire it. */
export function quizReady(state: GameState): boolean {
  return state.phase === 'quizzing' && !!state.quiz?.done;
}

/** Whole seconds left to answer (null: no question up). */
export function quizLeft(state: GameState): number | null {
  const q = state.phase === 'quizzing' ? state.quiz : null;
  if (!q) return null;
  return Math.max(0, Math.ceil(weaponOf(q.weaponId, 'bond').bond.time - q.t));
}

/** The right answer to `q` (an index into `BOND_ACTORS`). */
export function rightAnswer(q: Quiz): number {
  return BOND_ACTORS.indexOf(BOND_TRIVIA[q.question]!.answer);
}

/** Whether `q` was answered right. */
export function answeredRight(q: Quiz): boolean {
  return q.picked === rightAnswer(q);
}

/** Another phone's 007, as its previews show it (net/follow.ts): the question goes up here too. */
export function followQuiz(state: GameState, next: Quiz): void {
  if (state.phase !== 'quizzing' || !state.quiz) sound(state, 'quiz', next.weaponId);
  state.quiz = next;
  state.phase = 'quizzing';
}

/** Fired (game.ts `fire`, once it's answered): right, and the gun barrel's on the enemy; wrong, nothing. */
export function fireBond(state: GameState, p: Player, weapon: WeaponOf<'bond'>): void {
  const q = state.quiz;
  if (!q) return;
  q.outro = 0;
  const c = tankCentre(p);
  if (!answeredRight(q)) {
    const said = q.picked === null ? 'TIME’S UP' : 'WRONG';
    spawnFloater(state, c.x, c.y - 30, `${said}: IT WAS ${BOND_ACTORS[rightAnswer(q)]!.toUpperCase()}`, '#fca5a5');
    sound(state, 'quiz-wrong', weapon.id);
    return;
  }
  sound(state, 'quiz-right', weapon.id);
  const mark = markFor(state, p);
  if (!mark) {
    spawnFloater(state, c.x, c.y - 30, 'NO TARGET', '#cfd6ff');
    return;
  }
  const at = targetPos(mark.target);
  state.barrel = { ownerId: p.id, weaponId: weapon.id, mark: mark.mark, x: at.x, y: at.y, t: 0, hit: false };
}

/** The answer shows, then goes. */
export const quizStepper: Stepper = {
  step(state, dt) {
    const q = state.quiz;
    if (!q || q.outro === null) return;
    q.outro += dt;
    if (q.outro >= QUIZ_OUTRO) state.quiz = null;
  },
  busy: (state) => state.quiz !== null,
};

/** The gun barrel: the dot, the barrel open on them over the sting, then the shot and their share of health. */
export const barrelStepper: Stepper = {
  step(state, dt) {
    const b = state.barrel;
    if (!b) return;
    const was = b.t;
    b.t += dt;
    if (was < BARREL.dots && b.t >= BARREL.dots) sound(state, 'gun-barrel', b.weaponId);
    if (was < BARREL.open && b.t >= BARREL.open) sound(state, 'bond-sting', b.weaponId);
    if (!b.hit && b.t >= BARREL.shot) {
      b.hit = true;
      sound(state, 'bond-shot', b.weaponId);
      const target = targetOf(state, b.mark);
      if (target) {
        const weapon = weaponOf(b.weaponId, 'bond');
        const hp = target.kind === 'tank' ? target.tank.hp : state.players[target.holo.ownerId]!.hp;
        applyHit(state, target, weapon, b.ownerId, scaled(state, b.ownerId, hp * weapon.bond.share), weapon.colour);
        spawnFloater(state, b.x, b.y - TANK_BODY_HEIGHT - 22, '007', '#fde047');
      }
    }
    if (b.t >= BARREL.end) state.barrel = null;
  },
  busy: (state) => state.barrel !== null,
};

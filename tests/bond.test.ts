import { describe, expect, it } from 'vitest';
import { doubleOSeven } from '../src/characters/kits';
import { FIXED_DT, MAX_HP } from '../src/game/constants';
import { answerQuiz, BARREL, canFire, fire, isBond, quizClock, quizLeft, quizReady, rightAnswer, selectTier, step } from '../src/game/game';
import type { GameState } from '../src/game/state';
import { applyPreview, previewOf } from '../src/net/follow';
import { BOND_ACTORS, BOND_TRIVIA } from '../src/weapons/trivia';
import { testGame, untilAiming, whileFlying } from './support/game';

const players = [
  { name: 'gary', colour: '#cbd5e1', characterId: 'garyoldmancorp' },
  { name: 'kcaj', colour: '#ffc53d', characterId: 'kcaj' },
];

/** garyoldmancorp at 300 and kcaj at 700, on flat ground; gary to play, with 007 selected. */
function game(seed = 3): GameState {
  const g = testGame({ seed, players, xs: [300, 700] });
  g.current = 0;
  selectTier(g, 2);
  return g;
}

/** FIRE: the question goes up. */
function ask(g: GameState): void {
  expect(fire(g)).toBe(false); // it's fired once it's answered
  expect(g.phase).toBe('quizzing');
}

/** Answer right (or wrong), and fire it. */
function answer(g: GameState, right: boolean): void {
  const r = rightAnswer(g.quiz!);
  answerQuiz(g, right ? r : (r + 1) % BOND_ACTORS.length);
  expect(quizReady(g)).toBe(true);
  expect(fire(g)).toBe(true);
}

/** Step the shot on for `seconds`. */
function run(g: GameState, seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += FIXED_DT) step(g, FIXED_DT);
}

const cues = (g: GameState) => g.sfx.map((e) => e.cue);

describe("garyoldmancorp's 007", () => {
  it('has 20 questions, every one answered by one of the six Bond actors, and every actor answers some', () => {
    expect(BOND_TRIVIA).toHaveLength(20);
    expect(new Set(BOND_TRIVIA.map((t) => t.q)).size).toBe(20);
    for (const t of BOND_TRIVIA) expect(BOND_ACTORS).toContain(t.answer);
    expect(new Set(BOND_TRIVIA.map((t) => t.answer)).size).toBe(BOND_ACTORS.length);
  });

  it('is his tier 3: FIRE puts a question up (picked by the seed), and the round is spent only once it’s answered', () => {
    const g = game();
    const gary = g.players[0]!;
    expect(gary.loadout[2]).toBe('double-o-seven');
    expect(isBond(gary, 2)).toBe(true);
    ask(g);
    expect(gary.ammo[2]).toBe(1);
    expect(canFire(g)).toBe(false);
    expect(cues(g)).toContain('quiz');
    expect(quizLeft(g)).toBe(doubleOSeven.bond.time);
    const again = game();
    ask(again);
    expect(again.quiz!.question).toBe(g.quiz!.question);
  });

  it('right: the gun barrel opens on the enemy, the sting plays, and at the shot they lose 77% of what they have left', () => {
    const g = game();
    const kcaj = g.players[1]!;
    ask(g);
    answer(g, true);
    expect(g.players[0]!.ammo[2]).toBe(0);
    expect(g.phase).toBe('flying');
    expect(g.barrel).toMatchObject({ ownerId: 0, mark: { kind: 'tank', playerId: 1, twin: false }, x: kcaj.x, y: kcaj.y });
    expect(cues(g)).toContain('quiz-right');
    run(g, BARREL.shot - 0.05);
    expect(kcaj.hp).toBe(MAX_HP); // not till the sting's over
    expect(cues(g)).toEqual(expect.arrayContaining(['gun-barrel', 'bond-sting']));
    run(g, 0.1);
    expect(kcaj.hp).toBe(MAX_HP - 77);
    expect(cues(g)).toContain('bond-shot');
    whileFlying(g);
    expect(g.barrel).toBeNull();
    expect(g.quiz).toBeNull();
    untilAiming(g);
    expect(g.current).toBe(1);
  });

  it('77% of the health left, so it never quite finishes them off on its own', () => {
    const g = game();
    g.players[1]!.hp = 40;
    ask(g);
    answer(g, true);
    whileFlying(g);
    expect(g.players[1]!.hp).toBe(40 - Math.round(40 * 0.77));
    expect(g.players[1]!.alive).toBe(true);
  });

  it('wrong: no gun barrel and no damage, the answer shows, and the turn moves on', () => {
    const g = game();
    ask(g);
    answer(g, false);
    expect(g.barrel).toBeNull();
    expect(cues(g)).toContain('quiz-wrong');
    expect(g.fx.floaters.some((f) => f.text.startsWith('WRONG: IT WAS'))).toBe(true);
    whileFlying(g);
    untilAiming(g);
    expect(g.players[1]!.hp).toBe(MAX_HP);
    expect(g.current).toBe(1);
  });

  it('no answer in time is a wrong one', () => {
    const g = game();
    ask(g);
    for (let t = 0; t < doubleOSeven.bond.time + 0.1; t += FIXED_DT) quizClock(g, FIXED_DT);
    expect(quizReady(g)).toBe(true);
    expect(g.quiz!.picked).toBeNull();
    answerQuiz(g, 0); // too late
    expect(g.quiz!.picked).toBeNull();
    expect(fire(g)).toBe(true);
    expect(g.barrel).toBeNull();
    expect(g.fx.floaters.some((f) => f.text.startsWith('TIME’S UP'))).toBe(true);
  });

  it('can’t find an enemy hidden by Sly', () => {
    const g = game();
    g.players[1]!.hidden = true;
    ask(g);
    answer(g, true);
    expect(g.barrel).toBeNull();
    whileFlying(g);
    expect(g.players[1]!.hp).toBe(MAX_HP);
  });

  it('the other phone sees the question (and the answer) in the previews', () => {
    const here = game();
    const there = game();
    ask(here);
    applyPreview(there, previewOf(here));
    expect(there.phase).toBe('quizzing');
    expect(there.quiz).toEqual(here.quiz);
    expect(cues(there)).toContain('quiz');
    answerQuiz(here, 2);
    applyPreview(there, previewOf(here));
    expect(there.quiz!.picked).toBe(2);
  });
});

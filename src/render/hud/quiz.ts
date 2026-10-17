/**
 * garyoldmancorp's 007 on the HUD: the Bond question, the six actors to pick from (the buttons are this
 * phone's only while it's his turn here: input/controls.ts takes the taps), the seconds left, and once it's
 * fired, the answer: the right one lit up, a wrong pick crossed out.
 */
import { answeredRight, quizLeft, rightAnswer } from '../../game/game';
import { BOND_ACTORS, BOND_TRIVIA } from '../../weapons/trivia';
import { el, query } from '../../ui/dom';
import { Overlay } from './overlay';
import { keyed, type Part } from './part';

export function quiz(): Part {
  const overlay = new Overlay('quiz');
  const questionEl = query('#quiz .quiz-question');
  const answersEl = query('#quiz .quiz-answers');
  return keyed(
    (state, ctx) => {
      const q = state.quiz;
      return q ? `${q.playerId}|${q.question}|${q.picked}|${q.outro !== null}|${quizLeft(state)}|${ctx.remote}` : '';
    },
    (state, ctx) => {
      const q = state.quiz;
      overlay.show(!!q);
      if (!q) return;
      const p = state.players[q.playerId]!;
      const shown = q.outro !== null;
      overlay.vars({ asker: p.colour });
      overlay.root.classList.toggle('right', shown && answeredRight(q));
      overlay.root.classList.toggle('wrong', shown && !answeredRight(q));
      const left = quizLeft(state);
      overlay.title('🍸 007 · ', p, left === null ? '' : ` · ⏱ ${left}`);
      questionEl.textContent = BOND_TRIVIA[q.question]!.q;
      const right = rightAnswer(q);
      answersEl.replaceChildren(
        ...BOND_ACTORS.map((name, i) => {
          const b = el('button', 'quiz-answer', name);
          b.dataset.answer = String(i);
          b.disabled = ctx.remote || q.done;
          b.classList.toggle('picked', q.picked === i);
          b.classList.toggle('right', shown && i === right);
          b.classList.toggle('wrong', shown && q.picked === i && i !== right);
          return b;
        }),
      );
      overlay.result(!shown ? null : answeredRight(q) ? 'Correct! 🔫' : q.picked === null ? 'Out of time!' : `Wrong! It was ${BOND_ACTORS[right]}`);
    },
  );
}

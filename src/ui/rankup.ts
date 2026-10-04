import type { Rank } from '../stats/ranks';
import { el } from './dom';
import { insignia } from './insignia';

/**
 * The rank-up moment: the new insignia bursts in with a ring of sparkles and its name in the rank's
 * colours, over whatever's on screen (the game over card, or the menu if the rank-up turned up in the
 * hourly totals). The rank's jingle plays alongside (main.ts, audio/sfx.ts `rankJingle`). Tap to carry on.
 */
export class RankUp {
  private readonly root = el('div', 'overlay');
  private readonly stage = el('div', 'rankup-stage');
  private readonly title = el('h2', 'rankup-title');
  private readonly name = el('p', 'rankup-name');
  private readonly note = el('p', 'rankup-note');
  private readonly line = el('p', 'rankup-line');

  constructor() {
    this.root.id = 'rankup';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Rank up');
    const ok = el('button', 'big', 'Nice!');
    ok.id = 'rankup-ok';
    ok.addEventListener('click', () => this.close());
    const card = el('div', 'rankup-card');
    card.append(this.stage, this.title, this.name, this.line, this.note, ok);
    this.root.append(card);
    document.body.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** `first`: newly ranked (their first rated match); `rating`: where they stand now. */
  show(rank: Rank, first: boolean, rating: number | null): void {
    const badge = insignia(rank, 'lg');
    const burst = el('div', 'rankup-burst');
    for (let i = 0; i < 12; i++) {
      const spark = el('span', undefined, '✦');
      spark.style.setProperty('--a', `${i * 30}deg`);
      spark.style.setProperty('--d', `${(i % 3) * 0.08}s`);
      burst.append(spark);
    }
    this.stage.replaceChildren(burst, badge);
    this.stage.style.setProperty('--rank-light', rank.colours[0]);
    this.stage.style.setProperty('--rank-dark', rank.colours[1]);
    this.title.textContent = first ? 'RANKED!' : 'RANK UP!';
    this.name.textContent = rank.name;
    this.name.style.color = rank.colours[0];
    this.line.textContent = rank.line ?? '';
    this.line.hidden = !rank.line;
    this.note.textContent = rating === null ? '' : `Rating ${Math.round(rating)}`;
    this.root.hidden = false;
    // Restart the entrance animation each time.
    this.root.classList.remove('play');
    void this.root.offsetWidth;
    this.root.classList.add('play');
  }

  close(): void {
    this.root.hidden = true;
  }
}

import { BAND, rankIndex, rankOf, RANKS, type Rank } from '../stats/ranks';
import { button, dialog, el } from './dom';
import { insignia } from './insignia';

/**
 * The rank moment: the insignia bursts in with a ring of sparkles and the rating bar moves to show match
 * progress. On menus, a rank arriving in the hourly totals still gets the rank-up celebration. Tap to carry on.
 */
export class RankUp {
  private readonly root = dialog('rankup', 'Rank up');
  private readonly stage = el('div', 'rankup-stage');
  private readonly title = el('h2', 'rankup-title');
  private readonly name = el('p', 'rankup-name');
  private readonly note = el('p', 'rankup-note');
  private readonly line = el('p', 'rankup-line');
  private readonly progress = el('div', 'rankup-progress');
  private readonly progressTrack = el('div', 'rankup-progress-track');
  private readonly progressFill = el('div', 'rankup-progress-fill');
  private readonly ratingChange = el('p', 'rankup-rating-change');
  private timers: number[] = [];
  private frame: number | null = null;
  private then: (() => void) | null = null;

  constructor() {
    const ok = button('Nice!', () => this.close(), 'big');
    ok.id = 'rankup-ok';
    this.progressTrack.id = 'rankup-progress';
    this.progressTrack.setAttribute('role', 'progressbar');
    this.progressTrack.setAttribute('aria-label', 'Progress to next rank');
    this.progressTrack.setAttribute('aria-valuemin', '0');
    this.progressTrack.setAttribute('aria-valuemax', '100');
    this.progressTrack.append(this.progressFill);
    this.progress.append(el('p', 'rankup-progress-label', 'Progress to next rank'), this.progressTrack, this.ratingChange);
    this.progress.hidden = true;
    const card = el('div', 'rankup-card');
    card.append(this.stage, this.title, this.name, this.line, this.note, this.progress, ok);
    this.root.append(card);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** `first`: newly ranked (their first rated match); `rating`: where they stand now; `then`: once it's closed. */
  show(rank: Rank, first: boolean, rating: number | null, then?: () => void): void {
    this.stopAnimation();
    this.then = then ?? null;
    this.progress.hidden = true;
    delete this.root.dataset.state;
    delete this.root.dataset.direction;
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

  /** Animate this rated match's rating change through the player's rank progress. */
  showRating(before: number, after: number, first: boolean, then?: () => void): void {
    const beforeRank = rankOf(before);
    const rank = rankOf(after);
    const movement = rankIndex(rank) - rankIndex(beforeRank);
    this.show(rank, first, after, then);
    this.title.textContent = first ? 'RANKED!' : movement > 0 ? 'RANK UP!' : movement < 0 ? 'RANK DOWN!' : 'RATING UPDATE';
    this.progress.hidden = false;
    this.root.dataset.state = 'rating';
    this.root.dataset.direction = after > before ? 'up' : after < before ? 'down' : 'same';
    const start = rankProgress(before, beforeRank);
    const finish = rankProgress(after, rank);
    this.progressFill.style.width = `${start}%`;
    this.progressTrack.setAttribute('aria-valuenow', String(finish));
    this.progressTrack.setAttribute('aria-valuetext', `${finish}%`);
    const roundedChange = Math.round((after - before) * 10) / 10;
    const change = new Intl.NumberFormat('en', { maximumFractionDigits: 1, signDisplay: 'always' }).format(roundedChange);
    this.ratingChange.textContent = `${Math.round(before)}  →  ${Math.round(after)}  (${change})`;
    this.ratingChange.classList.toggle('down', roundedChange < 0);
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.progressFill.style.width = `${finish}%`;
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      if (movement === 0) {
        this.progressFill.style.width = `${finish}%`;
        return;
      }
      this.progressFill.style.width = movement > 0 ? '100%' : '0%';
      this.later(970, () => {
        this.progressFill.classList.add('resetting');
        this.progressFill.style.width = movement > 0 ? '0%' : '100%';
        void this.progressFill.offsetWidth;
        this.progressFill.classList.remove('resetting');
        this.frame = requestAnimationFrame(() => {
          this.frame = null;
          this.progressFill.style.width = `${finish}%`;
        });
      });
    });
  }

  close(): void {
    this.root.hidden = true;
    this.stopAnimation();
    const then = this.then;
    this.then = null;
    then?.();
  }

  private later(ms: number, run: () => void): void {
    this.timers.push(window.setTimeout(run, ms));
  }

  private stopAnimation(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }
}

function rankProgress(rating: number, rank: Rank): number {
  const lower = Number.isFinite(rank.min) ? rank.min : RANKS[1]!.min - BAND;
  return Math.round(Math.max(0, Math.min(100, ((rating - lower) / BAND) * 100)));
}

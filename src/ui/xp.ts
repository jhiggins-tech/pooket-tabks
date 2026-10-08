import type { XpCue } from '../audio/xp';
import { getCharacter } from '../characters/roster';
import { XP, xpProgress, xpShown } from '../stats/xp';
import { button, dialog, el } from './dom';
import type { Gain, Progress } from './progress';

/**
 * The XP screen. After a rated match (and its rank-up celebration, if there was one: main.ts), what the
 * match earned, and the bar towards the next unlock filling up a notch at a time: each notch zips full,
 * lights up and blips a step higher than the last (audio/xp.ts), the numbers count up with it, and a
 * full bar flashes gold with a burst of sparks and a fanfare, "🔓 Unlock ready!", then empties and fills
 * on with whatever's left. Tap anywhere to skip to the end.
 *
 * With a token to spend, "Choose your unlock" lists the characters it could unlock (characters/access.ts):
 * tap one and its padlock shakes and breaks open, and it's theirs online (ui/progress.ts saves it to the
 * account). `unlockNow` is that moment on its own, for a token spent from Choose your tank.
 */

/** One notch filling (ms; matches `.xp-notch.filling` in style.css). */
const FILL_MS = 380;
/** A beat between notches. */
const GAP_MS = 120;
/** The full-bar moment before the bar empties for the rest. */
const FULL_MS = 1200;
/** A padlock breaking open, before the screen moves on. */
const OPEN_MS = 1500;

type Sound = (cue: XpCue, n?: number) => void;

export class XpScreen {
  private readonly root = dialog('xp', 'XP');
  private readonly card = el('div', 'xp-card');
  private timers: number[] = [];
  /** Skip the bar to the end (while it's filling). */
  private skipTo: (() => void) | null = null;
  private then: (() => void) | null = null;

  constructor(
    private readonly progress: Progress,
    private readonly sound: Sound,
  ) {
    this.root.append(this.card);
    // A tap anywhere (but a button) skips the bar to the end.
    this.root.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('button')) this.skipTo?.();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** What `gain` earned, the bar filling from where it was; `then` once it's closed. */
  show(gain: Gain, then?: () => void): void {
    this.reset();
    this.then = then ?? null;
    const gained = gain.after - gain.before;
    const head = el('div', 'xp-head');
    const amount = el('p', 'xp-gain', '+0 XP');
    const why = el('p', 'xp-why', gain.score === 1 ? 'Win' : gain.score === 0.5 ? 'Draw' : 'Loss');
    head.append(amount, why);
    const bar = el('div', 'xp-bar');
    const notches = Array.from({ length: XP.unlock }, () => {
      const n = el('div', 'xp-notch');
      n.append(el('div', 'xp-fill'));
      bar.append(n);
      return n;
    });
    const burst = el('div', 'xp-burst');
    const total = el('p', 'xp-total');
    const next = el('p', 'xp-next');
    const actions = el('div', 'xp-actions');
    const wrap = el('div', 'xp-barwrap');
    wrap.append(bar, burst);
    this.card.replaceChildren(head, wrap, total, next, actions);
    this.root.dataset.state = 'filling';
    this.open();

    /** Show the bar at `xp` (units): full if it's just reached an unlock, else lit up to where it is. */
    const showBar = (xp: number, full: boolean) => {
      const lit = full ? XP.unlock : xpProgress(xp).into;
      notches.forEach((n, i) => {
        n.classList.toggle('lit', i < lit);
        n.classList.remove('filling');
      });
      bar.classList.toggle('full', full);
    };
    const setNumbers = (xp: number) => {
      amount.textContent = `+${xpShown(xp - gain.before)} XP`;
      total.textContent = `${xpShown(xp).toLocaleString('en')} XP`;
      for (const e of [amount, total]) bump(e);
    };
    const finish = () => {
      this.skipTo = null;
      for (const t of this.timers) clearTimeout(t);
      this.timers = [];
      const full = gained > 0 && gain.after % XP.unlock === 0;
      showBar(gain.after, full);
      amount.textContent = `+${xpShown(gained)} XP`;
      total.textContent = `${xpShown(gain.after).toLocaleString('en')} XP`;
      this.footer(next, actions, gained > 0 ? '' : `Too quick to count: matches count from turn ${XP.minTurns}.`);
      this.root.dataset.state = 'done';
    };

    showBar(gain.before, false);
    amount.textContent = '+0 XP';
    total.textContent = `${xpShown(gain.before).toLocaleString('en')} XP`;
    this.skipTo = finish;
    if (gained <= 0) return finish();

    // The timeline: each unit fills a notch; a full bar has its moment, then empties for the rest.
    let at = 450; // (a moment to take the screen in)
    let unlocked = false;
    for (let k = gain.before + 1; k <= gain.after; k++) {
      const i = (k - 1) % XP.unlock;
      const n = notches[i]!;
      this.later(at, () => {
        n.classList.add('filling');
        this.sound('fill', i + 1);
      });
      at += FILL_MS;
      this.later(at, () => {
        n.classList.remove('filling');
        n.classList.add('lit');
        setNumbers(k);
        this.sound('notch', i + 1);
      });
      at += GAP_MS;
      if (k % XP.unlock === 0) {
        unlocked = true;
        this.later(at, () => {
          bar.classList.add('full');
          sparks(burst);
          next.textContent = '🔓 Unlock ready!';
          next.className = 'xp-next ready';
          this.sound('full');
        });
        at += FULL_MS;
        if (k < gain.after) this.later(at, () => showBar(k, false)); // empty, for the rest
      }
    }
    this.later(at, () => {
      if (!unlocked) this.sound('done');
      finish();
    });
  }

  /** Spend a token on `id` (from Choose your tank): its padlock breaking open, here. Resolves with whether it worked. */
  async unlockNow(id: string): Promise<boolean> {
    this.reset();
    this.open();
    return this.pick(id, (ok) => {
      const done = button(ok ? 'Nice!' : 'OK', () => this.close(), 'big');
      done.id = 'xp-ok';
      this.card.append(done);
    });
  }

  close(): void {
    this.reset();
    this.root.hidden = true;
    const then = this.then;
    this.then = null;
    then?.();
  }

  /** Under the bar: where it stands now, the tokens to spend, and the way on. */
  private footer(next: HTMLElement, actions: HTMLElement, note: string): void {
    const xp = this.progress.xp() ?? 0;
    const tokens = this.progress.tokens();
    const toGo = xpShown(XP.unlock - xpProgress(xp).into);
    next.textContent = note || (tokens > 0 ? `🔓 ${tokens === 1 ? 'An unlock' : `${tokens} unlocks`} to spend!` : `${toGo} XP to your next unlock`);
    next.className = `xp-next${tokens > 0 && !note ? ' ready' : ''}`;
    actions.replaceChildren();
    if (this.progress.unlockable().length) {
      const choose = button('Choose your unlock', () => this.chooser(), 'big');
      choose.id = 'xp-choose';
      actions.append(choose);
    }
    const ok = button('Carry on', () => this.close());
    ok.id = 'xp-ok';
    actions.append(ok);
  }

  /** "Choose your unlock": the characters a token could unlock; tap one to break its padlock. */
  private chooser(): void {
    this.reset();
    const ids = this.progress.unlockable();
    const tokens = this.progress.tokens();
    const title = el('h2', 'xp-title', 'Choose your unlock');
    const note = el('p', 'xp-why', `${tokens} ${tokens === 1 ? 'token' : 'tokens'} to spend · yours to play online`);
    const picks = el('div', 'xp-picks');
    const status = el('p', 'xp-next');
    for (const id of ids) {
      const c = getCharacter(id);
      const b = button('', () => void this.choose(id, b, picks, status), 'xp-pick');
      b.dataset.character = id;
      b.style.setProperty('--c', c.colours[0]!);
      b.append(el('span', 'xp-lock', '🔒'), el('span', 'xp-name', c.name));
      picks.append(b);
    }
    const later = button('Later', () => this.close());
    later.id = 'xp-ok';
    this.card.replaceChildren(title, note, picks, status, later);
    this.root.dataset.state = 'choosing';
  }

  private async choose(id: string, card: HTMLButtonElement, picks: HTMLElement, status: HTMLElement): Promise<void> {
    for (const b of picks.querySelectorAll('button')) b.disabled = true;
    card.classList.add('opening');
    status.textContent = '';
    const ok = await this.progress.unlock(id);
    if (!ok) {
      card.classList.remove('opening');
      status.textContent = 'Couldn’t unlock just now: check your connection and try again.';
      for (const b of picks.querySelectorAll('button')) b.disabled = false;
      return;
    }
    this.opened(card, status, getCharacter(id).name);
    this.later(OPEN_MS, () => (this.progress.unlockable().length ? this.chooser() : this.close()));
  }

  /** A padlock breaking open, for one character on its own (unlockNow); `after` adds the way on. */
  private async pick(id: string, after: (ok: boolean) => void): Promise<boolean> {
    const c = getCharacter(id);
    const card = el('div', 'xp-pick opening');
    card.dataset.character = id;
    card.style.setProperty('--c', c.colours[0]!);
    card.append(el('span', 'xp-lock', '🔒'), el('span', 'xp-name', c.name));
    const status = el('p', 'xp-next');
    this.card.replaceChildren(el('h2', 'xp-title', 'Unlocking…'), card, status);
    this.root.dataset.state = 'choosing';
    const ok = await this.progress.unlock(id);
    if (ok) this.opened(card, status, c.name);
    else {
      card.classList.remove('opening');
      status.textContent = 'Couldn’t unlock just now: check your connection and try again.';
    }
    this.card.querySelector('.xp-title')!.textContent = ok ? 'Unlocked!' : 'Not unlocked';
    after(ok);
    return ok;
  }

  /** The padlock breaks: it shakes, pops open with a burst of sparks, and the character's theirs. */
  private opened(card: HTMLElement, status: HTMLElement, name: string): void {
    card.classList.remove('opening');
    card.classList.add('opened');
    card.querySelector('.xp-lock')!.textContent = '🔓';
    const burst = el('div', 'xp-burst');
    card.append(burst);
    sparks(burst);
    status.textContent = `🔓 ${name} unlocked! Yours to play online.`;
    status.className = 'xp-next ready';
    this.root.dataset.state = 'unlocked';
    this.sound('unlock');
  }

  private open(): void {
    this.root.hidden = false;
  }

  private reset(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.skipTo = null;
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, ms));
  }
}

/** Restart an element's little bump (`.pop`). */
function bump(e: HTMLElement): void {
  e.classList.remove('pop');
  void e.offsetWidth;
  e.classList.add('pop');
}

/** A ring of sparks bursting out (`.xp-burst`). */
function sparks(burst: HTMLElement): void {
  burst.replaceChildren(
    ...Array.from({ length: 14 }, (_, i) => {
      const s = el('span', undefined, i % 2 ? '✦' : '★');
      s.style.setProperty('--a', `${(i * 360) / 14}deg`);
      s.style.setProperty('--d', `${(i % 3) * 0.06}s`);
      return s;
    }),
  );
}

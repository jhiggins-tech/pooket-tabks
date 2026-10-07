/**
 * What the HUD's two spinners share (kie's steal roulette, heist.ts, and Diced Coffee, coffee.ts): an
 * overlay in index.html with a title line first (who's doing it, names in their colours), a result line
 * last that shows • • • (`rolling`) until it lands, and the players' colours as CSS variables.
 */
import { byId, el } from '../../ui/dom';

/** A player as a title names them: in their colour. */
type Named = { name: string; colour: string };

export class Overlay {
  readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly resultEl: HTMLElement;

  constructor(id: string) {
    this.root = byId(id);
    this.titleEl = this.root.firstElementChild as HTMLElement;
    this.resultEl = this.root.lastElementChild as HTMLElement;
  }

  /** Show it (or hide it, with false). */
  show(on: boolean): void {
    this.root.hidden = !on;
  }

  /** Set its CSS variables (`--name`), e.g. the players' colours. */
  vars(vars: Record<string, string>): void {
    for (const [k, v] of Object.entries(vars)) this.root.style.setProperty(`--${k}`, v);
  }

  /** The title: text, and players' names in their colours. */
  title(...parts: (string | Named)[]): void {
    this.titleEl.replaceChildren(...parts.map((x) => (typeof x === 'string' ? x : named(x))));
  }

  /** The result line: `text` once it's landed, null for • • • while it's still rolling. */
  result(text: string | null): void {
    this.resultEl.textContent = text ?? '• • •';
    this.resultEl.classList.toggle('rolling', text === null);
  }
}

function named({ name, colour }: Named): HTMLElement {
  const b = el('b', undefined, name);
  b.style.color = colour;
  return b;
}

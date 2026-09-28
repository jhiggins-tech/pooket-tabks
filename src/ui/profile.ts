import { NAME_MAX } from './seats';

/**
 * Who's playing on this phone: a username asked for the first time the game opens in a browser, saved in
 * localStorage, and used as Player 1's name (hotseat and online: lobby, Games list, spectators). Editing
 * Player 1's name on the setup screen changes it.
 */

export const USERNAME_KEY = 'pooket.username';

/** Tidy a typed name: no control characters, single spaces, trimmed, at most NAME_MAX long. '' if nothing's left. */
export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_MAX).trim();
}

export function loadUsername(): string | null {
  try {
    const name = cleanName(localStorage.getItem(USERNAME_KEY) ?? '');
    return name || null;
  } catch {
    return null; // storage unavailable: ask again next time
  }
}

export function saveUsername(raw: string): string | null {
  const name = cleanName(raw);
  if (!name) return null;
  try {
    localStorage.setItem(USERNAME_KEY, name);
  } catch {
    /* private mode etc.: it lasts this visit */
  }
  return name;
}

/** The first-visit prompt: "What's your name?", until one is saved. */
export class NamePrompt {
  private readonly root = el('div', 'overlay');
  private readonly input = el('input');
  private readonly ok = el('button', 'big');
  private done: ((name: string) => void) | null = null;

  constructor() {
    this.root.id = 'name-prompt';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'What’s your name?');
    const card = el('form', 'name-card');
    const h = el('h2');
    h.textContent = 'What’s your name?';
    const p = el('p');
    p.textContent = 'It’s your player name, here and in online games. You can change it on the setup screen (Player 1).';
    this.input.type = 'text';
    this.input.maxLength = NAME_MAX;
    this.input.setAttribute('autocomplete', 'nickname');
    this.input.enterKeyHint = 'done';
    this.input.placeholder = 'Your name';
    this.input.setAttribute('aria-label', 'Your name');
    this.ok.type = 'submit';
    this.ok.id = 'name-ok';
    this.ok.textContent = 'Let’s play';
    this.input.addEventListener('input', () => this.refresh());
    card.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = saveUsername(this.input.value);
      if (!name) return;
      this.input.blur(); // dismiss the phone keyboard
      this.root.hidden = true;
      this.done?.(name);
      this.done = null;
    });
    card.append(h, p, this.input, this.ok);
    this.root.append(card);
    document.body.append(this.root);
  }

  /** Ask for a name (pre-filled with `suggestion`); resolves once one is saved. */
  ask(suggestion = ''): Promise<string> {
    this.input.value = cleanName(suggestion);
    this.refresh();
    this.root.hidden = false;
    return new Promise((resolve) => (this.done = resolve));
  }

  private refresh(): void {
    this.ok.disabled = cleanName(this.input.value) === '';
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

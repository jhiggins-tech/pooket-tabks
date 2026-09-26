import { AMMO_PER_TIER, getCharacter, ROSTER, type CharacterDef } from '../characters/roster';
import { getWeapon, ignoresAim } from '../weapons/registry';
import type { WeaponDef } from '../weapons/types';

const BASICS = 'basics';

/** How each character gets around with the ◀ ▶ buttons. */
export function movementInfo(c: CharacterDef): { label: string; text: string } {
  return c.movement === 'hop'
    ? { label: 'Frog hops', text: 'Hops instead of driving, over walls a tank can’t climb. Uses the same one tank of fuel.' }
    : { label: 'Drives', text: 'Rolls over small bumps; steep hills and walls stop it.' };
}

/** Little tags for a weapon card: rounds, and whether it needs aiming. */
export function weaponTags(w: WeaponDef, tier: number): string[] {
  const rounds = AMMO_PER_TIER[tier] ?? 1;
  return [`Tier ${tier + 1}`, `${rounds} round${rounds === 1 ? '' : 's'}`, ignoresAim(w) ? 'No aiming' : 'Aimed'];
}

const CONTROLS: [string, string][] = [
  ['Aim', 'Drag anywhere and pull back like a slingshot: the direction is your shot, the pull length is power. Fine-tune with ↺ ↻ and − +.'],
  ['Weapons', 'Pick a tier on the right. Each character has 5 / 3 / 1 rounds of their tier 1 / 2 / 3 weapon.'],
  ['Move', 'Hold ◀ ▶ before you fire. The fuel is one tank for the whole match, so spend it wisely.'],
  ['Fire', 'FIRE ends your turn. Last tank standing wins; if everyone runs out of ammo, most HP wins.'],
];

const STATUSES: [string, string][] = [
  ['✦', 'Burning (Hyperfixate): takes damage at the start of each of their next turns.'],
  ['🍳', 'Cooked (the Rizzler): everything they fire next turn does half damage.'],
  ['✒', 'Tattooed (Tattoo Gun): takes +25% damage from everything for 2 turns.'],
  ['📌', 'Pinned (Sew): can’t move on their next turn.'],
];

/** The in-game info screen: how to play, and what every character's weapons do. */
export class InfoScreen {
  private readonly root = el('div', 'overlay');
  private readonly tabs = el('div', 'info-tabs');
  private readonly body = el('div', 'info-body');
  private tab = BASICS;

  constructor(private readonly colourOf: (characterId: string) => string = (id) => getCharacter(id).colours[0]!) {
    this.root.id = 'info';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Info');
    this.tabs.setAttribute('role', 'tablist');
    const close = el('button', 'info-close');
    close.id = 'info-close';
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Close info');
    close.addEventListener('click', () => this.close());
    const head = el('div', 'info-head');
    head.append(this.tabs, close);
    this.root.append(head, this.body);
    document.body.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Open on a character's page (or the basics). */
  open(characterId: string = BASICS): void {
    this.tab = characterId;
    this.root.hidden = false;
    this.render();
  }

  close(): void {
    this.root.hidden = true;
  }

  private render(): void {
    const tab = (id: string, label: string, colour?: string) => {
      const b = el('button', 'info-tab');
      b.textContent = label;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(id === this.tab));
      if (colour) b.style.setProperty('--c', colour);
      b.addEventListener('click', () => {
        this.tab = id;
        this.render();
      });
      return b;
    };
    this.tabs.replaceChildren(tab(BASICS, 'How to play'), ...ROSTER.map((c) => tab(c.id, c.name, this.colourOf(c.id))));
    this.body.replaceChildren(...(this.tab === BASICS ? basics() : character(getCharacter(this.tab), this.colourOf(this.tab))));
    this.body.scrollTop = 0;
  }
}

function basics(): HTMLElement[] {
  const list = (title: string, rows: [string, string][], cls: string) => {
    const section = el('section', `info-list ${cls}`);
    const h = el('h2');
    h.textContent = title;
    section.append(h);
    for (const [k, v] of rows) {
      const row = el('p');
      const key = el('b');
      key.textContent = k;
      row.append(key, ` ${v}`);
      section.append(row);
    }
    return section;
  };
  const cols = el('div', 'info-cols');
  cols.append(list('Controls', CONTROLS, 'controls'), list('Status effects', STATUSES, 'statuses'));
  return [cols];
}

function character(c: CharacterDef, colour: string): HTMLElement[] {
  const header = el('div', 'info-character');
  header.style.setProperty('--c', colour);
  const name = el('h2');
  name.textContent = c.name;
  const move = movementInfo(c);
  const blurb = el('p');
  blurb.textContent = c.blurb;
  const moves = el('p', 'info-move');
  const label = el('b');
  label.textContent = move.label;
  moves.append(label, ` · ${move.text}`);
  header.append(name, blurb, moves);

  const cards = el('div', 'info-cards');
  cards.style.setProperty('--c', colour);
  c.loadout.forEach((id, tier) => {
    const w = getWeapon(id);
    const card = el('article', 'info-card');
    card.dataset.weapon = w.id;
    const title = el('h3');
    title.textContent = w.name;
    const tags = el('div', 'info-tags');
    for (const t of weaponTags(w, tier)) {
      const tag = el('span');
      tag.textContent = t;
      tags.append(tag);
    }
    const text = el('p');
    text.textContent = w.info;
    card.append(tags, title, text);
    cards.append(card);
  });
  return [header, cards];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

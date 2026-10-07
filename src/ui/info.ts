import { AMMO_PER_TIER, getCharacter, ROSTER, type CharacterDef } from '../characters/roster';
import { upcoming, UPCOMING, type Upcoming } from '../characters/upcoming';
import { getWeapon, ignoresAim, isBonus, kindOf } from '../weapons/registry';
import type { WeaponDef } from '../weapons/types';
import { MAX_HP } from '../game/constants';
import { el } from './dom';

const BASICS = 'basics';

/** How each character gets around with the ◀ ▶ buttons. */
export function movementInfo(c: CharacterDef): { label: string; text: string } {
  if (c.movement === 'hop') return { label: 'Frog hops', text: 'Big frog leaps instead of driving: clears walls and cliffs no tank can climb, and goes twice as far on the same one tank of fuel.' };
  if (c.movement === 'scooter') {
    return {
      label: 'Scooter',
      text: 'Rides a little scooter: 4× as fast as a tank, and 3× as far on the same tank of fuel. But steep hills and walls are a crash: it stops dead and he takes 5 damage (never his last bit of health).',
    };
  }
  return { label: 'Drives', text: 'Rolls over small bumps; steep hills and walls stop it.' };
}

/** Little tags for a weapon card: rounds, and whether it needs aiming. */
export function weaponTags(w: WeaponDef, tier: number): string[] {
  const rounds = AMMO_PER_TIER[tier] ?? 1;
  if (isBonus(w)) return ['Bonus move', kindOf(w) === 'coffee' ? 'Once a turn' : 'Once a match', 'No aiming'];
  return [`Tier ${tier + 1}`, `${rounds} round${rounds === 1 ? '' : 's'}`, ignoresAim(w) ? 'No aiming' : 'Aimed'];
}

const CONTROLS: [string, string][] = [
  ['Aim', 'Drag anywhere and pull back like a slingshot: the direction is your shot, the pull length is power. Fine-tune with ↺ ↻ and − +.'],
  ['Weapons', 'Pick a tier on the right. Each character has 5 / 3 / 1 rounds of their tier 1 / 2 / 3 weapon (larinovsky and garyoldmancorp also have a bonus move).'],
  ['Move', 'Hold ◀ ▶ before you fire. The fuel is one tank for the whole match, so spend it wisely.'],
  ['Fire', 'FIRE ends your turn (except a bonus move). Last tank standing wins; if everyone runs out of ammo, most HP wins.'],
];

const STATUSES: [string, string][] = [
  ['✦', 'Burning (Hyperfixate): takes damage at the start of each of the next 3 turns, anyone’s.'],
  ['🍳', 'Cooked (the Rizzler): everything they fire next turn does half damage.'],
  ['✒', 'Tattooed (Tattoo Gun): takes +25% damage from everything for 2 turns.'],
  ['📌', 'Pinned (Sew): can’t move on their next turn.'],
  ['💅', 'Scamming (Women in Scam): an enemy attack that hits them this coming turn earns them a round of it.'],
  ['☕', 'Caffeinated (Diced Coffee): goes again after this turn; the enemy’s next turn is skipped.'],
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
    const soonTabs = UPCOMING.map((u) => {
      const t = tab(u.id, u.name, u.colour);
      t.classList.add('soon');
      return t;
    });
    this.tabs.replaceChildren(tab(BASICS, 'How to play'), ...ROSTER.map((c) => tab(c.id, c.name, this.colourOf(c.id))), ...soonTabs);
    const soon = upcoming(this.tab);
    this.body.replaceChildren(...(this.tab === BASICS ? basics() : soon ? comingSoon(soon) : characterDetails(getCharacter(this.tab), this.colourOf(this.tab))));
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

/**
 * An upcoming character's page (info screen, Choose your tank): its name, a Coming soon banner, and a
 * card for each move teased so far (work in progress).
 */
export function comingSoon(u: Upcoming): HTMLElement[] {
  const panel = el('div', 'coming-soon');
  panel.style.setProperty('--c', u.colour);
  panel.append(el('h2', undefined, u.name), el('span', 'coming-soon-banner', 'Coming soon'), el('p', undefined, 'On the way: their weapons are still being built. Pick someone else to play for now.'));
  if (!u.teasers?.length) return [panel];
  const cards = el('div', 'info-cards coming-soon-cards');
  cards.style.setProperty('--c', u.colour);
  for (const t of u.teasers) {
    const card = el('article', 'info-card');
    const tags = el('div', 'info-tags');
    tags.append(el('span', undefined, t.slot));
    card.append(tags, el('h3', undefined, t.name), el('p', undefined, 'Details coming soon.'));
    cards.append(card);
  }
  const wip = el('p', 'coming-soon-wip', '🚧 Work in progress: these moves (names and all) are subject to change.');
  return [panel, cards, wip];
}

/**
 * A character picker's options: everyone playable, then (in a "Coming soon" group) the upcoming ones,
 * which can be picked to look at but not played.
 */
export function addCharacterOptions(select: HTMLSelectElement, selected: string): void {
  for (const c of ROSTER) select.add(new Option(c.beta ? `${c.name} (beta)` : c.name, c.id, false, c.id === selected));
  const group = el('optgroup');
  group.label = 'Coming soon';
  for (const u of UPCOMING) group.append(new Option(`${u.name} (soon)`, u.id, false, u.id === selected));
  select.append(group);
}

/** A character's page: name, blurb, how it moves, and a card per weapon (also the tank picker's). */
export function characterDetails(c: CharacterDef, colour: string): HTMLElement[] {
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
  const health = el('p', 'info-move info-health');
  const hp = c.maxHp ?? MAX_HP;
  health.append(Object.assign(el('b'), { textContent: 'Health' }), ` · ${hp}${hp > MAX_HP ? ` (most start with ${MAX_HP})` : ''}`);
  header.append(name, ...(c.beta ? [el('span', 'beta-banner', 'Beta: stand-in moves for now')] : []), blurb, moves, health);

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

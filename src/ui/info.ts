import { onlineLock } from '../characters/access';
import { AMMO_PER_TIER, fullAmmo, getCharacter, ROSTER, type CharacterDef } from '../characters/roster';
import { upcoming, UPCOMING, type Upcoming } from '../characters/upcoming';
import { kindRow } from '../weapons/kinds';
import { getWeapon, ignoresAim, isBonus, kindOf } from '../weapons/registry';
import type { WeaponDef } from '../weapons/types';
import { MAX_HP } from '../game/constants';
import { closeButton, dialog, el, tabBar } from './dom';
import { statusInfo } from './status-looks';

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
  const rounds = fullAmmo(tier);
  const row = kindRow(kindOf(w));
  if (row.turn === 'bonus') return ['Bonus move', row.per === 'turn' ? 'Once a turn' : 'Once a match', 'No aiming'];
  return [`Tier ${tier + 1}`, `${rounds} round${rounds === 1 ? '' : 's'}`, ignoresAim(w) ? 'No aiming' : 'Aimed'];
}

/** The characters with a bonus move as well as their three weapons, by name: "a and b" (or "a, b and c"). */
function bonusCharacters(): string {
  const names = ROSTER.filter((c) => c.loadout.slice(3).some((id) => isBonus(getWeapon(id)))).map((c) => c.name);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '');
}

/** How to play: the controls (the rounds per tier from the roster). */
function controls(): [string, string][] {
  const tiers = AMMO_PER_TIER.slice(0, 3);
  const bonus = bonusCharacters();
  return [
    ['Aim', 'Drag anywhere and pull back like a slingshot: the direction is your shot, the pull length is power. Fine-tune with ↺ ↻ and − +.'],
    ['Weapons', `Pick a tier on the right. Each character has ${tiers.join(' / ')} rounds of their tier ${tiers.map((_, i) => i + 1).join(' / ')} weapon${bonus ? ` (${bonus} also have a bonus move)` : ''}.`],
    ['Move', 'Hold ◀ ▶ before you fire. The fuel is one tank for the whole match, so spend it wisely.'],
    ['Fire', 'FIRE ends your turn (except a bonus move). Last tank standing wins; if everyone runs out of ammo, most HP wins.'],
  ];
}

/** The in-game info screen: how to play, and what every character's weapons do. */
export class InfoScreen {
  private readonly root = dialog('info', 'Info');
  private readonly tabs = tabBar();
  private readonly body = el('div', 'info-body');
  private tab = BASICS;

  constructor(private readonly colourOf: (characterId: string) => string = (id) => getCharacter(id).colours[0]!) {
    const head = el('div', 'info-head');
    head.append(this.tabs.el, closeButton('info-close', 'Close info', () => this.close()));
    this.root.append(head, this.body);
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
    this.tabs.show(
      [
        { id: BASICS, label: 'How to play' },
        ...ROSTER.map((c) => ({ id: c.id, label: c.name, colour: this.colourOf(c.id) })),
        ...UPCOMING.map((u) => ({ id: u.id, label: u.name, colour: u.colour, className: 'soon' })),
      ],
      this.tab,
      (id) => {
        this.tab = id;
        this.render();
      },
    );
    const soon = upcoming(this.tab);
    this.body.replaceChildren(...(this.tab === BASICS ? basics() : soon ? comingSoon(soon) : characterDetails(getCharacter(this.tab), this.colourOf(this.tab))));
    this.body.scrollTop = 0;
  }
}

function basics(): HTMLElement[] {
  const list = (title: string, rows: [string, string][], cls: string) => {
    const section = el('section', `info-list ${cls}`);
    section.append(el('h2', undefined, title));
    for (const [k, v] of rows) {
      const row = el('p');
      row.append(el('b', undefined, k), ` ${v}`);
      section.append(row);
    }
    return section;
  };
  const cols = el('div', 'info-cols');
  cols.append(list('Controls', controls(), 'controls'), list('Status effects', statusInfo(), 'statuses'));
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
 * which can be picked to look at but not played. `online`: the online tank picker, where those that can't
 * be played online (characters/access.ts) say so.
 */
export function addCharacterOptions(select: HTMLSelectElement, selected: string, online = false): void {
  for (const c of ROSTER) {
    const label = c.beta ? `${c.name} (beta${online ? ', hotseat only' : ''})` : c.name;
    select.add(new Option(online && onlineLock(c.id) ? `🔒 ${label}` : label, c.id, false, c.id === selected));
  }
  const group = el('optgroup');
  group.label = 'Coming soon';
  for (const u of UPCOMING) group.append(new Option(`${u.name} (soon)`, u.id, false, u.id === selected));
  select.append(group);
}

/** A character's page: name, blurb, how it moves, and a card per weapon (also the tank picker's). */
export function characterDetails(c: CharacterDef, colour: string): HTMLElement[] {
  const header = el('div', 'info-character');
  header.style.setProperty('--c', colour);
  const name = el('h2', undefined, c.name);
  const move = movementInfo(c);
  const blurb = el('p', undefined, c.blurb);
  const moves = el('p', 'info-move');
  moves.append(el('b', undefined, move.label), ` · ${move.text}`);
  const health = el('p', 'info-move info-health');
  const hp = c.maxHp ?? MAX_HP;
  health.append(el('b', undefined, 'Health'), ` · ${hp}${hp > MAX_HP ? ` (most start with ${MAX_HP})` : ''}`);
  header.append(name, ...(c.beta ? [el('span', 'beta-banner', 'Beta: stand-in moves for now')] : []), blurb, moves, health);

  const cards = el('div', 'info-cards');
  cards.style.setProperty('--c', colour);
  c.loadout.forEach((id, tier) => {
    const w = getWeapon(id);
    const card = el('article', 'info-card');
    card.dataset.weapon = w.id;
    const tags = el('div', 'info-tags');
    for (const t of weaponTags(w, tier)) tags.append(el('span', undefined, t));
    card.append(tags, el('h3', undefined, w.name), el('p', undefined, w.info));
    cards.append(card);
  });
  return [header, cards];
}

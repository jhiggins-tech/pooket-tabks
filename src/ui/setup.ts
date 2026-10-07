import { assignColours, getCharacter, loadoutSummary, matchPlayers } from '../characters/roster';
import { upcoming } from '../characters/upcoming';
import type { PlayerConfig } from '../game/state';
import { readJson, writeJson } from '../core/storage';
import { byId, el } from './dom';
import { addCharacterOptions } from './info';
import { loadUsername } from './profile';
import { changeCharacter, NAME_MAX, parseSeats, resolveNames, type Seat } from './seats';

const STORAGE_KEY = 'pooket-tabks.setup.v2';

/**
 * Local hotseat: two players on one phone, each picking a character (name pre-filled, editable), then
 * Start battle. Player 1 starts out as this phone's player (the saved username, profile.ts); names typed
 * here are just for the match (the username changes from the landing screen). A seat can look at an
 * upcoming character ("Coming soon", characters/upcoming.ts): its real pick stays as it was, and Start
 * waits until every seat has someone playable.
 */
export class SetupScreen {
  private readonly root = byId('hotseat');
  private readonly list = byId('setup-players');
  private seats: Seat[] = loadSeats();
  /** An upcoming character a seat is looking at (not playable), by seat. */
  private previews: (string | null)[] = this.seats.map(() => null);
  private readonly start = byId<HTMLButtonElement>('start');
  private you: string | null = loadUsername();

  constructor(onStart: (players: PlayerConfig[]) => void) {
    if (this.you) this.seats[0]!.name = this.you;
    this.start.addEventListener('click', () => {
      if (this.previews.some(Boolean)) return;
      (document.activeElement as HTMLElement | null)?.blur(); // dismiss the phone keyboard
      saveSeats(this.seats);
      onStart(this.players());
    });
    this.render();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    if (this.you) this.seats[0]!.name = this.you; // you again, whoever it was last time
    this.root.hidden = false;
    this.render();
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** Player 1's name before there's a username (to suggest one), unless it's just their character's. */
  suggestedName(): string {
    const seat = this.seats[0]!;
    return seat.name.trim() === getCharacter(seat.characterId).name ? '' : seat.name;
  }

  /** The username was set (or changed): it's Player 1's name. */
  setUsername(name: string): void {
    this.you = name;
    this.seats[0]!.name = name;
    this.render();
  }

  players(): PlayerConfig[] {
    const names = resolveNames(this.seats);
    return matchPlayers(this.seats.map((s, i) => ({ name: names[i]!, characterId: s.characterId })));
  }

  private render(): void {
    const colours = assignColours(this.seats.map((s) => s.characterId));
    const cards = this.seats.map((seat, i) => this.card(seat, i, colours[i]!));
    const vs = el('span', 'seats-vs', 'vs');
    this.list.replaceChildren(...cards.flatMap((c, i) => (i ? [vs.cloneNode(true) as HTMLElement, c] : [c])));
    const waiting = this.previews.some(Boolean);
    this.start.disabled = waiting;
    this.start.textContent = waiting ? 'Pick a playable character' : 'Start battle';
  }

  private card(seat: Seat, i: number, colour: string): HTMLElement {
    const soon = upcoming(this.previews[i] ?? '');
    const card = el('div', 'seat-card');
    card.style.setProperty('--c', soon?.colour ?? colour);

    const label = el('span', 'seat', `PLAYER ${i + 1}`);

    const character = el('select');
    character.setAttribute('aria-label', `Player ${i + 1} character`);
    addCharacterOptions(character, soon?.id ?? seat.characterId);
    character.addEventListener('change', () => {
      if (upcoming(character.value)) this.previews[i] = character.value;
      else {
        this.previews[i] = null;
        this.seats[i] = changeCharacter(seat, character.value);
      }
      this.render();
    });

    const name = el('input');
    name.type = 'text';
    name.maxLength = NAME_MAX;
    name.placeholder = getCharacter(seat.characterId).name;
    name.value = seat.name;
    name.autocomplete = 'off';
    name.enterKeyHint = 'done';
    name.setAttribute('aria-label', `Player ${i + 1} name`);
    name.addEventListener('input', () => (seat.name = name.value));
    name.addEventListener('keydown', (e) => e.key === 'Enter' && name.blur());

    if (soon) {
      card.append(label, character, el('span', 'coming-soon-banner', 'Coming soon'));
      return card;
    }
    const loadout = el('span', 'loadout', loadoutSummary(getCharacter(seat.characterId)));

    card.append(label, character, name, loadout);
    return card;
  }
}

/** The last hotseat picks (the defaults if there are none, or they're unreadable). */
function loadSeats(): Seat[] {
  return parseSeats(readJson(STORAGE_KEY));
}

function saveSeats(seats: Seat[]): void {
  writeJson(STORAGE_KEY, seats); // not critical if it doesn't stick
}

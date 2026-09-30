import { assignColours, getCharacter, loadoutSummary, ROSTER } from '../characters/roster';
import type { PlayerConfig } from '../game/state';
import { loadUsername } from './profile';
import { changeCharacter, NAME_MAX, parseSeats, resolveNames, type Seat } from './seats';

const STORAGE_KEY = 'pooket-tabks.setup.v2';

/**
 * Local hotseat: two players on one phone, each picking a character (name pre-filled, editable), then
 * Start battle. Player 1 starts out as this phone's player (the saved username, profile.ts); names typed
 * here are just for the match (the username changes from the landing screen).
 */
export class SetupScreen {
  private readonly root = document.getElementById('hotseat')!;
  private readonly list = document.getElementById('setup-players')!;
  private seats: Seat[] = loadSeats();
  private you: string | null = loadUsername();

  constructor(onStart: (players: PlayerConfig[]) => void) {
    if (this.you) this.seats[0]!.name = this.you;
    document.getElementById('start')!.addEventListener('click', () => {
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
    const colours = assignColours(this.seats.map((s) => s.characterId));
    const names = resolveNames(this.seats);
    return this.seats.map((s, i) => ({ name: names[i]!, characterId: s.characterId, colour: colours[i]! }));
  }

  private render(): void {
    const colours = assignColours(this.seats.map((s) => s.characterId));
    const cards = this.seats.map((seat, i) => this.card(seat, i, colours[i]!));
    const vs = document.createElement('span');
    vs.className = 'seats-vs';
    vs.textContent = 'vs';
    this.list.replaceChildren(...cards.flatMap((c, i) => (i ? [vs.cloneNode(true) as HTMLElement, c] : [c])));
  }

  private card(seat: Seat, i: number, colour: string): HTMLElement {
    const card = document.createElement('div');
    card.className = 'seat-card';
    card.style.setProperty('--c', colour);

    const label = document.createElement('span');
    label.className = 'seat';
    label.textContent = `PLAYER ${i + 1}`;

    const character = document.createElement('select');
    character.setAttribute('aria-label', `Player ${i + 1} character`);
    for (const c of ROSTER) character.add(new Option(c.name, c.id, false, c.id === seat.characterId));
    character.addEventListener('change', () => {
      this.seats[i] = changeCharacter(seat, character.value);
      this.render();
    });

    const name = document.createElement('input');
    name.type = 'text';
    name.maxLength = NAME_MAX;
    name.placeholder = getCharacter(seat.characterId).name;
    name.value = seat.name;
    name.autocomplete = 'off';
    name.enterKeyHint = 'done';
    name.setAttribute('aria-label', `Player ${i + 1} name`);
    name.addEventListener('input', () => (seat.name = name.value));
    name.addEventListener('keydown', (e) => e.key === 'Enter' && name.blur());

    const loadout = document.createElement('span');
    loadout.className = 'loadout';
    loadout.textContent = loadoutSummary(getCharacter(seat.characterId));

    card.append(label, character, name, loadout);
    return card;
  }
}

function loadSeats(): Seat[] {
  try {
    return parseSeats(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return parseSeats(null); // storage unavailable or corrupt
  }
}

function saveSeats(seats: Seat[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seats));
  } catch {
    /* private mode etc. — not critical */
  }
}

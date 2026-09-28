import { assignColours, getCharacter, loadoutSummary, ROSTER } from '../characters/roster';
import type { PlayerConfig } from '../game/state';
import { loadUsername, saveUsername } from './profile';
import { changeCharacter, NAME_MAX, parseSeats, resolveNames, type Seat } from './seats';

const STORAGE_KEY = 'pooket-tabks.setup.v2';

/**
 * Pre-battle screen: two seats, each picking a character (name pre-filled, editable). Player 1 is this
 * phone's player: their name is the saved username (profile.ts), and editing it changes the username.
 */
export class SetupScreen {
  private readonly root = document.getElementById('setup')!;
  private readonly list = document.getElementById('setup-players')!;
  private seats: Seat[] = loadSeats();
  private you: string | null = loadUsername();

  constructor(onStart: (players: PlayerConfig[]) => void) {
    if (this.you) this.seats[0]!.name = this.you;
    document.getElementById('start')!.addEventListener('click', () => {
      (document.activeElement as HTMLElement | null)?.blur(); // dismiss the phone keyboard
      this.keepName(this.seats[0]!);
      saveSeats(this.seats);
      onStart(this.players());
    });
    this.render();
  }

  show(): void {
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
    this.list.replaceChildren(...this.seats.map((seat, i) => this.row(seat, i, colours[i]!)));
  }

  private row(seat: Seat, i: number, colour: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'setup-row';
    row.style.setProperty('--c', colour);

    const swatch = document.createElement('span');
    swatch.className = 'swatch';

    const character = document.createElement('select');
    character.setAttribute('aria-label', `Player ${i + 1} character`);
    for (const c of ROSTER) character.add(new Option(c.name, c.id, false, c.id === seat.characterId));
    character.addEventListener('change', () => {
      this.seats[i] = changeCharacter(seat, character.value);
      if (i === 0 && this.you) this.seats[i]!.name = this.you; // you're still you
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
    if (i === 0) {
      name.addEventListener('change', () => {
        this.keepName(seat);
        name.value = seat.name;
      });
    }

    const loadout = document.createElement('span');
    loadout.className = 'loadout';
    loadout.textContent = loadoutSummary(getCharacter(seat.characterId));

    const label = document.createElement('span');
    label.className = 'seat';
    label.textContent = `P${i + 1}`;

    row.append(label, swatch, character, name, loadout);
    return row;
  }

  /** Player 1's name, once edited, is the new username (a blank one goes back to the old). */
  private keepName(seat: Seat): void {
    const saved = saveUsername(seat.name);
    if (saved) this.you = saved;
    if (this.you) seat.name = this.you;
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

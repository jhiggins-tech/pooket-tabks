import { assignColours, getCharacter, loadoutSummary, ROSTER } from '../characters/roster';
import type { PlayerConfig } from '../game/state';
import { changeCharacter, NAME_MAX, parseSeats, resolveNames, type Seat } from './seats';

const STORAGE_KEY = 'pooket-tabks.setup.v2';

/** Pre-battle screen: two seats, each picking a character (name pre-filled, editable). */
export class SetupScreen {
  private readonly root = document.getElementById('setup')!;
  private readonly list = document.getElementById('setup-players')!;
  private seats: Seat[] = loadSeats();

  constructor(onStart: (players: PlayerConfig[]) => void) {
    document.getElementById('start')!.addEventListener('click', () => {
      (document.activeElement as HTMLElement | null)?.blur(); // dismiss the phone keyboard
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

    const label = document.createElement('span');
    label.className = 'seat';
    label.textContent = `P${i + 1}`;

    row.append(label, swatch, character, name, loadout);
    return row;
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

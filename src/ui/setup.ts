import { assignColours, getCharacter, isCharacterId, loadoutSummary, ROSTER } from '../characters/roster';
import type { PlayerConfig } from '../game/state';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
const NAME_MAX = 12;
const STORAGE_KEY = 'pooket-tabks.setup.v1';

interface Seat {
  name: string;
  characterId: string;
}

/** Pre-battle screen: 2–4 seats, each with a name and a character from the roster. */
export class SetupScreen {
  private readonly root = document.getElementById('setup')!;
  private readonly list = document.getElementById('setup-players')!;
  private readonly addBtn = document.getElementById('add-player') as HTMLButtonElement;
  private seats: Seat[] = loadSeats();

  constructor(onStart: (players: PlayerConfig[]) => void) {
    this.addBtn.addEventListener('click', () => {
      if (this.seats.length >= MAX_PLAYERS) return;
      this.seats.push({ name: '', characterId: ROSTER[0]!.id });
      this.render();
      this.list.querySelector<HTMLInputElement>('.setup-row:last-child input')?.focus();
    });
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
    return this.seats.map((s, i) => ({
      name: s.name.trim() || defaultName(i),
      characterId: s.characterId,
      colour: colours[i]!,
    }));
  }

  private render(): void {
    const colours = assignColours(this.seats.map((s) => s.characterId));
    this.list.replaceChildren(...this.seats.map((seat, i) => this.row(seat, i, colours[i]!)));
    this.addBtn.hidden = this.seats.length >= MAX_PLAYERS;
  }

  private row(seat: Seat, i: number, colour: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'setup-row';
    row.style.setProperty('--c', colour);

    const swatch = document.createElement('span');
    swatch.className = 'swatch';

    const name = document.createElement('input');
    name.type = 'text';
    name.maxLength = NAME_MAX;
    name.placeholder = defaultName(i);
    name.value = seat.name;
    name.autocomplete = 'off';
    name.enterKeyHint = 'done';
    name.setAttribute('aria-label', `Player ${i + 1} name`);
    name.addEventListener('input', () => (seat.name = name.value));
    name.addEventListener('keydown', (e) => e.key === 'Enter' && name.blur());

    const character = document.createElement('select');
    character.setAttribute('aria-label', `Player ${i + 1} character`);
    for (const c of ROSTER) character.add(new Option(c.name, c.id, false, c.id === seat.characterId));
    const loadout = document.createElement('span');
    loadout.className = 'loadout';
    loadout.textContent = loadoutSummary(getCharacter(seat.characterId));
    character.addEventListener('change', () => {
      seat.characterId = character.value;
      this.render();
    });

    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove player ${i + 1}`);
    remove.disabled = this.seats.length <= MIN_PLAYERS;
    remove.addEventListener('click', () => {
      this.seats.splice(i, 1);
      this.render();
    });

    row.append(swatch, name, character, loadout, remove);
    return row;
  }
}

function defaultName(i: number): string {
  return `Player ${i + 1}`;
}

function loadSeats(): Seat[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (Array.isArray(raw)) {
      const seats = raw
        .filter((s): s is Seat => typeof s?.name === 'string' && isCharacterId(s?.characterId))
        .slice(0, MAX_PLAYERS)
        .map((s) => ({ name: s.name.slice(0, NAME_MAX), characterId: s.characterId }));
      if (seats.length >= MIN_PLAYERS) return seats;
    }
  } catch {
    /* storage unavailable or corrupt: use defaults */
  }
  return Array.from({ length: MIN_PLAYERS }, () => ({ name: '', characterId: ROSTER[0]!.id }));
}

function saveSeats(seats: Seat[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seats));
  } catch {
    /* private mode etc. — not critical */
  }
}

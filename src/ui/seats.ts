import { getCharacter, isCharacterId, ROSTER } from '../characters/roster';

/** Proof of concept: every match is exactly two players. */
export const PLAYER_COUNT = 2;
export const NAME_MAX = 12;

export interface Seat {
  name: string;
  characterId: string;
}

/** Player n starts as the nth character, with their name pre-filled. */
export function defaultSeats(): Seat[] {
  return Array.from({ length: PLAYER_COUNT }, (_, i) => {
    const c = ROSTER[i % ROSTER.length]!;
    return { name: c.name, characterId: c.id };
  });
}

/**
 * Switch a seat's character. The name follows the character unless the player
 * typed their own.
 */
export function changeCharacter(seat: Seat, characterId: string): Seat {
  const trimmed = seat.name.trim();
  const followsCharacter = trimmed === '' || trimmed === getCharacter(seat.characterId).name;
  return { characterId, name: followsCharacter ? getCharacter(characterId).name : seat.name };
}

/** Final display names: blank falls back to the character name; duplicates get a number. */
export function resolveNames(seats: readonly Seat[]): string[] {
  const seen = new Map<string, number>();
  return seats.map((s) => {
    const base = s.name.trim() || getCharacter(s.characterId).name;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} ${n}`;
  });
}

/** Validate seats restored from storage; fall back to defaults if anything is off. */
export function parseSeats(raw: unknown): Seat[] {
  if (!Array.isArray(raw) || raw.length !== PLAYER_COUNT) return defaultSeats();
  const ok = raw.every((s) => typeof s?.name === 'string' && isCharacterId(s?.characterId));
  if (!ok) return defaultSeats();
  return raw.map((s: Seat) => ({ name: s.name.slice(0, NAME_MAX), characterId: s.characterId }));
}

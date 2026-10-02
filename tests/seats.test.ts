import { describe, expect, it } from 'vitest';
import { changeCharacter, defaultSeats, parseSeats, PLAYER_COUNT, resolveNames } from '../src/ui/seats';

describe('setup seats', () => {
  it('defaults to two players, tones2 vs kie, with names pre-filled', () => {
    expect(PLAYER_COUNT).toBe(2);
    expect(defaultSeats()).toEqual([
      { name: 'tones2', characterId: 'tones' },
      { name: 'kie', characterId: 'kie' },
    ]);
  });

  it('name follows the character until the player types their own', () => {
    expect(changeCharacter({ name: 'tones2', characterId: 'tones' }, 'kcaj')).toEqual({
      name: 'kcaj',
      characterId: 'kcaj',
    });
    expect(changeCharacter({ name: '', characterId: 'tones' }, 'kie').name).toBe('kie');
    expect(changeCharacter({ name: 'Jack', characterId: 'tones' }, 'kcaj')).toEqual({
      name: 'Jack',
      characterId: 'kcaj',
    });
  });

  it('resolves blank names to the character and numbers duplicates', () => {
    expect(
      resolveNames([
        { name: '', characterId: 'kie' },
        { name: 'kie', characterId: 'kie' },
      ]),
    ).toEqual(['kie', 'kie 2']);
  });

  it('restores valid saved seats and rejects anything else', () => {
    const saved = [
      { name: 'Jack', characterId: 'kcaj' },
      { name: 'Sam', characterId: 'tones' },
    ];
    expect(parseSeats(saved)).toEqual(saved);
    expect(parseSeats(null)).toEqual(defaultSeats());
    expect(parseSeats([{ name: 'x', characterId: 'rookie' }, saved[1]])).toEqual(defaultSeats());
    expect(parseSeats([...saved, saved[0]])).toEqual(defaultSeats()); // wrong player count
  });

  it('a seat saved under a character’s old name (tones, now tones2) follows the character', () => {
    const seats = parseSeats([
      { name: 'tones', characterId: 'tones' },
      { name: 'tones', characterId: 'kie' }, // someone who typed "tones" for kie keeps it
    ]);
    expect(seats.map((s) => s.name)).toEqual(['tones2', 'tones']);
    expect(changeCharacter(seats[0]!, 'kcaj').name).toBe('kcaj');
  });
});

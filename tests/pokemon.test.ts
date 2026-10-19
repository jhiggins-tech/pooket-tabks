import { describe, expect, it } from 'vitest';
import { calculated, whosThatPokemon } from '../src/characters/kits';
import { FIXED_DT } from '../src/game/constants';
import {
  GUESS_OUTRO,
  answerGuess,
  canFire,
  canUseSlot,
  fire,
  guessClock,
  guessLeft,
  guessReady,
  isPokemon,
  missingNoNext,
  pokedexDown,
  selectTier,
  step,
} from '../src/game/game';
import { tracerOffsets } from '../src/game/projectiles';
import type { GameState } from '../src/game/state';
import { applyPreview, previewOf } from '../src/net/follow';
import { upgradeSnapshot, type Snapshot } from '../src/net/snapshot';
import { MISSINGNO, POKEDEX_SIZE, POKEMON, pokemonName, pokemonSprite } from '../src/weapons/pokedex';
import { passTurn, run, testGame, untilNextTurn, whileFlying } from './support/game';

const players = [
  { name: 'fox', colour: '#fb923c', characterId: 'doctorfox' },
  { name: 'kie', colour: '#4ea8ff', characterId: 'kie' },
];

/** doctorfox at 300 and kie at 700, on flat ground; fox to play, with Who's That Pokémon? selected. */
function game(seed = 3): GameState {
  const g = testGame({ seed, players, xs: [300, 700] });
  g.current = 0;
  selectTier(g, 3);
  return g;
}

/** FIRE: the silhouette goes up. */
function ask(g: GameState): void {
  expect(fire(g)).toBe(false); // it's fired once it's answered
  expect(g.phase).toBe('guessing');
}

/** Name it right (or wrong), fire it, and let the answer show: back to aiming. */
function guess(g: GameState, right: boolean): void {
  const q = g.guess!;
  const i = q.options.indexOf(q.dex);
  answerGuess(g, right ? i : (i + 1) % q.options.length);
  expect(guessReady(g)).toBe(true);
  expect(fire(g)).toBe(true);
  run(g, GUESS_OUTRO + 0.05);
}

const cues = (g: GameState) => g.sfx.map((e) => e.cue);

describe('the Pokédex', () => {
  it('has all 1025, each named once, with pictures on PokeAPI', () => {
    expect(POKEMON).toHaveLength(POKEDEX_SIZE);
    expect(new Set(POKEMON).size).toBe(POKEDEX_SIZE);
    expect(pokemonName(1)).toBe('Bulbasaur');
    expect(pokemonName(25)).toBe('Pikachu');
    expect(pokemonName(1025)).toBe('Pecharunt');
    expect(pokemonName(MISSINGNO)).toBe('MissingNo.');
    expect(pokemonSprite(25)).toBe('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png');
  });
});

describe("doctorfox's Who's That Pokémon?", () => {
  it('is his bonus move: FIRE puts up a silhouette and four different names, the right one among them', () => {
    const g = game();
    const fox = g.players[0]!;
    expect(fox.loadout[3]).toBe(whosThatPokemon.id);
    expect(isPokemon(fox, 3)).toBe(true);
    expect(fox.ammo[3]).toBe(1);
    ask(g);
    const q = g.guess!;
    expect(q.dex).toBeGreaterThanOrEqual(1);
    expect(q.dex).toBeLessThanOrEqual(POKEDEX_SIZE);
    expect(q.options).toHaveLength(4);
    expect(new Set(q.options).size).toBe(4);
    expect(q.options).toContain(q.dex);
    expect(canFire(g)).toBe(false);
    expect(cues(g)).toContain('pokemon');
  });

  it('picks with the seed: the same match, the same Pokémon; and the right answer isn’t always in the same place', () => {
    const pick = (seed: number) => {
      const g = game(seed);
      ask(g);
      return g.guess!;
    };
    expect(pick(5)).toEqual(pick(5));
    const places = new Set(Array.from({ length: 12 }, (_, i) => pick(i + 1)).map((q) => q.options.indexOf(q.dex)));
    expect(places.size).toBeGreaterThan(1);
  });

  it('a right answer gives a round of Calculated back, up to full, and the turn carries on', () => {
    const g = game();
    const fox = g.players[0]!;
    fox.ammo[0] = 3;
    ask(g);
    guess(g, true);
    expect(fox.ammo[0]).toBe(4);
    expect(fox.ammo[3]).toBe(1); // still his
    expect(g.phase).toBe('aiming');
    expect(g.current).toBe(0);
    expect(fox.selectedTier).toBe(0);
    expect(cues(g)).toContain('pokemon-right');
    // Full stays full.
    const h = game();
    ask(h);
    guess(h, true);
    expect(h.players[0]!.ammo[0]).toBe(5);
  });

  it('is once a turn: not again until his next turn', () => {
    const g = game();
    const fox = g.players[0]!;
    ask(g);
    guess(g, true);
    expect(canUseSlot(g, fox, 3)).toBe(false);
    expect(selectTier(g, 3)).toBe(false);
    passTurn(g);
    passTurn(g);
    expect(g.current).toBe(0);
    expect(canUseSlot(g, fox, 3)).toBe(true);
  });

  it('a wrong answer (or none in time) loses it for the match, and the turn still carries on', () => {
    const g = game();
    const fox = g.players[0]!;
    ask(g);
    guess(g, false);
    expect(fox.ammo[3]).toBe(0);
    expect(fox.ammo[0]).toBe(5);
    expect(g.phase).toBe('aiming');
    expect(g.current).toBe(0);
    expect(cues(g)).toContain('pokemon-wrong');

    const h = game();
    ask(h);
    expect(guessLeft(h)).toBe(10);
    for (let t = 0; t < 10.05; t += FIXED_DT) guessClock(h, FIXED_DT);
    expect(guessReady(h)).toBe(true);
    expect(h.guess!.picked).toBeNull();
    expect(fire(h)).toBe(true);
    run(h, GUESS_OUTRO + 0.05);
    expect(h.players[0]!.ammo[3]).toBe(0);
  });

  it('his sixth go is always MissingNo., and it glitches out for good whatever he picks', () => {
    const g = game();
    const fox = g.players[0]!;
    for (let go = 1; go <= 5; go++) {
      expect(missingNoNext(fox, 3)).toBe(false);
      selectTier(g, 3);
      ask(g);
      expect(g.guess!.dex).not.toBe(MISSINGNO);
      guess(g, true);
      passTurn(g);
      passTurn(g);
    }
    expect(missingNoNext(fox, 3)).toBe(true);
    selectTier(g, 3);
    ask(g);
    expect(g.guess!.dex).toBe(MISSINGNO);
    expect(cues(g)).toContain('missingno');
    answerGuess(g, 0);
    expect(fire(g)).toBe(true);
    run(g, GUESS_OUTRO + 0.05);
    expect(fox.ammo[3]).toBe(0);
    expect(fox.pokemon!.tries).toBe(6);
    expect(g.phase).toBe('aiming');
  });

  it('with only it left, there’s nothing to fire, so the turn ends after it', () => {
    const g = game();
    const fox = g.players[0]!;
    fox.ammo = [0, 0, 0, 1];
    ask(g);
    guess(g, true);
    // It gave a round of Calculated back, so there's a shot after all.
    expect(g.phase).toBe('aiming');
    expect(fox.selectedTier).toBe(0);
    const h = game();
    h.players[0]!.ammo = [0, 0, 0, 1];
    ask(h);
    guess(h, false);
    expect(h.phase).not.toBe('aiming');
    untilNextTurn(h);
    expect(h.current).toBe(1);
  });

  it('with no picture, it’s called off and nothing is spent', () => {
    const g = game();
    const other = game();
    ask(g);
    applyPreview(other, structuredClone(previewOf(g)));
    expect(other.phase).toBe('guessing');
    pokedexDown(g);
    expect(g.phase).toBe('aiming');
    expect(g.guess).toBeNull();
    expect(g.players[0]!.ammo[3]).toBe(1);
    expect(g.players[0]!.pokemon).toBeNull();
    // The other phone takes it down too.
    applyPreview(other, structuredClone(previewOf(g)));
    expect(other.phase).toBe('aiming');
    expect(other.guess).toBeNull();
  });

  it('the other phone follows it in the previews, and plays out the same answer from the pre-fire state', () => {
    const a = game();
    const b = game();
    // (Over the wire, as a copy.)
    const send = () => structuredClone(previewOf(a));
    ask(a);
    applyPreview(b, send());
    expect(b.phase).toBe('guessing');
    expect(b.guess).toEqual(a.guess);
    const q = a.guess!;
    answerGuess(a, q.options.indexOf(q.dex));
    applyPreview(b, send());
    expect(b.guess!.picked).toBe(a.guess!.picked);
    a.players[0]!.ammo[0] = b.players[0]!.ammo[0] = 2;
    expect(fire(a)).toBe(true);
    expect(fire(b)).toBe(true);
    // Once fired, a late preview doesn't put it back up.
    run(b, GUESS_OUTRO + 0.05);
    applyPreview(b, { ...send(), guess: { ...q, outro: null, done: false, picked: null } });
    expect(b.phase).toBe('aiming');
    run(a, GUESS_OUTRO + 0.05);
    expect(a.players[0]!.ammo[0]).toBe(3);
    expect(b.players[0]!.ammo[0]).toBe(3);
  });

  it('can’t be stolen (no bonus move can: Diced Coffee, Women in Scam, the digger neither)', () => {
    const g = testGame({ seed: 3, players: [players[1]!, players[0]!], xs: [300, 700] });
    g.current = 0;
    const fox = g.players[1]!;
    fox.ammo = [0, 0, 0, 1];
    selectTier(g, 2);
    expect(fire(g)).toBe(false); // nothing to steal: only the bonus move has a round
    expect(g.phase).toBe('aiming');
    for (const enemy of ['garyoldmancorp', 'larinovsky', 'shotdownboyz']) {
      const h = testGame({ seed: 3, players: [players[1]!, { name: enemy, colour: '#ff5a5f', characterId: enemy }], xs: [300, 700] });
      h.current = 0;
      const victim = h.players[1]!;
      victim.ammo = victim.ammo.map((_, tier) => (tier < 3 ? 0 : 1));
      selectTier(h, 2);
      expect(fire(h), enemy).toBe(false);
    }
  });

  it('a stored match from before it fills in', () => {
    const g = game();
    const snap = JSON.parse(JSON.stringify({ ...g, terrain: undefined, rng: g.rng.state, fx: undefined })) as Snapshot & { guess?: unknown };
    delete snap.guess;
    for (const p of snap.players as { pokemon?: unknown }[]) delete p.pokemon;
    const up = upgradeSnapshot(snap) as Snapshot & { guess: unknown; players: { pokemon: unknown }[] };
    expect(up.guess).toBeNull();
    expect(up.players[0]!.pokemon).toBeNull();
  });
});

describe("doctorfox's Calculated", () => {
  it('is his tier 1: a plasma ball, and three harmless tracers either side, 10° apart', () => {
    expect(tracerOffsets(calculated)).toEqual([-10, 10, -20, 20, -30, 30]);
    const g = game();
    selectTier(g, 0);
    const fox = g.players[0]!;
    fox.angle = 45;
    fox.power = 60;
    expect(fire(g)).toBe(true);
    expect(g.projectiles).toHaveLength(7);
    expect(g.projectiles.filter((p) => p.tracer === undefined)).toHaveLength(1);
    expect(g.projectiles.map((p) => p.tracer).filter((t) => t !== undefined).sort((x, y) => x! - y!)).toEqual([-30, -20, -10, 10, 20, 30]);
  });

  it('each tracer leaves its offset where it lands, does no damage and makes no crater; they go when he fires again', () => {
    const g = game();
    selectTier(g, 0);
    const fox = g.players[0]!;
    const kie = g.players[1]!;
    fox.angle = 80; // well short of kie: only the plasma could hurt anyone, and it lands near fox
    fox.power = 30;
    const solid = g.terrain.solid.reduce((n, v) => n + v, 0);
    const hp = kie.hp;
    expect(fire(g)).toBe(true);
    const plasma = g.projectiles.find((p) => p.tracer === undefined)!;
    g.projectiles = g.projectiles.filter((p) => p !== plasma); // tracers only
    whileFlying(g);
    expect(g.fx.marks.map((m) => m.offset).sort((x, y) => x - y)).toEqual([-30, -20, -10, 10, 20, 30]);
    expect(g.terrain.solid.reduce((n, v) => n + v, 0)).toBe(solid);
    expect(kie.hp).toBe(hp);
    expect(fox.hp).toBe(fox.maxHp);
    expect(cues(g)).toContain('tracer');
    untilNextTurn(g);
    passTurn(g);
    expect(g.current).toBe(0);
    expect(g.fx.marks).toHaveLength(6); // still up on his next turn
    selectTier(g, 0);
    expect(fire(g)).toBe(true);
    expect(g.fx.marks).toHaveLength(0);
  });
});

describe('a frame', () => {
  it('steps a whole go without trouble', () => {
    const g = game();
    ask(g);
    for (let t = 0; t < 1; t += FIXED_DT) step(g, FIXED_DT);
    expect(g.phase).toBe('guessing'); // waits for him
  });
});

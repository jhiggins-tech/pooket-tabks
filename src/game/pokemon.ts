import { fullAmmo } from '../characters/roster';
import { MISSINGNO, POKEDEX_SIZE, pokemonName } from '../weapons/pokedex';
import { kindOf, weaponOf } from '../weapons/registry';
import { settleTurn } from './bodies';
import { sound, spawnFloater } from './fx';
import { canUseSlot, reselect, weaponForTier } from './loadout';
import type { GameState, Guess, Player } from './state';
import { currentPlayer, tankCentre } from './tanks';

/**
 * doctorfox's Who's That Pokémon?: a bonus move, once a turn. A silhouette goes up with names to pick from
 * (any of the 1025: weapons/pokedex.ts). Right, and a round of his tier 1 comes back (up to full); wrong,
 * or out of time, and it's gone for the match. His `missingNo`th go is always MissingNo., which glitches
 * out and is gone for good whatever he picks. Either way the turn carries on: aim and fire as usual.
 *
 * Like 007 (bond.ts) it's this phone's input: FIRE puts it up (`startGuess`: phase `guessing`), the
 * Pokémon picked with the seeded RNG; only his phone runs the clock (`guessClock`, once the picture's in:
 * main.ts) and takes the answer (`answerGuess`); the other phone and spectators follow in the aim previews
 * (net/follow.ts, `followGuess`). Once it's answered (`guessReady`) his phone fires it for real
 * (`resolveGuess`, its FREE_ACTIONS entry, with the pre-fire snapshot), the answer shows for `GUESS_OUTRO`
 * (`stepGuess`), and it's back to aiming. The picture is fetched while playing; if it can't be,
 * `pokedexDown` calls it off with nothing spent.
 */

/** How long the answer shows once it's fired (s). */
export const GUESS_OUTRO = 1.6;

/** Whether tier `tier` is a Who's That Pokémon?. */
export function isPokemon(p: Player, tier: number): boolean {
  return p.loadout[tier] !== undefined && kindOf(weaponForTier(p, tier)) === 'pokemon';
}

/** Whether this go would be MissingNo. (his `missingNo`th). */
export function missingNoNext(p: Player, tier: number): boolean {
  const w = weaponOf(p.loadout[tier]!, 'pokemon');
  return (p.pokemon?.tries ?? 0) + 1 >= w.pokemon.missingNo;
}

/** FIRE on Who's That Pokémon?: the silhouette goes up (it's fired once it's answered). */
export function startGuess(state: GameState): boolean {
  const p = currentPlayer(state);
  const tier = p.selectedTier;
  if (state.phase !== 'aiming' || p.hop || p.flight || !isPokemon(p, tier) || !canUseSlot(state, p, tier)) return false;
  const w = weaponOf(p.loadout[tier]!, 'pokemon');
  const glitch = missingNoNext(p, tier);
  const pick = () => 1 + Math.min(POKEDEX_SIZE - 1, Math.floor(state.rng() * POKEDEX_SIZE));
  let dex = MISSINGNO;
  let options = Array.from({ length: w.pokemon.options }, () => MISSINGNO);
  if (!glitch) {
    dex = pick();
    options = [dex];
    while (options.length < w.pokemon.options) {
      const n = pick();
      if (!options.includes(n)) options.push(n);
    }
    // Shuffle (so the right one isn't always first).
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(state.rng() * (i + 1)));
      [options[i], options[j]] = [options[j]!, options[i]!];
    }
  }
  state.guess = { playerId: p.id, tier, weaponId: w.id, dex, options, t: 0, picked: null, done: false, outro: null };
  state.phase = 'guessing';
  sound(state, glitch ? 'missingno' : 'pokemon', w.id);
  return true;
}

/** His phone: the clock runs down (once the picture's in), and it's over (no answer) when time's up. */
export function guessClock(state: GameState, dt: number): void {
  const g = state.guess;
  if (state.phase !== 'guessing' || !g || g.done) return;
  g.t += dt;
  if (g.t >= weaponOf(g.weaponId, 'pokemon').pokemon.time) g.done = true;
}

/** His phone: he picks option `i`, and that's his answer. */
export function answerGuess(state: GameState, i: number): void {
  const g = state.guess;
  if (state.phase !== 'guessing' || !g || g.done || !(i >= 0 && i < g.options.length)) return;
  g.picked = i;
  g.done = true;
}

/** Answered (or out of time), and waiting for his phone to fire it. */
export function guessReady(state: GameState): boolean {
  const g = state.guess;
  return state.phase === 'guessing' && !!g?.done && g.outro === null;
}

/** Whole seconds left to answer (null: no silhouette up, or it's answered). */
export function guessLeft(state: GameState): number | null {
  const g = state.phase === 'guessing' ? state.guess : null;
  if (!g || g.outro !== null) return null;
  return Math.max(0, Math.ceil(weaponOf(g.weaponId, 'pokemon').pokemon.time - g.t));
}

/** Whether `g` was answered right (never, for MissingNo.). */
export function guessedRight(g: Guess): boolean {
  return g.dex !== MISSINGNO && g.picked !== null && g.options[g.picked] === g.dex;
}

/**
 * Another phone's go, as its previews show it (net/follow.ts): the silhouette goes up here too. Null: none
 * up there (it was called off: `pokedexDown`), so none here either, unless it's been fired.
 */
export function followGuess(state: GameState, next: Guess | null): void {
  if (!next) {
    if (state.phase === 'guessing' && state.guess?.outro === null) {
      state.guess = null;
      state.phase = 'aiming';
    }
    return;
  }
  // Once it's been fired here, it's this phone's to play out (a late preview doesn't put it back up).
  if (state.guess?.outro != null || next.outro !== null || state.players[next.playerId]?.pokemon?.turn === state.turn) return;
  if (state.phase !== 'guessing' || !state.guess) sound(state, next.dex === MISSINGNO ? 'missingno' : 'pokemon', next.weaponId);
  state.guess = next;
  state.phase = 'guessing';
}

/** The picture couldn't be fetched (his phone): called off, nothing spent, back to aiming. */
export function pokedexDown(state: GameState): void {
  const g = state.guess;
  if (state.phase !== 'guessing' || !g || g.done) return;
  state.guess = null;
  state.phase = 'aiming';
  const c = tankCentre(state.players[g.playerId]!);
  spawnFloater(state, c.x, c.y - 30, 'POKÉDEX OFFLINE', '#cfd6ff');
  sound(state, 'nothing');
}

/** Fired (game.ts `fire`, once it's answered): the round back on tier 1, or it's gone. The turn carries on. */
export function resolveGuess(state: GameState, p: Player, tier: number): boolean {
  const g = state.guess;
  if (state.phase !== 'guessing' || !g || !g.done || g.outro !== null) return false;
  const w = weaponOf(g.weaponId, 'pokemon');
  g.outro = 0;
  p.pokemon = { tries: (p.pokemon?.tries ?? 0) + 1, turn: state.turn };
  const c = tankCentre(p);
  if (g.dex === MISSINGNO) {
    p.ammo[tier] = 0;
    spawnFloater(state, c.x, c.y - 30, 'MISSINGNO. GLITCHED OUT', '#e879f9');
    sound(state, 'missingno', w.id);
  } else if (guessedRight(g)) {
    const r = w.pokemon.refill;
    p.ammo[r] = Math.min(fullAmmo(r), (p.ammo[r] ?? 0) + 1);
    spawnFloater(state, c.x, c.y - 30, `IT’S ${pokemonName(g.dex).toUpperCase()}! +1 ROUND`, '#fde047');
    sound(state, 'pokemon-right', w.id);
  } else {
    p.ammo[tier] = 0;
    const said = g.picked === null ? 'TIME’S UP' : 'WRONG';
    spawnFloater(state, c.x, c.y - 30, `${said}: IT WAS ${pokemonName(g.dex).toUpperCase()}`, '#fca5a5');
    sound(state, 'pokemon-wrong', w.id);
  }
  return true;
}

/** The answer shows, then back to the turn: aiming, with a shot selected (or the turn's over, with none left). */
export function stepGuess(state: GameState, dt: number): void {
  const g = state.guess;
  if (!g || g.outro === null) return;
  g.outro += dt;
  if (g.outro < GUESS_OUTRO) return;
  state.guess = null;
  const p = state.players[g.playerId]!;
  if (reselect(p, { inPlay: true })) state.phase = 'aiming';
  else settleTurn(state);
}

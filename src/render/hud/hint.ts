/**
 * The hint line under the controls: what to do now. `HINTS` is an ordered table of [when, text]: the first
 * row that applies wins. Pure and DOM-free (tests/hud-hint.test.ts).
 */
import { coffeeFailChance, currentPlayer, decoyPickLeft, hologramsOf, isAimless, isBond, isCoffee, isDigger, isDrum, isHoop, isSly, jetCharge, pendingTwinSpot, slotAt, sneakLeft } from '../../game/game';
import type { GameState, Player } from '../../game/state';
import { jetSpec } from '../../weapons/registry';

/** What the hint goes by besides the state. */
export interface HintView {
  /** Online, and it isn't this phone's turn (or it's waiting for the other's result). */
  remote: boolean;
  /** Online, and waiting for the other phone's result. */
  syncing: boolean;
}

/** One row's inputs: the state, whose turn it is, and the things several rows look at. */
interface HintCase extends HintView {
  state: GameState;
  p: Player;
  picking: number | null;
  countdown: number | null;
}

/** What the other phone's player is doing, as the hint says it (online): by phase, else firing. */
const DOING: Partial<Record<GameState['phase'], string>> = { aiming: 'aiming', drumming: 'drumming', sneaking: 'sneaking off', quizzing: 'answering a Bond question' };

/** [when, text], in order: the first row whose `when` holds gives the hint. */
const HINTS: [when: (c: HintCase) => boolean, text: (c: HintCase) => string][] = [
  [(c) => c.remote && c.syncing, () => 'Syncing…'],
  // Online, the other phone's turn.
  [(c) => c.remote && c.state.phase !== 'gameover', (c) => `${c.p.name} is ${DOING[c.state.phase] ?? 'firing'}…`],
  // Band Aid.
  [(c) => c.state.phase === 'drumming', (c) => (c.state.drums?.done ? '' : `🥁 Tap anywhere on the beat! ${'✖'.repeat(c.state.drums?.misses ?? 0)}`)],
  // Sly: sneaking off.
  [(c) => c.state.phase === 'sneaking', (c) => (c.state.sneak?.done ? '' : `🦊 Sneak off with ◀ ▶ · ${sneakLeft(c.state)}s · FIRE when you’re done`)],
  // The steal roulette, the coffee spinner and 007's question say it all themselves.
  [(c) => c.state.phase === 'stealing' || c.state.phase === 'coffee' || c.state.phase === 'quizzing', () => ''],
  [(c) => isCoffee(c.p, c.p.selectedTier), (c) => `Diced Coffee: ${Math.round(coffeeFailChance(c.p, c.p.selectedTier) * 100)}% full cream (ends your turn) · FIRE to spin`],
  [(c) => isDigger(c.p, c.p.selectedTier), (c) => c.p.diggerActive ? 'Digger active: ◀ ▶ plough a horizontal tunnel · FIRE when ready' : 'Activate Digger with FIRE, then drive through terrain this turn'],
  // Just cast Trollogram: picking a decoy to swap into.
  [
    (c) => c.picking !== null,
    (c) => `${c.state.swapTargetId !== null ? 'Swapping into that decoy' : 'Tap a decoy to swap into it'} · DONE when ready (${Math.ceil(c.picking!)})`,
  ],
  [(c) => c.countdown !== null, (c) => `ten-2 charging… ${c.countdown}`],
  [(c) => isBonusSlot(c.p), () => 'Bonus move: FIRE it, then take your turn'],
  [(c) => isDrum(c.p, c.p.selectedTier), () => 'Band Aid: FIRE, then tap anywhere on the beat to heal'],
  [(c) => isSly(c.p, c.p.selectedTier), () => 'Sly: FIRE for a smokescreen, then sneak off unseen'],
  [(c) => isBond(c.p, c.p.selectedTier), () => '007: FIRE, then name the Bond actor'],
  [(c) => pendingTwinSpot(c.state) !== null, () => 'Tap the ground to place your twin, then FIRE'],
  [(c) => isAimless(c.state), () => 'No aiming needed. Just FIRE'],
  [(c) => !!c.p.twin, () => 'Drag from a tank to aim it · 🎯 switches tank (◀ ▶ drive it)'],
  [(c) => hologramsOf(c.state, c.p.id).length > 0 && c.state.swapTargetId !== null, () => 'Swapping to that decoy after you fire'],
  [(c) => hologramsOf(c.state, c.p.id).length > 0, () => 'Drag to aim · tap a decoy to swap after firing'],
  [(c) => isHoop(c.p, c.p.selectedTier), () => 'Shoot it through the middle of the hoop for a slam dunk'],
  [() => true, () => 'Drag & pull back to aim'],
];

/** The hint line for the current player. */
export function hintText(state: GameState, view: HintView): string {
  const c: HintCase = { ...view, state, p: currentPlayer(state), picking: decoyPickLeft(state), countdown: jetCountdown(state) };
  const row = HINTS.find(([when]) => when(c))!;
  return row[1](c);
}

/** Whether the selected slot is a bonus move (Yolk Sucker counts). */
function isBonusSlot(p: Player): boolean {
  const slot = slotAt(p, p.selectedTier);
  return slot === 'bonus' || slot === 'yolk';
}

/** Whole seconds left on the current player's ten-2 charge, or null. */
export function jetCountdown(state: GameState): number | null {
  const p = currentPlayer(state);
  const jet = state.jets.find((j) => j.playerId === p.id);
  if (jetCharge(state, p.id) === null || !jet) return null;
  return Math.max(1, Math.ceil(jetSpec(jet.weaponId).chargeTime - jet.elapsed));
}

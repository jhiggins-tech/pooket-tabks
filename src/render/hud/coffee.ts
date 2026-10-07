/**
 * Diced Coffee's spinner on the HUD: a wheel (full cream slice, lactose free the rest) turning under a fixed
 * pointer and easing to a stop, then the result. Built when a spin starts (or lands); turned every frame.
 */
import { coffeeSpun } from '../../game/game';
import type { GameState } from '../../game/state';
import { byId, el } from '../../ui/dom';
import { Overlay } from './overlay';
import { Key, type Part } from './part';

export function coffee(): Part {
  const overlay = new Overlay('coffee');
  const wheelEl = byId('coffee-wheel');
  /** The spinner's slice labels, with where each points from the middle (degrees clockwise from the top). */
  let labels: { el: HTMLElement; mid: number }[] = [];
  const spin = new Key();
  const wheel = new Key();

  const build = (state: GameState) => {
    const c = state.coffee;
    overlay.show(!!c);
    if (!c) return;
    const p = state.players[c.playerId]!;
    const full = c.failChance * 360;
    overlay.vars({ drinker: p.colour, full: `${full}deg` });
    overlay.root.classList.toggle('landed', c.landed);
    overlay.root.classList.toggle('won', c.landed && !c.fail);
    overlay.root.classList.toggle('spilt', c.landed && c.fail);
    overlay.title(p, ' orders a Diced Coffee…');
    labels = [label('full cream', 'full', full / 2), label('lactose\nfree', 'free', full + (360 - full) / 2)];
    wheelEl.replaceChildren(...labels.map((l) => l.el));
    wheel.reset(); // new labels: turn their words over below if need be
    overlay.result(!c.landed ? null : c.fail ? 'Full cream… 🥛 turn over' : 'Lactose free! ☕ Go again');
  };

  return {
    update(state) {
      const c = state.coffee;
      if (spin.changed(c ? `${c.playerId}|${c.failChance}|${c.landed}` : '')) build(state);
      if (!c) return;
      // Every frame: the wheel's turn.
      const spun = coffeeSpun(c) * 360;
      const turn = `rotate(${(-spun).toFixed(1)}deg)`;
      if (!wheel.changed(turn)) return;
      wheelEl.style.transform = turn;
      // A label turned round to point left would read upside down: turn its words over.
      for (const l of labels) l.el.classList.toggle('flip', Math.cos(((l.mid - 90 - spun) * Math.PI) / 180) < 0);
    },
    reset() {
      spin.reset();
      wheel.reset();
    },
  };
}

/** A slice's label, running out from the middle along the slice (`mid`: its direction, as above). */
function label(text: string, cls: string, mid: number): { el: HTMLElement; mid: number } {
  const l = el('span', `coffee-label ${cls}`);
  l.append(el('span', undefined, text));
  l.style.transform = `translateY(-50%) rotate(${mid - 90}deg)`;
  return { el: l, mid };
}

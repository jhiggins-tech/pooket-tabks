/**
 * The HUD's name chips: a chip per player with their name, rank insignia, status badges, and one health
 * bar (two once Twins has split it). Built when the players or their number of bars change, then kept and
 * patched, so the health bars animate.
 */
import type { GameState, Player } from '../../game/state';
import { byId, el } from '../../ui/dom';
import { insignia } from '../../ui/insignia';
import { badgeKey, badgesOf } from '../../ui/status-looks';
import { Key, type HudContext, type Part } from './part';

interface Chip {
  el: HTMLElement;
  fills: HTMLElement[];
  badges: HTMLElement;
  badgeKey: string;
}

export function chips(): Part {
  const playersEl = byId('players');
  /** The chips' shape (rebuilt when it changes) and what they show (patched when it changes). */
  const shape = new Key();
  const shown = new Key();
  let chips: Chip[] = [];

  const build = (state: GameState, { ranks }: HudContext) => {
    shown.reset();
    chips = state.players.map((pl, i) => {
      const chip = el('div', 'chip');
      chip.style.setProperty('--c', pl.colour);
      const name = el('span', 'name', pl.name);
      const rank = ranks[i];
      if (rank) name.append(insignia(rank));
      const badges = el('span');
      name.append(badges);
      const bar = el('span', 'bars');
      const fills = (pl.twin ? [0, 1] : [0]).map(() => {
        const track = el('span', 'hp');
        const fill = el('span');
        track.append(fill);
        bar.append(track);
        return fill;
      });
      chip.append(name, bar);
      return { el: chip, fills, badges, badgeKey: '' };
    });
    playersEl.replaceChildren(...chips.map((c) => c.el));
  };

  const patch = (state: GameState, current: Player) =>
    state.players.forEach((pl, i) => {
      const chip = chips[i]!;
      chip.el.classList.toggle('active', pl === current && state.phase !== 'gameover');
      chip.el.classList.toggle('dead', !pl.alive);
      const full = pl.twin ? pl.maxHp / 2 : pl.maxHp;
      [pl.hp, pl.twin?.hp ?? 0].forEach((hp, k) => {
        if (chip.fills[k]) chip.fills[k].style.width = `${(hp / full) * 100}%`;
      });
      const bk = badgeKey(pl);
      if (bk !== chip.badgeKey) {
        chip.badgeKey = bk;
        chip.badges.replaceChildren(...badgeSpans(pl));
      }
    });

  return {
    update(state, ctx) {
      if (shape.changed(state.players.map((pl, i) => `${pl.name}|${pl.colour}|${pl.twin ? 2 : 1}|${ctx.ranks[i]?.id ?? ''}`).join('/'))) build(state, ctx);
      const current = ctx.p;
      const key = state.players
        .map((pl) => `${pl.hp}/${pl.twin?.hp}/${pl.maxHp}/${pl.alive}/${pl === current && state.phase !== 'gameover'}/${badgeKey(pl)}`)
        .join('|');
      if (shown.changed(key)) patch(state, current);
    },
    reset() {
      shape.reset();
      shown.reset();
    },
  };
}

/** A player's status badges (ui/status-looks.ts), as the spans by their name. */
function badgeSpans(pl: Player): HTMLElement[] {
  return badgesOf(pl).map((b) => {
    const span = el('span', b.cls, b.text);
    span.title = b.title;
    if (b.colour) span.style.color = b.colour;
    return span;
  });
}

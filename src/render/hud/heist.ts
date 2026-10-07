/** kie's Steal on the HUD: the victim's weapons as cards, one lit at a time, slowing down until one is stolen. */
import { AMMO_PER_TIER } from '../../characters/roster';
import { heistIndex } from '../../game/game';
import { el, query } from '../../ui/dom';
import { getWeapon } from '../../weapons/registry';
import { Overlay } from './overlay';
import { keyed, type Part } from './part';
import { pips } from './weapons';

export function heist(): Part {
  const overlay = new Overlay('heist');
  const cardsEl = query('#heist .heist-cards');
  return keyed(
    (state) => {
      const h = state.heist;
      return h ? `${heistIndex(h)}|${h.locked}|${state.players[h.victimId]!.ammo.join(',')}` : '';
    },
    (state) => {
      const h = state.heist;
      overlay.show(!!h);
      if (!h) return;
      const thief = state.players[h.thiefId]!;
      const victim = state.players[h.victimId]!;
      overlay.vars({ thief: thief.colour, victim: victim.colour });
      overlay.root.classList.toggle('locked', h.locked);
      overlay.title(thief, ' is stealing from ', victim, '…');
      const lit = heistIndex(h);
      cardsEl.replaceChildren(
        ...h.options.map((id, tier) => {
          const w = getWeapon(id);
          const card = el('div', 'heist-card');
          // The stolen round comes off their pips the moment it lands.
          const shown = victim.ammo[tier] ?? 0;
          card.classList.toggle('empty', shown <= 0 && !(h.locked && tier === h.victimTier));
          card.classList.toggle('lit', tier === lit);
          card.classList.toggle('stolen', h.locked && tier === h.victimTier);
          card.append(el('span', 'wname', w.shortName), pips(shown, AMMO_PER_TIER[tier] ?? shown));
          return card;
        }),
      );
      overlay.result(h.locked ? `${thief.name} stole ${getWeapon(h.options[h.victimTier]!).shortName}!` : null);
    },
  );
}

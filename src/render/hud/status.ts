/** The HUD's status: the page's state flags (data attributes on body, the player's colour), the hint line and FIRE / DONE. */
import { canUseSlot, hologramsOf, isAimless } from '../../game/game';
import { byId } from '../../ui/dom';
import { hintText, jetCountdown } from './hint';
import { keyed, type Part } from './part';

export function status(): Part {
  const hintEl = byId('hint');
  const fireEl = byId<HTMLButtonElement>('fire');
  return keyed(
    (state, { p, picking, remote, online }) =>
      [
        state.phase,
        state.current,
        state.turn,
        picking === null ? '' : Math.ceil(picking),
        state.swapTargetId,
        jetCountdown(state),
        hologramsOf(state, p.id).length,
        p.selectedTier,
        p.ammo[p.selectedTier],
        p.loadout[p.selectedTier],
        !!p.twin,
        p.hp,
        p.twin?.hp,
        remote,
        online?.syncing,
      ].join('|'),
    (state, { p, picking, remote, online }) => {
      const body = document.body;
      body.dataset.phase = state.phase;
      body.dataset.remote = String(remote);
      body.dataset.aimless = String(isAimless(state));
      body.dataset.charging = String(jetCountdown(state) !== null);
      body.dataset.picking = String(picking !== null && !remote);
      body.dataset.turn = String(state.turn);
      body.style.setProperty('--player-colour', p.colour);
      hintEl.textContent = hintText(state, { remote, syncing: !!online?.syncing });
      // Just after casting Trollogram, FIRE becomes DONE: finished picking a decoy to swap into.
      const done = picking !== null && !remote;
      fireEl.textContent = done ? 'DONE' : 'FIRE';
      // (Not canFire: that also waits out a hop, which this key doesn't follow, so FIRE could stay greyed after landing.)
      fireEl.disabled = !done && (state.phase !== 'aiming' || !canUseSlot(state, p, p.selectedTier));
    },
  );
}

import type { Chip } from '../audio/chip';
import { readStore, writeStore } from '../core/storage';
import { profileChanges } from '../ui/profile';

export const SOUND_KEY = 'pooket-tabks.sound';

/**
 * The 🔊 / 🔇 button: on or off, remembered (and following a signed-in player: `reload` re-reads it when
 * their account's settings come down). Audio can only start from a user gesture, so the first tap anywhere
 * unlocks it.
 */
export function setupSoundToggle(chip: Chip, button: HTMLElement): { reload: () => void } {
  const set = (on: boolean) => {
    chip.setMuted(!on);
    button.textContent = on ? '🔊' : '🔇';
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
    writeStore(SOUND_KEY, on ? 'on' : 'off'); // not critical
  };
  let on = true;
  const reload = () => {
    const saved = readStore(SOUND_KEY);
    if (saved !== null) on = saved !== 'off'; // (storage unavailable: as it is)
    set(on);
  };
  reload();
  button.addEventListener('click', () => {
    chip.unlock();
    on = !on;
    set(on);
    profileChanges.emit('saved');
  });
  window.addEventListener('pointerdown', () => chip.unlock(), { capture: true });
  return { reload };
}

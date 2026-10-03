import type { Chip } from '../audio/chip';
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
    try {
      localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
    } catch {
      /* not critical */
    }
  };
  let on = true;
  const reload = () => {
    try {
      on = localStorage.getItem(SOUND_KEY) !== 'off';
    } catch {
      /* storage unavailable */
    }
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

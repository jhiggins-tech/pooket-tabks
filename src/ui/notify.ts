import type { PushClient, PushState } from '../push/client';
import { byId } from './dom';

const LABELS: Record<Exclude<PushState, 'unsupported'>, string> = {
  install: '🔔 Notifications',
  off: '🔔 Turn on notifications',
  on: '🔔 Notifications on',
  blocked: '🔕 Notifications blocked',
};

const NOTES: Partial<Record<PushState, string>> = {
  install: 'To get notifications on iPhone or iPad: tap Share, then Add to Home Screen, and open Pooket Tabks from that icon.',
  blocked: 'Notifications are blocked for this site: turn them back on in your browser’s site settings.',
  on: 'You’ll be told when it’s your turn in an online match, or someone starts your game. Tap to turn off.',
};

/**
 * The landing screen's 🔔 button: turn notifications on or off, or say why it can't (hidden where push
 * isn't possible at all). Permission is only ever asked for from a tap on it.
 */
export class NotifyButton {
  private readonly button = byId<HTMLButtonElement>('notify');
  private readonly note = byId('notify-note');

  constructor(
    private readonly push: PushClient,
    /** Turned on or off (a signed-in player's account keeps a list of their phones with them on). */
    private readonly onChange: () => void = () => {},
  ) {
    this.button.addEventListener('click', () => void this.tap());
    this.render(push.state(), false);
  }

  private async tap(): Promise<void> {
    const state = this.push.state();
    if (state === 'off' || state === 'on') {
      this.render(await (state === 'off' ? this.push.enable() : this.push.disable()), true);
      return this.onChange();
    }
    this.note.hidden = !this.note.hidden; // just the explanation
  }

  private render(state: PushState, explain: boolean): void {
    this.button.hidden = state === 'unsupported';
    if (state === 'unsupported') return;
    this.button.textContent = LABELS[state];
    this.button.setAttribute('aria-pressed', String(state === 'on'));
    this.note.textContent = NOTES[state] ?? '';
    this.note.hidden = !explain || !NOTES[state];
  }
}

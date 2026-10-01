import { roomLink } from '../../net/links';
import { button, el } from '../dom';
import { buttons, col, heading, row, shareRow, status, text } from './widgets';

/** The host screen for an open game: its code and link, Listed / Private, and leaving (open) or cancelling it. */
export function hostScreen(code: string, listed: boolean, go: { toggleListed: () => void; leave: () => void; cancel: () => void }): HTMLElement[] {
  const big = el('div', 'online-code', code);
  big.id = 'online-room-code';
  const toggle = button(listed ? '🌐 Listed in Games' : '🔒 Private', go.toggleListed, 'online-listed');
  toggle.id = 'online-listed';
  toggle.setAttribute('aria-pressed', String(listed));
  const leave = button('Back to menu', go.leave, 'online-cancel');
  leave.id = 'online-host-leave';
  const cancel = button('Cancel game', go.cancel, 'online-alt');
  cancel.id = 'online-host-cancel';
  return [
    heading('Host a game'),
    row(
      col(
        heading('Room code', 'h3'),
        big,
        text(listed ? 'Your game is in the Game browser: anyone can pick it. Or they can type this code.' : 'Private: they type this code, or open the link you send them.'),
      ),
      col(heading('Or send them the link', 'h3'), shareRow(roomLink(code), 'Join my Pooket Tabks game'), toggle),
    ),
    status('Waiting for someone to join… You can go: the first to join starts it, and you take your turn when you’re back.', 'online-status'),
    buttons(leave, cancel),
  ];
}

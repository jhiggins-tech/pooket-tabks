import { byId } from './dom';

/** How long a toast stays up. */
const TOAST_MS = 4000;

let timer: ReturnType<typeof setTimeout> | null = null;
let tapped: (() => void) | null = null;

/**
 * A line at the top of the screen for a few seconds ("👁 Kim just started watching", "🎯 Your turn!").
 * With `onTap` it can be tapped (and goes when it is). A newer one replaces it.
 */
export function showToast(text: string, onTap?: () => void): void {
  const el = toastEl();
  el.textContent = text;
  el.hidden = false;
  el.classList.toggle('tappable', !!onTap);
  tapped = onTap ?? null;
  if (timer) clearTimeout(timer);
  timer = setTimeout(hideToast, TOAST_MS);
}

export function hideToast(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  tapped = null;
  toastEl().hidden = true;
}

let bound: HTMLElement | null = null;
function toastEl(): HTMLElement {
  if (!bound) {
    bound = byId('toast');
    bound.addEventListener('click', () => {
      const go = tapped;
      hideToast();
      go?.();
    });
  }
  return bound;
}

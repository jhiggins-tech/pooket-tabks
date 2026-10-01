import { netLogText } from '../../net/log';
import { button, el } from '../dom';

/** The online screens' building blocks: headings, status lines, rows of buttons, the share row, Copy logs. */

/** An error's message, for showing. */
export function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function heading(t: string, tag: 'h2' | 'h3' = 'h2'): HTMLElement {
  return el(tag, undefined, t);
}

export function text(t: string): HTMLElement {
  return el('p', undefined, t);
}

export function status(t: string, cls = ''): HTMLElement {
  return el('p', `online-status-line ${cls}`.trim(), t);
}

export function row(...cols: HTMLElement[]): HTMLElement {
  const r = el('div', 'online-row');
  r.append(...cols);
  return r;
}

export function col(...children: HTMLElement[]): HTMLElement {
  const c = el('div', 'online-col');
  c.append(...children);
  return c;
}

/** Copy the network log (to paste into a bug report); shows it to select by hand if copying isn't allowed. */
export function logsButton(): HTMLElement {
  const b = el('button', 'online-logs', '📋 Copy logs');
  b.id = 'online-logs';
  b.addEventListener('click', async () => {
    const text = netLogText();
    try {
      await navigator.clipboard.writeText(text);
      b.textContent = '✓ Logs copied';
    } catch {
      const area = el('textarea', 'online-logs-text');
      area.readOnly = true;
      area.value = text;
      b.replaceWith(area);
      area.focus();
      area.select();
    }
  });
  return b;
}

export function buttons(...bs: HTMLElement[]): HTMLElement {
  const r = el('div', 'online-buttons');
  r.append(...bs);
  return r;
}

export function linkButton(label: string, onClick: () => void): HTMLElement {
  return button(label, onClick, 'online-alt');
}

export function cancelButton(onClick: () => void, label = 'Cancel'): HTMLElement {
  return button(label, onClick, 'online-cancel');
}

/** The link as selectable text, with Copy (and Share where the phone supports it). */
export function shareRow(link: string, title: string, share = true): HTMLElement {
  const r = el('div', 'online-share');
  const input = el('input', 'online-link');
  input.readOnly = true;
  input.value = link;
  input.addEventListener('focus', () => input.select());
  const copy = el('button', undefined, 'Copy');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(link);
      copy.textContent = 'Copied!';
    } catch {
      input.select();
    }
  });
  r.append(input, copy);
  if (share && typeof navigator.share === 'function') {
    const s = button('Share', () => void navigator.share({ title, url: link }).catch(() => {}));
    r.append(s);
  }
  return r;
}

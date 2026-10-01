/** Small DOM helpers shared by the screens (typed by tag, so `el('input')` is an HTMLInputElement). */

/** A new element, with an optional class and text. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** An element the page is known to have (index.html). */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/** A button that runs `onClick` when tapped. */
export function button(label: string, onClick: () => void, className?: string): HTMLButtonElement {
  const b = el('button', className, label);
  b.addEventListener('click', onClick);
  return b;
}

/** A screen's header: Back, the title, a note on the right. */
export function screenTop(title: string, note: string, back: () => void): HTMLElement {
  const r = el('div', 'screen-top');
  r.append(button('‹ Back', back, 'back'), el('h2', undefined, title), el('span', 'screen-note', note));
  return r;
}

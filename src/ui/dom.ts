/** Small DOM helpers shared by the screens (typed by tag, so `el('input')` is an HTMLInputElement). */

/** A new element, with an optional class and text. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** An element the page is known to have (index.html): throws if it's missing, so a renamed id shows at once. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e as T;
}

/** The first element matching `selector` the page is known to have (index.html): throws if there's none. */
export function query<T extends HTMLElement = HTMLElement>(selector: string): T {
  const e = document.querySelector<T>(selector);
  if (!e) throw new Error(`${selector} missing`);
  return e;
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

/**
 * A full-screen dialog (`div.overlay#id`, role=dialog, labelled `label`), added to the page hidden. Its
 * screen fills it and shows it (`hidden = false`) when it opens.
 */
export function dialog(id: string, label: string): HTMLDivElement {
  const root = el('div', 'overlay');
  root.id = id;
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', label);
  document.body.append(root);
  return root;
}

/** A tab in a `tabBar`: its id, its label, and optionally its colour (`--c`) and extra class. */
export interface TabDef<Id extends string = string> {
  id: Id;
  label: string;
  colour?: string;
  className?: string;
}

/**
 * A row of tabs (`div.info-tabs`, role=tablist) of `button.info-tab`s, the selected one aria-selected.
 * `show` (re)builds it; tapping a tab calls `select` with its id. `dataTab`: each tab also carries its id
 * as `data-tab`.
 */
export function tabBar<Id extends string = string>(opts: { dataTab?: boolean } = {}): { el: HTMLElement; show: (tabs: TabDef<Id>[], selected: Id, select: (id: Id) => void) => void } {
  const bar = el('div', 'info-tabs');
  bar.setAttribute('role', 'tablist');
  const show = (tabs: TabDef<Id>[], selected: Id, select: (id: Id) => void) =>
    bar.replaceChildren(
      ...tabs.map((t) => {
        const b = el('button', 'info-tab', t.label);
        if (opts.dataTab) b.dataset.tab = t.id;
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(t.id === selected));
        if (t.colour) b.style.setProperty('--c', t.colour);
        if (t.className) b.classList.add(t.className);
        b.addEventListener('click', () => select(t.id));
        return b;
      }),
    );
  return { el: bar, show };
}

/** A dialog's ✕ button (`button.info-close#id`), labelled `label`. */
export function closeButton(id: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = button('✕', onClick, 'info-close');
  b.id = id;
  b.setAttribute('aria-label', label);
  return b;
}

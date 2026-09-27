/**
 * The "What's new" popup: the latest changes, shown once per version. The newest version seen is
 * remembered in localStorage, so the popup only comes back when there's something new.
 */

export interface Release {
  /** Goes up by one per release. */
  version: number;
  title: string;
  items: string[];
}

/** Newest first. Add a release (version + 1) when shipping something players will notice. */
export const CHANGELOG: Release[] = [
  {
    version: 3,
    title: 'Watch a match',
    items: [
      'Spectator mode: type the code of a game that’s already under way (or tap it in the nearby list) to watch it live, view only.',
      'This “What’s new” popup, so you know what changed.',
    ],
  },
  {
    version: 2,
    title: 'Two phones, anywhere',
    items: [
      'Online play: host a game and share its 4-letter code or link, and play on two phones over any network.',
      'Games on the same Wi-Fi show up in a nearby list, so you can just tap to join.',
      'tones’ ten-1 gives its round back if it misses.',
    ],
  },
  {
    version: 1,
    title: 'Sounds and sneaky kie',
    items: [
      'Kitschy 8-bit sound effects for every attack (🔊 to mute), and a Pop Goes the Weasel tune while the weasels run.',
      'Weasels pop once they’re in the best spot, not just on contact.',
      'kie’s new kit: Weasel Pop, stacking Trollograms and Steal.',
      'Tanks can drive out of craters.',
    ],
  },
];

export const LATEST = CHANGELOG[0]!.version;
export const WHATS_NEW_KEY = 'pooket.whatsNew';

/** The releases to show someone who last saw `seen` (none yet: just the latest). */
export function unseenReleases(seen: number | null, log: Release[] = CHANGELOG): Release[] {
  if (seen === null) return log.slice(0, 1);
  return log.filter((r) => r.version > seen);
}

export function readSeen(): number | null {
  try {
    const v = Number.parseInt(localStorage.getItem(WHATS_NEW_KEY) ?? '', 10);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(WHATS_NEW_KEY, String(LATEST));
  } catch {
    /* storage unavailable: it'll just show again */
  }
}

export class WhatsNew {
  private readonly root = el('div', 'overlay');
  private readonly body = el('div', 'whatsnew-body');

  constructor() {
    this.root.id = 'whatsnew';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'What’s new');
    const card = el('div', 'whatsnew-card');
    const h = el('h2');
    h.textContent = 'What’s new';
    const ok = el('button', 'big');
    ok.id = 'whatsnew-ok';
    ok.textContent = 'Got it';
    ok.addEventListener('click', () => this.close());
    card.append(h, this.body, ok);
    this.root.append(card);
    document.body.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Show what's changed since this phone last looked, if anything. */
  showUnseen(): void {
    const seen = readSeen();
    if (seen !== null && seen >= LATEST) return;
    this.open(unseenReleases(seen));
  }

  /** Open on the given releases (default: all of them, newest first). */
  open(releases: Release[] = CHANGELOG): void {
    this.body.replaceChildren(
      ...releases.map((r) => {
        const section = el('section');
        const title = el('h3');
        title.textContent = r.title;
        const list = el('ul');
        for (const item of r.items) {
          const li = el('li');
          li.textContent = item;
          list.append(li);
        }
        section.append(title, list);
        return section;
      }),
    );
    this.root.hidden = false;
    this.body.scrollTop = 0;
  }

  close(): void {
    this.root.hidden = true;
    markSeen();
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

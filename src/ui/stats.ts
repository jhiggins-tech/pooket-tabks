import { characterName, isCharacterId, getCharacter, ROSTER } from '../characters/roster';
import { netLog } from '../net/log';
import { Rtdb } from '../net/rtdb';
import type { CharacterRow, Counts, PlayerRow, StatsSummary, StatsView } from '../stats/aggregate';
import { findWeapon } from '../weapons/registry';
import { el } from './dom';

/**
 * The stats viewer (📊 Stats on the landing screen): online matches added up (src/stats/aggregate.ts,
 * refreshed hourly by notifier/stats.ts into `stats/summary`). Players (ranked once they've played a few),
 * Characters, Weapons and You; **Verified only** shows just the matches both players vouched for while
 * signed in with Google. Players who weren't signed in are grouped by name and marked unverified.
 */

/** Players need this many matches to be ranked (a lucky one-off doesn't top the table). */
export const MIN_MATCHES = 3;
const VERIFIED_KEY = 'pooket.statsVerified';

type Tab = 'players' | 'characters' | 'weapons' | 'you';
const TABS: [Tab, string][] = [
  ['players', 'Players'],
  ['characters', 'Characters'],
  ['weapons', 'Weapons'],
  ['you', 'You'],
];

export interface StatsOptions {
  dbUrl: string | null;
  /** This phone's player in the stats: their account's key (signed in) or their name's, and whether signed in. */
  you: () => Promise<{ key: string; name: string; signedIn: boolean }>;
}

export class StatsScreen {
  private readonly root = el('div', 'overlay');
  private readonly tabs = el('div', 'info-tabs');
  private readonly body = el('div', 'info-body stats-body');
  private readonly verifiedBox = el('input');
  private tab: Tab = 'players';
  private stats: StatsSummary | null = null;
  private status: 'loading' | 'error' | 'ready' = 'loading';
  private me: { key: string; name: string; signedIn: boolean } | null = null;

  constructor(private readonly opts: StatsOptions) {
    this.root.id = 'stats';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Stats');
    this.tabs.setAttribute('role', 'tablist');
    this.verifiedBox.type = 'checkbox';
    this.verifiedBox.id = 'stats-verified';
    this.verifiedBox.checked = remembered();
    this.verifiedBox.addEventListener('change', () => {
      remember(this.verifiedBox.checked);
      this.render();
    });
    const label = el('label', 'stats-verified');
    label.append(this.verifiedBox, 'Verified only');
    label.title = 'Only matches both players vouched for while signed in with Google';
    const close = el('button', 'info-close');
    close.id = 'stats-close';
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Close stats');
    close.addEventListener('click', () => this.close());
    const head = el('div', 'info-head');
    head.append(this.tabs, label, close);
    this.root.append(head, this.body);
    document.body.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.root.hidden = false;
    this.status = 'loading';
    this.render();
    void this.load();
  }

  close(): void {
    this.root.hidden = true;
  }

  private async load(): Promise<void> {
    if (!this.opts.dbUrl) {
      this.status = 'error';
      return this.render();
    }
    try {
      const [raw, me] = await Promise.all([new Rtdb(this.opts.dbUrl).get<{ m?: unknown }>('stats/summary'), this.opts.you()]);
      this.me = me;
      this.stats = typeof raw?.m === 'string' ? (JSON.parse(raw.m) as StatsSummary) : null;
      this.status = 'ready';
    } catch (e) {
      netLog(`stats: couldn't load (${e instanceof Error ? e.message : e})`);
      this.status = 'error';
    }
    if (this.isOpen) this.render();
  }

  private render(): void {
    this.tabs.replaceChildren(
      ...TABS.map(([id, label]) => {
        const b = el('button', 'info-tab', label);
        b.dataset.tab = id;
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(id === this.tab));
        b.addEventListener('click', () => {
          this.tab = id;
          this.render();
        });
        return b;
      }),
    );
    this.body.replaceChildren(...this.content());
    this.body.scrollTop = 0;
  }

  private content(): HTMLElement[] {
    if (this.status === 'loading') return [el('p', 'stats-note', 'Loading the stats…')];
    if (this.status === 'error') return [el('p', 'stats-note', "Couldn't load the stats. Check this phone is online, then open them again.")];
    const verified = this.verifiedBox.checked;
    const view = this.stats?.[verified ? 'verified' : 'all'];
    if (!view || view.matches === 0) {
      return [el('p', 'stats-note', verified ? 'No verified matches yet: a match counts once both players were signed in with Google when it ended.' : 'No finished online matches yet. Stats are added up every hour.'), this.footer(view)];
    }
    const parts = this.tab === 'players' ? players(view) : this.tab === 'characters' ? characters(view) : this.tab === 'weapons' ? weapons(view) : this.you(view);
    return [...parts, this.footer(view)];
  }

  private you(view: StatsView): HTMLElement[] {
    const me = this.me;
    const row = me ? view.players.find((p) => p.key === me.key) : undefined;
    if (!row || !me) {
      const hint = me?.signedIn ? '' : ' (Signed out, you’re counted by your name. Sign in with Google to be counted as you, on every phone.)';
      return [el('p', 'stats-note', `No finished online matches for you here yet.${hint}`)];
    }
    const card = el('div', 'stats-you');
    const h = el('h2', undefined, row.name);
    if (row.verified) h.append(el('span', 'stats-tick', '✓'));
    const facts: [string, string][] = [
      ['Played', String(row.matches)],
      ['Won', `${row.wins} (${pct(row.wins, row.matches)})`],
      ['Lost', String(row.losses)],
      ['Drawn', String(row.draws)],
      ['Accuracy', pct(row.hits, row.shots)],
      ['Damage dealt', String(row.dealt)],
      ['Damage taken', String(row.taken)],
      ['Per shot', perShot(row)],
      ['Kills', String(row.kills)],
    ];
    const grid = el('dl', 'stats-facts');
    for (const [k, v] of facts) {
      const pair = el('div');
      pair.append(el('dt', undefined, k), el('dd', undefined, v));
      grid.append(pair);
    }
    const chars = Object.entries(row.characters).sort((a, b) => b[1] - a[1]);
    const list = el('p', 'stats-note', `Played as: ${chars.map(([id, n]) => `${characterName(id)} ×${n}`).join(', ')}`);
    card.append(h, grid, list);
    return [card];
  }

  private footer(view: StatsView | undefined): HTMLElement {
    const s = this.stats;
    const parts = [
      ...(view && view.matches ? [`${view.matches} ${view.matches === 1 ? 'match' : 'matches'}`, `${(view.turns / view.matches).toFixed(1)} turns on average`] : []),
      ...(view && view.matches ? [endings(view.endings)] : []),
      s ? `updated ${ago(s.updatedAt)}` : '',
    ].filter(Boolean);
    return el('p', 'stats-footer', parts.join(' · '));
  }
}

function players(view: StatsView): HTMLElement[] {
  const ranked = view.players.filter((p) => p.matches >= MIN_MATCHES).sort((a, b) => b.wins / b.matches - a.wins / a.matches || b.wins - a.wins || b.matches - a.matches);
  const rest = view.players.length - ranked.length;
  if (!ranked.length) return [el('p', 'stats-note', `Nobody's played ${MIN_MATCHES} matches yet: players are ranked once they have.`)];
  const t = table(['#', 'Player', 'Played', 'W–L–D', 'Win %', 'Accuracy', 'Per shot', 'Kills', 'Favourite']);
  ranked.forEach((p, i) => {
    const name = el('td', 'stats-name', p.name);
    name.append(el('span', p.verified ? 'stats-tick' : 'stats-unverified', p.verified ? '✓' : 'unverified'));
    const fav = favourite(p);
    row(t, [String(i + 1), name, String(p.matches), `${p.wins}–${p.losses}–${p.draws}`, pct(p.wins, p.matches), pct(p.hits, p.shots), perShot(p), String(p.kills), fav ? charCell(fav) : '—']);
  });
  return [wrap(t), el('p', 'stats-note', `✓ signed in with Google · unverified: grouped by name${rest ? ` · ${rest} more with fewer than ${MIN_MATCHES} matches` : ''}`)];
}

function characters(view: StatsView): HTMLElement[] {
  const slots = view.matches * 2;
  const rows = Object.entries(view.characters).sort((a, b) => b[1].matches - a[1].matches);
  const t = table(['Character', 'Picked', 'Win %', 'Accuracy', 'Damage / match', 'Kills']);
  for (const [id, c] of rows as [string, CharacterRow][]) row(t, [charCell(id), `${c.matches} (${pct(c.matches, slots)})`, pct(c.wins, c.matches), pct(c.hits, c.shots), (c.dealt / c.matches).toFixed(1), String(c.kills)]);
  return [wrap(t)];
}

function weapons(view: StatsView): HTMLElement[] {
  const rows = Object.entries(view.weapons).sort((a, b) => b[1].shots - a[1].shots || b[1].dealt - a[1].dealt);
  const t = table(['Weapon', 'Shots', 'Accuracy', 'Damage', 'Per shot']);
  for (const [id, w] of rows as [string, Counts][]) {
    const cell = el('td', 'stats-name', findWeapon(id)?.name ?? (id === 'other' ? 'Other (burns, mud…)' : id));
    const owner = ROSTER.find((c) => c.loadout.includes(id));
    if (owner) cell.append(el('span', 'stats-owner', owner.name));
    row(t, [cell, String(w.shots), pct(w.hits, w.shots), String(w.dealt), perShot(w)]);
  }
  return [wrap(t), el('p', 'stats-note', 'Accuracy: shots that hit an enemy tank or decoy. Moves that do no damage themselves (Twins, Trollogram, Take a Nap) aren’t counted.')];
}

function table(heads: string[]): HTMLTableElement {
  const t = el('table', 'stats-table');
  const tr = el('tr');
  for (const h of heads) tr.append(el('th', undefined, h));
  t.append(el('thead'), el('tbody'));
  t.tHead!.append(tr);
  return t;
}

function row(t: HTMLTableElement, cells: (string | HTMLElement)[]): void {
  const tr = el('tr');
  for (const c of cells) tr.append(typeof c === 'string' ? el('td', undefined, c) : c.tagName === 'TD' ? c : wrapCell(c));
  t.tBodies[0]!.append(tr);
}

const wrapCell = (c: HTMLElement) => {
  const td = el('td');
  td.append(c);
  return td;
};

function wrap(t: HTMLElement): HTMLElement {
  const d = el('div', 'stats-scroll');
  d.append(t);
  return d;
}

function charCell(id: string): HTMLElement {
  const s = el('span', 'stats-char', characterName(id));
  if (isCharacterId(id)) s.style.setProperty('--c', getCharacter(id).colours[0]!);
  return s;
}

function favourite(p: PlayerRow): string | null {
  return Object.entries(p.characters).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');
const perShot = (c: Counts) => (c.shots > 0 ? (c.dealt / c.shots).toFixed(1) : '—');

function endings(e: Record<string, number>): string {
  const names: Record<string, string> = { 'played out': 'played out', resigned: 'resigned', timeout: 'out of time', draw: 'drawn' };
  return Object.entries(e)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${names[k] ?? k}`)
    .join(', ');
}

function ago(ts: number): string {
  const min = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

function remembered(): boolean {
  try {
    return localStorage.getItem(VERIFIED_KEY) === 'yes';
  } catch {
    return false;
  }
}

function remember(on: boolean): void {
  try {
    localStorage.setItem(VERIFIED_KEY, on ? 'yes' : 'no');
  } catch {
    /* it'll just start unticked */
  }
}

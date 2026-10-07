import { characterName, isCharacterId, getCharacter, ROSTER } from '../characters/roster';
import { errText, netLog } from '../net/log';
import { Rtdb } from '../net/rtdb';
import type { CharacterRow, Counts, PlayerRow, StatsSummary, StatsView } from '../stats/aggregate';
import { findWeapon } from '../weapons/registry';
import { rankOf, type Rank } from '../stats/ranks';
import { parseStats, STATS_PATH } from '../stats/store';
import { insignia } from './insignia';
import type { Ratings } from './ranks';
import { readStore, writeStore } from '../core/storage';
import { closeButton, dialog, el, tabBar } from './dom';

/**
 * The stats viewer (📊 Stats on the landing screen): online matches added up (src/stats/aggregate.ts,
 * refreshed hourly by notifier/stats.ts into `stats/summary`). The Leaderboard (verified players by rating:
 * stats/ranks.ts), Players (ranked once they've played a few), Characters, Weapons and You; **Verified only** shows just the matches both players vouched for while
 * signed in with Google. Players who weren't signed in are grouped by name and marked unverified.
 */

/** Players need this many matches to be ranked (a lucky one-off doesn't top the table). */
export const MIN_MATCHES = 3;
const VERIFIED_KEY = 'pooket.statsVerified';

/** The leaderboard shows this many places (and you, pinned below, if you're further down). */
export const LEADERBOARD_SIZE = 50;

export type StatsTab = 'leaderboard' | 'players' | 'characters' | 'weapons' | 'you';
type Tab = StatsTab;
const TABS: [Tab, string][] = [
  ['leaderboard', '🏆 Leaderboard'],
  ['players', 'Players'],
  ['characters', 'Characters'],
  ['weapons', 'Weapons'],
  ['you', 'You'],
];

export interface StatsOptions {
  /** The ratings (ui/ranks.ts): the totals loaded here go to it too, and ranks come from it. */
  ratings?: Ratings;
  dbUrl: string | null;
  /** This phone's player in the stats: their account's key (signed in) or their name's, and whether signed in. */
  you: () => Promise<{ key: string; name: string; signedIn: boolean }>;
}

export class StatsScreen {
  private readonly root = dialog('stats', 'Stats');
  private readonly tabs = tabBar<Tab>({ dataTab: true });
  private readonly body = el('div', 'info-body stats-body');
  private readonly verifiedBox = el('input');
  private tab: Tab = 'leaderboard';
  private readonly verifiedLabel = el('label', 'stats-verified');
  private stats: StatsSummary | null = null;
  private status: 'loading' | 'error' | 'ready' = 'loading';
  private me: { key: string; name: string; signedIn: boolean } | null = null;

  constructor(private readonly opts: StatsOptions) {
    this.verifiedBox.type = 'checkbox';
    this.verifiedBox.id = 'stats-verified';
    this.verifiedBox.checked = remembered();
    this.verifiedBox.addEventListener('change', () => {
      remember(this.verifiedBox.checked);
      this.render();
    });
    const label = this.verifiedLabel;
    label.append(this.verifiedBox, 'Verified only');
    label.title = 'Only matches both players vouched for while signed in with Google';
    const head = el('div', 'info-head');
    head.append(this.tabs.el, label, closeButton('stats-close', 'Close stats', () => this.close()));
    this.root.append(head, this.body);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Open on a tab (the leaderboard unless asked). */
  open(tab: Tab = 'leaderboard'): void {
    this.tab = tab;
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
      const [raw, me] = await Promise.all([new Rtdb(this.opts.dbUrl).get<{ m?: unknown }>(STATS_PATH), this.opts.you()]);
      this.me = me;
      this.stats = parseStats(raw);
      if (this.stats) this.opts.ratings?.take(this.stats);
      this.status = 'ready';
    } catch (e) {
      netLog(`stats: couldn't load (${errText(e)})`);
      this.status = 'error';
    }
    if (this.isOpen) this.render();
  }

  private render(): void {
    this.tabs.show(
      TABS.map(([id, label]) => ({ id, label })),
      this.tab,
      (id) => {
        this.tab = id;
        this.render();
      },
    );
    // (The leaderboard is verified players only anyway.)
    this.verifiedLabel.hidden = this.tab === 'leaderboard';
    this.body.replaceChildren(...this.content());
    this.body.scrollTop = 0;
  }

  private content(): HTMLElement[] {
    if (this.status === 'loading') return [el('p', 'stats-note', 'Loading the stats…')];
    if (this.status === 'error') return [el('p', 'stats-note', "Couldn't load the stats. Check this phone is online, then open them again.")];
    if (this.tab === 'leaderboard') return this.leaderboard();
    const verified = this.verifiedBox.checked;
    const view = this.stats?.[verified ? 'verified' : 'all'];
    if (!view || view.matches === 0) {
      return [el('p', 'stats-note', verified ? 'No verified matches yet: a match counts once both players were signed in with Google when it ended.' : 'No finished online matches yet. Stats are added up every hour.'), this.footer(view)];
    }
    const rankOf = (key: string) => this.opts.ratings?.rank(key) ?? null;
    const parts = this.tab === 'players' ? players(view, rankOf) : this.tab === 'characters' ? characters(view) : this.tab === 'weapons' ? weapons(view) : this.you(view);
    return [...parts, this.footer(view)];
  }

  /** Verified players by rating, best first, with this phone's player highlighted (pinned below if further down). */
  private leaderboard(): HTMLElement[] {
    const s = this.stats;
    const names = new Map((s?.all.players ?? []).map((p) => [p.key, p.name]));
    const ladder = Object.entries(s?.ratings ?? {})
      .filter(([, r]) => r.matches > 0)
      .sort((a, b) => b[1].rating - a[1].rating || b[1].wins - a[1].wins || (names.get(a[0]) ?? '').localeCompare(names.get(b[0]) ?? ''));
    const note = el('p', 'stats-note', 'Players signed in with Google, rated on wins and losses in matches both players were signed in for. Beat someone ranked above you for more. Updated every hour.');
    if (!ladder.length) return [el('p', 'stats-note', 'Nobody’s ranked yet: play an online match with both players signed in with Google to get on the board.'), note, this.footer(undefined)];
    const mine = this.me?.signedIn ? this.me.key : null;
    const t = table(['#', 'Rank', 'Player', 'Rating', 'W–L–D']);
    const add = ([key, r]: (typeof ladder)[number], place: number) => {
      const rank = rankOf(r.rating);
      const medal = ['🥇', '🥈', '🥉'][place - 1];
      const rankCell = el('span', 'stats-rank');
      rankCell.append(insignia(rank), el('span', undefined, rank.name));
      row(t, [medal ?? String(place), rankCell, el('td', 'stats-name', names.get(key) ?? 'Player'), String(Math.round(r.rating)), `${r.wins}–${r.losses}–${r.draws}`]);
      const tr = t.tBodies[0]!.lastElementChild as HTMLElement;
      tr.classList.toggle('stats-me', key === mine);
      if (place <= 3) tr.classList.add('stats-podium');
    };
    ladder.slice(0, LEADERBOARD_SIZE).forEach((e, i) => add(e, i + 1));
    const myPlace = mine ? ladder.findIndex(([k]) => k === mine) : -1;
    if (myPlace >= LEADERBOARD_SIZE) add(ladder[myPlace]!, myPlace + 1);
    const parts: HTMLElement[] = [wrap(t)];
    if (mine && myPlace < 0) parts.push(el('p', 'stats-note', 'You’re not on the board yet: finish an online match where both of you are signed in.'));
    else if (!this.me?.signedIn) parts.push(el('p', 'stats-note', 'Sign in with Google (on the first screen) to get a rank.'));
    return [...parts, note, this.footer(undefined)];
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
    const rank = this.opts.ratings?.rank(row.key);
    const standing = this.opts.ratings?.standing(row.key);
    const rating = this.opts.ratings?.rating(row.key) ?? null;
    if (rank) h.append(insignia(rank, 'md'));
    const facts: [string, string][] = [
      ['Rank', rank ? `${rank.name}${rating !== null ? ` · ${Math.round(rating)}` : ''}` : row.verified ? 'Unranked: play a verified match' : 'Sign in to be ranked'],
      ...(standing ? ([['Best rating', String(Math.round(standing.peak))]] as [string, string][]) : []),
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

function players(view: StatsView, rankOf: (key: string) => Rank | null): HTMLElement[] {
  const ranked = view.players.filter((p) => p.matches >= MIN_MATCHES).sort((a, b) => b.wins / b.matches - a.wins / a.matches || b.wins - a.wins || b.matches - a.matches);
  const rest = view.players.length - ranked.length;
  if (!ranked.length) return [el('p', 'stats-note', `Nobody's played ${MIN_MATCHES} matches yet: players are ranked once they have.`)];
  const t = table(['#', 'Player', 'Played', 'W–L–D', 'Win %', 'Accuracy', 'Per shot', 'Kills', 'Favourite']);
  ranked.forEach((p, i) => {
    const name = el('td', 'stats-name', p.name);
    name.append(el('span', p.verified ? 'stats-tick' : 'stats-unverified', p.verified ? '✓' : 'unverified'));
    const rank = p.verified ? rankOf(p.key) : null;
    if (rank) name.append(insignia(rank));
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

const remembered = (): boolean => readStore(VERIFIED_KEY) === 'yes';
const remember = (on: boolean): void => void writeStore(VERIFIED_KEY, on ? 'yes' : 'no'); // else it just starts unticked

import { characterName, getCharacter } from '../../characters/roster';
import { watchLobby, type Advert } from '../../net/lobby';
import { netLog } from '../../net/log';
import { matchesOf, type MatchSummary } from '../../net/matches';
import { normaliseRoomCode } from '../../net/rooms';
import { loadReplays, type ReplayListing } from '../../net/replay';
import type { Rtdb } from '../../net/rtdb';
import type { Sealer } from '../../net/seal';
import type { Seat } from '../../net/seat';
import { button, el, screenTop } from '../dom';
import { showPast } from './prefs';
import type { Scope } from './scope';
import { message } from './widgets';

/**
 * The Game browser: a table of games (this phone's matches first, then everyone's, waiting for a player,
 * live or finished; updating live; and, ticked, past matches to replay), with Host a game and a private
 * game's code to the side.
 */

/** Where the Game browser's buttons go. */
export interface BrowserActions {
  /** One of this phone's matches. */
  rejoin(seat: Seat): void;
  /** Someone's game on the list (whose: the host's name), or a typed code. */
  join(code: string, whose?: string): void;
  watch(code: string): void;
  replay(listing: ReplayListing): void;
  host(): void;
  back(): void;
}

const MINE_LABEL: Record<MatchSummary['status'], [string, string]> = {
  'your-turn': ['Your turn', 'mine'],
  'their-turn': ['Their turn', 'done'],
  won: ['You won', 'done'],
  lost: ['You lost', 'done'],
  draw: ['A draw', 'done'],
  old: ['Older version', 'done'],
  newer: ['Reload to play', 'mine'],
  lobby: ['Not started', 'done'],
  open: ['Waiting for a player', 'waiting'],
};

/** The Game browser's screen, kept up to date until `scope` ends. */
export function gameBrowser(db: Rtdb, lobby: Sealer, lobbyName: string, scope: Scope, go: BrowserActions): HTMLElement[] {
  const table = el('div', 'games-table');
  table.id = 'online-games';
  let mine: MatchSummary[] = [];
  let adverts: Advert[] = [];
  /** Past matches (null: loading). */
  let past: ReplayListing[] | null = null;
  const pastBox = el('input');
  pastBox.type = 'checkbox';
  pastBox.id = 'online-past';
  pastBox.checked = showPast();
  let lastCounts = '';

  const render = () => {
    const codes = new Set(mine.map((m) => m.seat.code));
    const others = adverts.filter((g) => !codes.has(g.room));
    const waiting = others.filter((g) => !g.playing);
    const playing = others.filter((g) => g.playing);
    const counts = `${mine.length} yours, ${waiting.length} waiting, ${playing.length} live`;
    if (counts !== lastCounts) netLog(`ui: Game browser shows ${counts}`);
    lastCounts = counts;
    const rows = [
      ...mine.map((m) =>
        gameRow('mine', m.seat.code, m.status === 'open' ? '↩ Your game' : `↩ You vs ${m.opponent}`, m.detail, MINE_LABEL[m.status], m.status === 'your-turn' ? ['Play', 'go'] : ['Open', ''], () =>
          go.rejoin(m.seat),
        ),
      ),
      ...waiting.map((g) => gameRow('open', g.room, `${g.name}'s game`, getCharacter(g.characterId).name, ['Needs a player', 'waiting'], ['Join', 'go'], () => go.join(g.room, g.name))),
      ...playing.map((g) =>
        gameRow(
          'live',
          g.room,
          `${g.name} vs ${g.opponent?.name ?? '…'}`,
          g.opponent ? `${getCharacter(g.characterId).name} vs ${getCharacter(g.opponent.characterId).name}` : `${g.name} (${getCharacter(g.characterId).name})`,
          g.over ? ['Finished', 'done'] : ['Live', 'live'],
          ['👁 Watch', ''],
          () => go.watch(g.room),
        ),
      ),
    ];
    const pastRows = (pastBox.checked && past ? past : []).map((r) =>
      gameRow(
        'replay',
        r.id,
        r.players.map((p) => p.name).join(' vs '),
        `${r.players.map((p) => characterName(p.characterId)).join(' vs ')} · ${result(r)} · ${ago(r.ts)}`,
        ['Finished', 'done'],
        ['▶ Replay', ''],
        () => go.replay(r),
      ),
    );
    const head = el('div', 'games-head');
    head.append(el('span', undefined, mine.length ? 'Your games, then everyone’s' : 'Games'), el('span', undefined, 'Status'), el('span'));
    const none = (line: string) => el('p', 'online-none', line);
    table.replaceChildren(
      head,
      ...(rows.length ? rows : [none('No games right now. Host one, and it shows up here for everyone.')]),
      ...(pastBox.checked && pastRows.length ? [el('div', 'games-divider', 'Past matches'), ...pastRows] : []),
      ...(pastBox.checked && !pastRows.length ? [none(past ? 'No past matches yet: public games show up here once they’re over.' : 'Loading past matches…')] : []),
    );
  };

  const loadPast = () => {
    past = null;
    render();
    if (!pastBox.checked) return;
    void loadReplays(db, lobbyName).then(
      (list) => {
        if (!scope.alive) return;
        netLog(`ui: ${list.length} past matches`);
        past = list;
        render();
      },
      (e: unknown) => {
        netLog(`ui: couldn't load past matches (${message(e)})`);
        past = [];
        render();
      },
    );
  };
  pastBox.addEventListener('change', () => {
    netLog(`ui: past matches ${pastBox.checked ? 'on' : 'off'}`);
    showPast(pastBox.checked);
    loadPast();
  });
  scope.onEnd(
    watchLobby(db, lobby, (games) => {
      adverts = games;
      render();
    }).stop,
  );
  void matchesOf(db).then((m) => {
    if (!scope.alive) return;
    mine = m;
    render();
  });
  loadPast();

  const top = screenTop('Game browser', 'Updates live', go.back);
  const pastLabel = el('label', 'games-past');
  pastLabel.append(pastBox, 'Past matches');
  top.append(pastLabel);
  const body = el('div', 'games-body');
  body.append(table, sidePanel(go));
  return [top, body];
}

/** Host a game, and a private game's code. */
function sidePanel(go: BrowserActions): HTMLElement {
  const host = button('📶 Host a game', go.host, 'games-host');
  host.id = 'online-host';
  const input = el('input', 'online-code-input');
  input.placeholder = 'CODE';
  input.maxLength = 6;
  input.autocomplete = 'off';
  input.autocapitalize = 'characters';
  input.enterKeyHint = 'go';
  input.setAttribute('aria-label', 'Room code');
  const submit = () => {
    const c = normaliseRoomCode(input.value);
    if (c) go.join(c);
    else input.focus();
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  const priv = el('div', 'games-private');
  const label = el('p');
  label.append(el('b', undefined, 'Private game?'), ' Enter its code:');
  priv.append(label, input, button('Join', submit));
  const side = el('div', 'games-side');
  side.append(host, el('span', 'games-hint', 'Share a code or a link'), priv);
  return side;
}

/** A row of the table: what it is, how it stands, and its button. */
function gameRow(kind: string, room: string, title: string, detail: string, pill: [string, string], action: [string, string], go: () => void): HTMLElement {
  const r = el('div', `games-row ${kind}`);
  r.dataset.room = room;
  r.dataset.kind = kind;
  const name = el('span', 'games-name', title);
  name.append(el('small', undefined, detail));
  r.append(name, el('span', `pill ${pill[1]}`, pill[0]), button(action[0], go, `games-go ${action[1]}`));
  return r;
}

/** How a past match ended ("A won", "B resigned"). */
function result(r: ReplayListing): string {
  const over = r.over;
  const winner = over && over.winner !== null ? r.players[over.winner] : undefined;
  if (!winner) return 'a draw';
  const loser = r.players.find((p) => p !== winner)?.name ?? 'they';
  if (over?.endReason === 'resigned') return `${loser} resigned`;
  if (over?.endReason === 'timeout') return `${loser} ran out of time`;
  return `${winner.name} won`;
}

/** "5 min ago", "3 h ago", "2 days ago". */
function ago(ts: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - ts) / 60_000));
  if (min < 60) return min <= 1 ? 'just now' : `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

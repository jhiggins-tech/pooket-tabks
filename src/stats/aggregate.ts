import { newRating, playRated, type Rating } from './ranks.ts';
import { digest, nameKey, parseSummary, playerKey, type MatchSummary } from './summary.ts';
import { xpEarned } from './xp.ts';

/**
 * Adding up the stats (run by the stats sender, `notifier/stats.ts`, on a schedule; plain TypeScript Node
 * runs as is). From every match's filed summaries (`stats/matches/<id>/<seat>`) and what signed-in players
 * vouched for (`users/<uid>/results/<id>`), two views: every match, and only verified ones (both seats
 * vouched for by two different accounts, for the same summary). The result is what phones read
 * (`stats/summary`): no accounts in it, only keys made from them (`playerKey`).
 *
 * Players: someone who vouched for their seat is counted under their account (shown with their current
 * name, and marked verified); anyone else under their name, marked unverified.
 *
 * Ratings (stats/ranks.ts): Elo over the verified matches, in the order they were filed, by player key.
 * XP (stats/xp.ts): what each verified player has earned from the verified matches, by player key.
 */

export interface Counts {
  shots: number;
  hits: number;
  dealt: number;
}

export interface PlayerRow extends Counts {
  key: string;
  name: string;
  /** Counted under a Google account (else grouped by name). */
  verified: boolean;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  taken: number;
  kills: number;
  /** Matches per character. */
  characters: Record<string, number>;
}

export interface CharacterRow extends Counts {
  matches: number;
  wins: number;
  kills: number;
}

export interface StatsView {
  matches: number;
  turns: number;
  /** How matches ended: played out, resigned, timeout (out of time), draw. */
  endings: Record<string, number>;
  players: PlayerRow[];
  characters: Record<string, CharacterRow>;
  weapons: Record<string, Counts>;
}

export interface StatsSummary {
  v: 1;
  updatedAt: number;
  all: StatsView;
  verified: StatsView;
  /** Verified players' ratings, by player key (stats/ranks.ts). */
  ratings: Record<string, Rating>;
  /** Verified players' XP (units), by player key (stats/xp.ts). Missing in totals from before XP. */
  xp?: Record<string, number>;
}

export interface StatsInput {
  /** match id → seat ('0' / '1') → { m: summary JSON, ts: when it was filed }. */
  matches: Record<string, Record<string, { m?: unknown; ts?: unknown } | null> | null>;
  /** uid → match id → { seat, digest }. */
  results: Record<string, Record<string, { seat?: unknown; digest?: unknown } | null> | null>;
  /** uid → their current name (from their profile). */
  names: Record<string, string>;
}

const emptyView = (): StatsView => ({ matches: 0, turns: 0, endings: {}, players: [], characters: {}, weapons: {} });

export async function aggregate(input: StatsInput, now = Date.now()): Promise<StatsSummary> {
  // Who vouched for what: match id → seat → [uid, digest][].
  const vouched = new Map<string, Map<number, [string, string][]>>();
  for (const [uid, results] of Object.entries(input.results ?? {})) {
    for (const [id, r] of Object.entries(results ?? {})) {
      if (!r || (r.seat !== 0 && r.seat !== 1) || typeof r.digest !== 'string') continue;
      const seats = vouched.get(id) ?? new Map<number, [string, string][]>();
      vouched.set(id, seats);
      seats.set(r.seat, [...(seats.get(r.seat) ?? []), [uid, r.digest]]);
    }
  }
  const all = new Tally();
  const verified = new Tally();
  /** Verified matches, for the ratings and XP: when, who (seat 0, seat 1), who won, and how many turns it took. */
  const rated: { ts: number; id: string; keys: [string, string]; winner: number | null; turns: number }[] = [];
  for (const [id, filed] of Object.entries(input.matches ?? {})) {
    const summaries = Object.values(filed ?? {})
      .map((f) => parseSummary(f?.m))
      .filter((s): s is MatchSummary => !!s && s.id === id);
    if (!summaries.length) continue;
    const digests = await Promise.all(summaries.map((s) => digest(s)));
    const seats = vouched.get(id);
    // Each seat's one voucher (a seat claimed by two accounts counts for neither).
    const voucher = [0, 1].map((seat) => {
      const v = seats?.get(seat);
      return v && v.length === 1 ? v[0]! : null;
    });
    // The summary both vouchers agree with, if there is one.
    const agreed = voucher[0] && voucher[1] && voucher[0][0] !== voucher[1][0] && voucher[0][1] === voucher[1][1] ? digests.indexOf(voucher[0][1]) : -1;
    const summary = summaries[agreed >= 0 ? agreed : 0]!;
    const usedDigest = digests[agreed >= 0 ? agreed : 0]!;
    // Who's who: a seat vouched for (for this very summary) is that account; else the name played under.
    const keys = await Promise.all(
      summary.players.map(async (p, seat) => {
        const v = voucher[seat];
        return v && v[1] === usedDigest ? { key: await playerKey(v[0]), name: input.names[v[0]] || p.name, verified: true } : { key: nameKey(p.name), name: p.name, verified: false };
      }),
    );
    all.add(summary, keys);
    if (agreed >= 0) {
      verified.add(summary, keys);
      const times = Object.values(filed ?? {}).map((f) => (typeof f?.ts === 'number' ? f.ts : Infinity));
      rated.push({ ts: Math.min(...times), id, keys: [keys[0]!.key, keys[1]!.key], winner: summary.winner, turns: summary.turns });
    }
  }
  const ratings: Record<string, Rating> = {};
  rated.sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const m of rated) {
    const [a, b] = m.keys.map((k) => (ratings[k] ??= newRating()));
    playRated(a!, b!, m.winner === null ? 0.5 : m.winner === 0 ? 1 : 0);
  }
  for (const r of Object.values(ratings)) {
    r.rating = Math.round(r.rating * 10) / 10;
    r.peak = Math.round(r.peak * 10) / 10;
  }
  const xp: Record<string, number> = {};
  for (const m of rated) {
    m.keys.forEach((k, seat) => {
      xp[k] = (xp[k] ?? 0) + xpEarned(m.winner === null ? 0.5 : m.winner === seat ? 1 : 0, m.turns);
    });
  }
  return { v: 1, updatedAt: now, all: all.view(), verified: verified.view(), ratings, xp };
}

/** One view's running totals. */
class Tally {
  private readonly v = emptyView();
  private readonly rows = new Map<string, PlayerRow>();

  add(s: MatchSummary, who: { key: string; name: string; verified: boolean }[]): void {
    const v = this.v;
    v.matches++;
    v.turns += s.turns;
    const ending = s.endReason ?? (s.winner === null ? 'draw' : 'played out');
    v.endings[ending] = (v.endings[ending] ?? 0) + 1;
    s.players.forEach((p, seat) => {
      const t = p.tally;
      const shots = sum(t.shots);
      const hits = sum(t.hits);
      const dealt = sum(t.dealt);
      const won = s.winner === seat;
      const w = who[seat]!;
      const row = this.rows.get(w.key) ?? { key: w.key, name: w.name, verified: w.verified, matches: 0, wins: 0, losses: 0, draws: 0, shots: 0, hits: 0, dealt: 0, taken: 0, kills: 0, characters: {} };
      this.rows.set(w.key, row);
      row.matches++;
      if (s.winner === null) row.draws++;
      else if (won) row.wins++;
      else row.losses++;
      row.shots += shots;
      row.hits += hits;
      row.dealt += dealt;
      row.taken += t.taken;
      row.kills += t.kills;
      row.characters[p.characterId] = (row.characters[p.characterId] ?? 0) + 1;
      const c = (v.characters[p.characterId] ??= { matches: 0, wins: 0, kills: 0, shots: 0, hits: 0, dealt: 0 });
      c.matches++;
      if (won) c.wins++;
      c.kills += t.kills;
      c.shots += shots;
      c.hits += hits;
      c.dealt += dealt;
      for (const id of new Set([...Object.keys(t.shots), ...Object.keys(t.dealt)])) {
        const wpn = (v.weapons[id] ??= { shots: 0, hits: 0, dealt: 0 });
        wpn.shots += t.shots[id] ?? 0;
        wpn.hits += t.hits[id] ?? 0;
        wpn.dealt += t.dealt[id] ?? 0;
      }
    });
  }

  view(): StatsView {
    return { ...this.v, players: [...this.rows.values()].sort((a, b) => b.wins - a.wins || b.matches - a.matches || a.name.localeCompare(b.name)) };
  }
}

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

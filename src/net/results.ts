import type { GameState } from '../game/state';
import { digest, matchId, roundTally, SUMMARY_VERSION, type MatchSummary, type Tally } from '../stats/summary';
import { errText, netLog } from './log';
import { RtdbError, SERVER_TIME, type Rtdb } from './rtdb';
import type { MatchSetup } from './session';
import type { Snapshot } from './snapshot';

/**
 * A finished online match's results, for the stats (`stats/summary.ts`, added up by `notifier/stats.ts`).
 * Each phone that sees a match end files what it saw (`stats/matches/<id>/<seat>`: the summary, never
 * readable by anyone but the stats sender), and a signed-in player's phone also vouches for it in their own
 * account (`users/<uid>/results/<id>`: their seat and the summary's fingerprint). A match counts as
 * verified when both players vouched for the same summary from two different accounts.
 *
 * Reported from the match itself when it ends here (`OnlineScreen`), and from the Game browser's look at
 * this phone's matches (`matchesOf`), so a player who never reopens a finished match still vouches for it.
 * Once per match, seat and account (remembered in localStorage).
 */

/** The first rules whose matches keep a tally (net/version.ts). */
export const TALLY_RULES = 15;

/** Who's signed in on this phone, with the database as them (main.ts tells us). */
let account: () => { uid: string; db: Rtdb } | null = () => null;
export function useResultsAccount(fn: () => { uid: string; db: Rtdb } | null): void {
  account = fn;
}

/** How a match ended, from the game or from its stored record. */
export interface MatchEnd {
  turn: number;
  endReason: string | null;
  winner: number | null;
  tally: Tally[] | undefined;
}

export function endOfGame(g: GameState): MatchEnd {
  return { turn: g.turn, endReason: g.endReason, winner: g.winner?.id ?? null, tally: g.tally };
}

export function endOfSnapshot(snap: Snapshot): MatchEnd {
  return { turn: snap.turn, endReason: (snap.endReason as string | null | undefined) ?? null, winner: snap.winner, tally: snap.tally as Tally[] | undefined };
}

export function summarise(topic: string, setup: MatchSetup, end: MatchEnd): MatchSummary | null {
  if (setup.rules < TALLY_RULES || !end.tally || end.tally.length !== 2 || setup.players.length !== 2) return null;
  return {
    v: SUMMARY_VERSION,
    id: matchId(topic, setup.seed),
    rules: setup.rules,
    turns: end.turn,
    endReason: end.endReason,
    winner: end.winner,
    players: setup.players.map((p, i) => ({ name: p.name, characterId: p.characterId, tally: roundTally(end.tally![i]!) })),
  };
}

const REPORTED_KEY = 'pooket.reported';
const REPORTED_KEEP_MS = 30 * 24 * 60 * 60_000;

/** File this phone's results for a finished match (once). Best effort: never throws. */
export async function reportMatch(db: Rtdb, topic: string, seat: 0 | 1, setup: MatchSetup, end: MatchEnd): Promise<void> {
  const summary = summarise(topic, setup, end);
  if (!summary) return;
  const acct = account();
  const key = `${summary.id}:${seat}:${acct?.uid ?? ''}`;
  if (reported().has(key)) return;
  try {
    try {
      await db.put(`stats/matches/${summary.id}/${seat}`, { m: JSON.stringify(summary), ts: SERVER_TIME });
    } catch (e) {
      if (!(e instanceof RtdbError && e.denied)) throw e; // already filed (it can only be written once)
    }
    if (acct) await acct.db.put(`users/${acct.uid}/results/${summary.id}`, { seat, digest: await digest(summary), ts: SERVER_TIME });
    markReported(key);
    netLog(`stats: results filed${acct ? ' and vouched for' : ''}`);
  } catch (e) {
    netLog(`stats: couldn't file the results (${errText(e)})`);
  }
}

function reported(): Map<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(REPORTED_KEY) ?? '{}') as Record<string, number>;
    return new Map(Object.entries(v).filter(([, t]) => typeof t === 'number' && Date.now() - t < REPORTED_KEEP_MS));
  } catch {
    return new Map();
  }
}

function markReported(key: string): void {
  try {
    const m = reported();
    m.set(key, Date.now());
    localStorage.setItem(REPORTED_KEY, JSON.stringify(Object.fromEntries(m)));
  } catch {
    /* filed again next time: harmless (it's written once, and vouching again is the same) */
  }
}

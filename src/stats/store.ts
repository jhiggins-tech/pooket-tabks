/**
 * Where the stats totals are kept and how: `stats/summary` holds `{ m, ts }`, `m` the StatsSummary
 * (aggregate.ts) as a JSON string, `ts` when it was written. The stats sender (notifier/stats.ts) writes
 * it, the phones (ui/stats.ts, ui/ranks.ts) read it. Run by Node as is too: type imports only.
 */
import type { StatsSummary } from './aggregate.ts';

export const STATS_PATH = 'stats/summary';

/** The version aggregate.ts writes (`StatsSummary.v`). */
const VERSION: StatsSummary['v'] = 1;

export interface StoredStats {
  m: string;
  ts: number;
}

export function encodeStats(stats: StatsSummary, now: number): StoredStats {
  return { m: JSON.stringify(stats), ts: now };
}

/** The totals as read from `STATS_PATH`: null if there are none (or not a version we know). Throws if `m` isn't JSON. */
export function parseStats(raw: { m?: unknown } | null | undefined): StatsSummary | null {
  if (typeof raw?.m !== 'string') return null;
  const s = JSON.parse(raw.m) as StatsSummary | null;
  return s?.v === VERSION ? s : null;
}

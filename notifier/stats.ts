/**
 * The stats sender, run on a schedule by .github/workflows/stats.yml: adds up every finished online match
 * (src/stats/aggregate.ts) and writes the totals phones read (`stats/summary`), then exits. Node runs it as
 * is (`node stats.ts`: plain TypeScript).
 *
 * Needs FIREBASE_SERVICE_ACCOUNT (secret) and FIREBASE_DATABASE_URL (README, "Push notifications": the same
 * two values the push sender uses). Logs counts only: never names, accounts or anything from a match.
 */
import { getDatabase } from 'firebase-admin/database';
import { aggregate, type StatsInput } from '../src/stats/aggregate.ts';
import { initFirebase, readEnv } from './setup.ts';

initFirebase(readEnv(['FIREBASE_SERVICE_ACCOUNT', 'FIREBASE_DATABASE_URL']));
const db = getDatabase();

try {
  const [matches, users] = await Promise.all([db.ref('stats/matches').get(), db.ref('users').get()]);
  const input: StatsInput = { matches: (matches.val() as StatsInput['matches'] | null) ?? {}, results: {}, names: {} };
  for (const [uid, user] of Object.entries((users.val() as Record<string, { results?: StatsInput['results'][string]; profile?: { name?: unknown } }> | null) ?? {})) {
    if (user?.results) input.results[uid] = user.results;
    if (typeof user?.profile?.name === 'string') input.names[uid] = user.profile.name;
  }
  const stats = await aggregate(input);
  await db.ref('stats/summary').set({ m: JSON.stringify(stats), ts: Date.now() });
  console.log(`stats: ${stats.all.matches} matches (${stats.verified.matches} verified), ${stats.all.players.length} players`);
  process.exit(0);
} catch (e) {
  console.error(`couldn't add up the stats: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RANKS } from '../src/stats/ranks';

/**
 * Most ranks are meant to be discovered (CLAUDE.md, "Hidden ranks"): only the original eight are announced.
 * The others' names live in src/stats/ranks.ts and nowhere else that people read: not the docs, the
 * changelog, the workflows or the tests. (The names themselves are read from the table here, so this test
 * doesn't spell them out either.)
 */
const PUBLIC = new Set(['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'grandmaster', 'champion']);

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', 'test-results', 'playwright-report', '.git'].includes(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.(md|ts|yml|yaml|html|json)$/.test(name)) out.push(path);
  }
  return out;
}

describe('hidden ranks', () => {
  it('only the original eight are named anywhere but the rank table and the insignia drawings', () => {
    const hidden = RANKS.filter((r) => !PUBLIC.has(r.id));
    expect(hidden).toHaveLength(RANKS.length - PUBLIC.size);
    const allowed = new Set(['src/stats/ranks.ts', 'src/ui/insignia-shapes.ts']);
    const found: string[] = [];
    for (const file of files('.')) {
      const rel = file.replace(/^\.\//, '');
      if (allowed.has(rel) || rel === 'tests/hidden-ranks.test.ts') continue;
      const text = readFileSync(file, 'utf8');
      for (const r of hidden) if (new RegExp(`\\b${r.name}\\b`).test(text)) found.push(`${rel}: ${r.name}`);
    }
    expect(found).toEqual([]);
  });
});

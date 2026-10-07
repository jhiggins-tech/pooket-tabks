/**
 * Shared e2e scaffolding: what `?debug` exposes as `window.__pooket` (typed), a `test` whose page fails it on
 * any uncaught error, collecting errors from other pages, and starting a Local hotseat match.
 */
import { test as base, expect, type Page } from '@playwright/test';
import type { Chip } from '../src/audio/chip';
import type { SfxPlayer } from '../src/audio/sfx';
import type { GameState } from '../src/game/state';
import type { ReplayPlayer } from '../src/net/replay';
import type { NetSession } from '../src/net/session';
import type { Spectator } from '../src/net/spectate';
import type { Renderer } from '../src/render/canvas';
import type { Rank } from '../src/stats/ranks';
import type { RankUp } from '../src/ui/rankup';

/** `window.__pooket` with `?debug` (built in src/main.ts): the live game, for tests to read (and rig). */
export interface PooketDebug {
  /** The match on screen. */
  readonly state: GameState;
  /** The online match being played, if any. */
  readonly net: NetSession | null;
  /** The match being watched (live or a replay), if any. */
  readonly spectator: Spectator | ReplayPlayer | null;
  renderer: Renderer;
  sfx: SfxPlayer;
  chip: Chip;
  /** The network log (as "Copy logs" copies it). */
  log: () => string;
  rankUp: RankUp;
  RANKS: readonly Rank[];
}

declare global {
  interface Window {
    __pooket: PooketDebug;
  }
}

/** Collect uncaught errors from `pages` into `errors` (a new list unless given); end with `expect(errors).toEqual([])`. */
export function watchErrors(pages: Page | Page[], errors: string[] = []): string[] {
  for (const p of [pages].flat()) p.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Playwright's `test`, with a `page` that fails the test if anything on it throws uncaught. */
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = watchErrors(page);
    await use(page);
    expect(errors, 'uncaught errors on the page').toEqual([]);
  },
});

export { expect };

/**
 * Open the app (`?seed=…&<query>`), go to Local hotseat, pick the characters given (`p1`, `p2`) and start
 * the battle.
 */
export async function startHotseat(page: Page, opts: { seed?: number; p1?: string; p2?: string; query?: string } = {}): Promise<void> {
  const q = [opts.seed !== undefined ? `seed=${opts.seed}` : '', opts.query ?? ''].filter(Boolean).join('&');
  await page.goto(`./?${q}`);
  await page.locator('#open-hotseat').tap();
  if (opts.p1) await page.getByLabel('Player 1 character').selectOption(opts.p1);
  if (opts.p2) await page.getByLabel('Player 2 character').selectOption(opts.p2);
  await page.locator('#start').tap();
}

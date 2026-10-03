import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { startRtdb, type FakeRtdb } from '../tests/support/rtdb';

type Dbg = {
  __pooket: {
    state: { current: number; turn: number; phase: string; players: { name: string; hp: number; x: number; y: number; ammo: number[] }[]; terrain: { solid: Uint8Array } };
    net: { canAct(): boolean } | null;
  };
};

/** What must match on both phones: players and terrain. */
const summary = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as Dbg).__pooket.state;
    return {
      turn: s.turn,
      current: s.current,
      players: s.players.map((p) => ({ name: p.name, hp: p.hp, x: Math.round(p.x * 100), y: Math.round(p.y * 100), ammo: p.ammo })),
      solid: s.terrain.solid.reduce((n, v, i) => (n + v * ((i % 997) + 1)) % 1_000_000_007, 0),
    };
  });

const canAct = (page: Page) => page.evaluate(() => (window as unknown as Dbg).__pooket.net?.canAct() ?? false);

/** Set this phone's name (✎ Change on the landing screen). */
async function setName(page: Page, name: string) {
  await page.locator('#you-change').tap();
  await page.getByRole('textbox', { name: 'Your name' }).fill(name);
  await page.locator('#name-ok').tap();
  await expect(page.locator('#you-name')).toHaveText(name);
}

/** Choose your tank (before hosting or joining): keep the one offered, or pick `characterId`, and go. */
async function pickTank(page: Page, characterId?: string) {
  await expect(page.locator('#tank-go')).toBeVisible({ timeout: 10_000 });
  if (characterId) await page.getByLabel('Your tank').selectOption(characterId);
  await page.locator('#tank-go').tap();
}

/**
 * The Game browser's rows: `mine` (this phone's matches), `open` (waiting for a player), `live` (under way or
 * finished), `replay` (past matches, ticked).
 */
const rows = (page: Page, kind: 'mine' | 'open' | 'live' | 'replay') => page.locator(`#online-games .games-row[data-kind="${kind}"]`);

/** Game server unreachable. */
const OFFLINE = 'debug&db=http%3A%2F%2F127.0.0.1%3A1&lobby=offline';

test("when the game server can't be reached, the Game browser says so (and hotseat still works)", async ({ page }) => {
  await page.goto(`./?${OFFLINE}`);
  await page.locator('#open-browser').tap();
  await expect(page.locator('#online')).toContainText("Couldn't reach the game server", { timeout: 15_000 });
  await expect(page.locator('#online').getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.locator('#online .online-cancel').tap();
  await expect(page.locator('#setup')).toBeVisible();
  await page.locator('#open-hotseat').tap();
  await page.locator('#start').tap();
  await expect(page.locator('#hotseat')).toBeHidden();
});

// ---- Rooms through the game server (a local stand-in for Firebase) ----

let db: FakeRtdb;
test.beforeAll(async () => {
  db = await startRtdb();
});
test.afterAll(async () => {
  await db.close();
});

/** Two phones; `lobby` names a Games list of the test's own (they share one database). */
async function phones(browser: Browser, lobby: string) {
  const q = `debug&db=${encodeURIComponent(db.url)}&lobby=${lobby}`;
  const hostCtx = await browser.newContext(devices['Pixel 7 landscape']);
  const guestCtx = await browser.newContext(devices['Pixel 7 landscape']);
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  const errors: string[] = [];
  for (const p of [host, guest]) p.on('pageerror', (e) => errors.push(e.message));
  return { host, guest, q, errors, close: () => Promise.all([hostCtx.close(), guestCtx.close()]) };
}

/** Both phones reach the lobby; the host starts; one turn plays out in sync. */
async function playFromLobby(host: Page, guest: Page) {
  await expect(host.locator('#online h2')).toHaveText('Connected!', { timeout: 20_000 });
  await expect(guest.locator('#online h2')).toHaveText('Connected!', { timeout: 20_000 });
  // Who's playing as what (tanks were chosen before hosting or joining): nothing to pick here.
  for (const p of [host, guest]) {
    await expect(p.locator('#online .online-seat')).toHaveCount(2);
    await expect(p.locator('#online select')).toHaveCount(0);
  }
  await expect(host.locator('#online-start')).toBeEnabled();
  await host.locator('#online-start').tap();
  await expect(guest.locator('#online')).toBeHidden({ timeout: 15_000 });
  await host.locator('#fire').tap();
  await expect.poll(() => canAct(guest), { timeout: 20_000 }).toBe(true);
  expect(await summary(guest)).toEqual(await summary(host));
}

test('the Games list: a hosted game shows up for any phone, one tap to join (through the game server)', async ({ browser }) => {
  test.setTimeout(90_000);
  const { host, guest, q, errors, close } = await phones(browser, 'games-join');
  await host.goto(`./?${q}`);
  await setName(host, 'Jack');
  await host.locator('#open-browser').tap();
  await host.locator('#online-host').tap();
  await pickTank(host);
  const code = (await host.locator('#online-room-code').textContent({ timeout: 10_000 }))!;
  expect(code).toMatch(/^[A-Z]{4}$/);
  await host.screenshot({ path: 'test-results/room-host.png' });

  await guest.goto(`./?${q}`);
  await guest.locator('#open-browser').tap();
  const game = rows(guest, 'open');
  await expect(game).toHaveCount(1, { timeout: 10_000 });
  await expect(game).toContainText("Jack's game");
  await expect(game).toContainText('Needs a player');
  await expect(game).toHaveAttribute('data-room', code);
  await expect(rows(guest, 'live')).toHaveCount(0);
  await guest.screenshot({ path: 'test-results/room-join-list.png' });
  await game.getByRole('button', { name: 'Join' }).tap();
  await pickTank(guest);
  await expect(host.locator('#online h2')).toHaveText('Connected!', { timeout: 20_000 });

  // The logs button copies a readable account of what happened, for bug reports.
  await host.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await host.locator('#online-logs').tap();
  await expect(host.locator('#online-logs')).toHaveText('✓ Logs copied');
  const log = await host.evaluate(() => navigator.clipboard.readText());
  for (const line of ['Pooket Tabks network log', `rooms: hosting ${code}`, `ui: room ${code} open, on the Games list`, 'db: streaming', 'joined', 'ui: connected as host', 'session: hello from the other phone']) {
    expect(log).toContain(line);
  }
  console.log(log);
  await playFromLobby(host, guest);
  expect(errors).toEqual([]);
  await close();
});

test('a private game stays off the list: type the room code, or open the room link', async ({ browser }) => {
  test.setTimeout(90_000);
  const { host, guest, q, errors, close } = await phones(browser, 'games-private');
  await host.goto(`./?${q}`);
  await host.locator('#open-browser').tap();
  await host.locator('#online-host').tap();
  await pickTank(host);
  const code = (await host.locator('#online-room-code').textContent({ timeout: 10_000 }))!;
  const link = await host.locator('#online .online-link').inputValue();
  expect(link).toMatch(new RegExp(`#room=${code}$`));
  await expect(host.locator('#online-listed')).toHaveAttribute('aria-pressed', 'true'); // listed unless you say otherwise
  await host.locator('#online-listed').tap();
  await expect(host.locator('#online-listed')).toHaveAttribute('aria-pressed', 'false');
  await expect(host.locator('#online')).toContainText('Private');

  await guest.goto(`./?${q}`);
  await guest.locator('#open-browser').tap();
  await expect(guest.locator('#online-games')).toContainText('No games right now');
  await guest.waitForTimeout(1000);
  await expect(rows(guest, 'open')).toHaveCount(0);
  await guest.getByLabel('Room code').fill(code.toLowerCase());
  await guest.locator('#online .games-private').getByRole('button', { name: 'Join' }).tap();
  await pickTank(guest);
  await playFromLobby(host, guest);

  // A wrong code is explained.
  const lost = await browser.newContext(devices['Pixel 7 landscape']);
  const third = await lost.newPage();
  await third.goto(`./?${q}#room=ZZZZ`);
  await third.locator('#online-accept').tap(); // an invite link asks first
  await pickTank(third);
  await expect(third.locator('#online')).toContainText('No game with code ZZZZ', { timeout: 35_000 });
  await lost.close();
  expect(errors).toEqual([]);
  await close();
});

test('a third phone watches a match in progress (from the Live list), view only', async ({ browser }) => {
  test.setTimeout(120_000);
  const { host, guest, q, errors, close } = await phones(browser, 'games-watch');
  await host.goto(`./?${q}`);
  await setName(host, 'Ann');
  await host.locator('#open-browser').tap();
  await host.locator('#online-host').tap();
  await pickTank(host);
  const code = (await host.locator('#online-room-code').textContent({ timeout: 10_000 }))!;
  await guest.goto(`./?${q}#room=${code}`);
  await guest.locator('#online-accept').tap(); // an invite link asks first
  await pickTank(guest);
  await expect(host.locator('#online h2')).toHaveText('Connected!', { timeout: 20_000 });
  await host.locator('#online-start').tap();
  await expect(guest.locator('#online')).toBeHidden({ timeout: 15_000 });

  // A third phone: the match shows as in progress; tap to watch.
  const ctx = await browser.newContext(devices['Pixel 7 landscape']);
  const fan = await ctx.newPage();
  fan.on('pageerror', (e) => errors.push(e.message));
  await fan.goto(`./?${q}`);
  await setName(fan, 'Kim');
  await fan.locator('#open-browser').tap();
  const game = rows(fan, 'live');
  await expect(game).toContainText('Ann vs', { timeout: 10_000 });
  await expect(game).toContainText('tones2 vs');
  await expect(game).toContainText('Live');
  await expect(rows(fan, 'open')).toHaveCount(0);
  await fan.screenshot({ path: 'test-results/games-list.png' });
  await game.getByRole('button', { name: '👁 Watch' }).tap();
  await expect(fan.locator('#online')).toBeHidden({ timeout: 15_000 });
  await expect(fan.locator('#spectate-leave')).toBeVisible();
  await expect(fan.locator('.pad.right')).toBeHidden(); // no controls
  expect(await summary(fan)).toEqual(await summary(host));
  // Everyone sees who's watching: the players get a toast, and a 👁 count with the names behind it.
  // (Both at once: the toast only stays up a few seconds.)
  await Promise.all([host, guest].map((p) => expect(p.locator('#toast')).toHaveText('👁 Kim just started watching', { timeout: 10_000 })));
  for (const p of [host, guest]) await expect(p.locator('#watchers')).toHaveText('👁 1');
  await expect(fan.locator('#watchers')).toHaveText('👁 1', { timeout: 10_000 });
  await expect(fan.locator('#toast')).toBeHidden(); // not for yourself
  await host.screenshot({ path: 'test-results/watched.png' });
  await host.locator('#watchers').tap();
  await expect(host.locator('#watchers-list li')).toHaveText(['Kim']);
  await fan.locator('#watchers').tap();
  await expect(fan.locator('#watchers-list li')).toHaveText(['You']);
  await host.locator('#watchers-list').tap(); // closes it
  await expect(host.locator('#watchers-list')).toBeHidden();
  await fan.locator('#watchers-list').tap();
  await fan.screenshot({ path: 'test-results/spectating.png' });

  // The host fires; the watcher sees it play out and ends up in the same place.
  await host.locator('#fire').tap();
  await expect.poll(() => canAct(guest), { timeout: 20_000 }).toBe(true);
  await expect.poll(async () => JSON.stringify(await summary(fan)), { timeout: 15_000 }).toBe(JSON.stringify(await summary(host)));

  // Joining by code also lands on watching when the game is full.
  const ctx2 = await browser.newContext(devices['Pixel 7 landscape']);
  const late = await ctx2.newPage();
  await late.goto(`./?${q}#room=${code}`);
  await late.locator('#online-accept').tap(); // an invite link asks first
  await pickTank(late);
  await expect(late.locator('#spectate-leave')).toBeVisible({ timeout: 15_000 });
  await expect(host.locator('#watchers')).toHaveText('👁 2', { timeout: 10_000 });

  // Leaving takes the watcher back to the setup screen; the players carry on.
  await fan.locator('#spectate-leave').tap();
  await expect(fan.locator('#setup')).toBeVisible();
  await expect(host.locator('#watchers')).toHaveText('👁 1', { timeout: 10_000 }); // checked out
  await expect(fan.locator('#watchers')).toBeHidden();
  expect(await canAct(guest)).toBe(true);
  expect(errors).toEqual([]);
  await ctx.close();
  await ctx2.close();
  await close();
});

test('past matches: a finished public match can be watched again, start to finish', async ({ browser }) => {
  test.setTimeout(150_000);
  const { host, guest, q, errors, close } = await phones(browser, 'games-replay');
  await host.goto(`./?${q}`);
  await setName(host, 'Ann');
  await host.locator('#open-browser').tap();
  await host.locator('#online-host').tap();
  await pickTank(host);
  await expect(host.locator('#online-room-code')).toBeVisible({ timeout: 10_000 });
  await guest.goto(`./?${q}`);
  await setName(guest, 'Bo');
  await guest.locator('#open-browser').tap();
  await rows(guest, 'open').getByRole('button', { name: 'Join' }).tap();
  await pickTank(guest, 'kcaj');
  await playFromLobby(host, guest);
  await guest.locator('#fire').tap();
  await expect.poll(() => canAct(host), { timeout: 20_000 }).toBe(true);
  await guest.locator('#net-menu').tap();
  await guest.locator('#menu-resign').tap();
  await guest.locator('#menu-resign').tap();
  await expect(host.locator('#winner')).toContainText('Ann wins!', { timeout: 15_000 });
  const ended = await summary(host);

  // A third phone ticks Past matches in the Game browser: there it is.
  const ctx = await browser.newContext(devices['Pixel 7 landscape']);
  const fan = await ctx.newPage();
  fan.on('pageerror', (e) => errors.push(e.message));
  await fan.goto(`./?${q}`);
  await fan.locator('#open-browser').tap();
  await expect(fan.locator('#online-past')).not.toBeChecked();
  await expect(rows(fan, 'replay')).toHaveCount(0);
  await fan.locator('#online-past').check();
  const past = rows(fan, 'replay');
  await expect(past).toHaveCount(1, { timeout: 10_000 });
  await expect(past).toContainText('Ann vs Bo');
  await expect(past).toContainText('tones2 vs kcaj');
  await expect(past).toContainText('Bo resigned');
  await fan.screenshot({ path: 'test-results/past-matches.png' });

  // Replay: view only, every shot played out, faster if you like, ending as it ended.
  await past.getByRole('button', { name: '▶ Replay' }).tap();
  await expect(fan.locator('#online')).toBeHidden({ timeout: 15_000 });
  await expect(fan.locator('#spectate-leave')).toHaveText('▶ Replay · Leave');
  await expect(fan.locator('.pad.right')).toBeHidden();
  await fan.screenshot({ path: 'test-results/replay.png' });
  await fan.locator('#replay-speed').tap();
  await expect(fan.locator('#replay-speed')).toHaveText('2×');
  await expect(fan.locator('#gameover')).toBeVisible({ timeout: 40_000 });
  await expect(fan.locator('#winner')).toContainText('Ann wins!');
  await expect(fan.locator('#winner')).toContainText('Bo resigned');
  expect(await summary(fan)).toEqual(ended);
  await fan.screenshot({ path: 'test-results/replay-over.png' });

  // Watch again, or leave.
  await expect(fan.locator('#watch-replay')).toHaveText('↺ Watch again');
  await fan.locator('#watch-replay').tap();
  await expect(fan.locator('#gameover')).toBeHidden();
  await fan.locator('#spectate-leave').tap();
  await expect(fan.locator('#setup')).toBeVisible();
  // The tick is remembered.
  await fan.locator('#open-browser').tap();
  await expect(fan.locator('#online-past')).toBeChecked();
  expect(errors).toEqual([]);
  await ctx.close();
  await close();
});

test('a phone that drops out gets straight back into its seat (reload, or opening the game again)', async ({ browser }) => {
  test.setTimeout(150_000);
  const { host, guest, q: base, errors, close } = await phones(browser, 'games-rejoin');
  const q = `${base}&lost=1500`; // notice a quiet phone quickly
  await host.goto(`./?${q}`);
  await setName(host, 'Ann');
  await host.locator('#open-browser').tap();
  await host.locator('#online-host').tap();
  await pickTank(host);
  const code = (await host.locator('#online-room-code').textContent({ timeout: 10_000 }))!;
  await guest.goto(`./?${q}#room=${code}`);
  await guest.locator('#online-accept').tap(); // an invite link asks first
  await pickTank(guest);
  await playFromLobby(host, guest);

  // The guest's page reloads mid-match: straight back into its seat, caught up, and it's still its turn.
  await guest.reload();
  await expect(guest.locator('#online')).toBeHidden({ timeout: 20_000 });
  await expect(guest.locator('#spectate-leave')).toBeHidden();
  await expect.poll(() => canAct(guest), { timeout: 20_000 }).toBe(true);
  expect(await summary(guest)).toEqual(await summary(host));
  await guest.locator('#fire').tap();
  await expect.poll(() => canAct(host), { timeout: 20_000 }).toBe(true);
  expect(await summary(guest)).toEqual(await summary(host));

  // The guest's phone goes away altogether: the host is told, and waits.
  await guest.goto('about:blank');
  await expect(host.locator('#net-away')).toBeVisible({ timeout: 15_000 });
  await expect(host.locator('#net-away')).toContainText("isn't here. Take your turn");
  await host.screenshot({ path: 'test-results/rejoin-waiting.png' });

  // It comes back: opening the game again goes straight back into the match (it was only just playing).
  await guest.goto(`./?${q}`);
  await expect(guest.locator('#online')).toBeHidden({ timeout: 20_000 });
  await expect(guest.locator('#spectate-leave')).toBeHidden();
  await expect(host.locator('#net-away')).toBeHidden({ timeout: 15_000 });
  expect(await summary(guest)).toEqual(await summary(host));
  // The host plays on.
  await host.locator('#fire').tap();
  await expect.poll(() => canAct(guest), { timeout: 20_000 }).toBe(true);
  expect(await summary(guest)).toEqual(await summary(host));

  // Resigning (from the game menu, and it asks twice) ends it for both.
  await guest.locator('#net-menu').tap();
  await guest.locator('#menu-resign').tap();
  await expect(guest.locator('#menu-resign')).toContainText('Tap again');
  await guest.locator('#menu-resign').tap();
  for (const p of [host, guest]) {
    await expect(p.locator('#gameover')).toBeVisible({ timeout: 15_000 });
    await expect(p.locator('#winner')).toContainText('Ann wins!');
    await expect(p.locator('#winner')).toContainText('resigned');
  }
  expect(errors).toEqual([]);
  await close();
});

test("the Game browser lists a match from a while ago; typing its code rejoins too", async ({ browser }) => {
  test.setTimeout(120_000);
  const { host, guest, q: base, errors, close } = await phones(browser, 'games-rejoin-later');
  const q = `${base}&lost=1500`;
  await host.goto(`./?${q}`);
  await host.locator('#open-browser').tap();
  await host.locator('#online-host').tap();
  await pickTank(host);
  const code = (await host.locator('#online-room-code').textContent({ timeout: 10_000 }))!;
  await guest.goto(`./?${q}#room=${code}`);
  await guest.locator('#online-accept').tap(); // an invite link asks first
  await pickTank(guest);
  await playFromLobby(host, guest);

  // The guest dropped out a while ago (too long for rejoining by itself on opening).
  await guest.evaluate(() => {
    const games = JSON.parse(localStorage.getItem('pooket.games')!);
    localStorage.setItem('pooket.games', JSON.stringify([{ ...games[0], ts: Date.now() - 30 * 60_000 }]));
  });
  await guest.goto('about:blank');
  await guest.goto(`./?${q}`);
  await expect(guest.locator('#setup')).toBeVisible();
  await guest.locator('#open-browser').tap();
  await expect(rows(guest, 'mine')).toHaveCount(1);
  await guest.locator('#online .back').tap();
  await guest.screenshot({ path: 'test-results/rejoin-button.png' });

  // Typing the code rejoins (it's this phone's match), rather than watching.
  await guest.locator('#open-browser').tap();
  await guest.getByLabel('Room code').fill(code);
  await guest.locator('#online .games-private').getByRole('button', { name: 'Join' }).tap();
  await expect(guest.locator('#online')).toBeHidden({ timeout: 20_000 });
  await expect(guest.locator('#spectate-leave')).toBeHidden();
  await expect.poll(() => canAct(guest), { timeout: 20_000 }).toBe(true);
  expect(await summary(guest)).toEqual(await summary(host));
  expect(errors).toEqual([]);
  await close();
});

test("a link preview that joins and vanishes doesn't take the seat; an invite link asks before joining", async ({ browser }) => {
  test.setTimeout(120_000);
  const { host, guest, q: base, errors, close } = await phones(browser, 'games-ghost');
  const q = `${base}&lost=1500`;
  await host.goto(`./?${q}`);
  await host.locator('#open-browser').tap();
  await host.locator('#online-host').tap();
  await pickTank(host);
  const code = (await host.locator('#online-room-code').textContent({ timeout: 10_000 }))!;

  // Opening the link only asks: nothing joins until someone taps.
  await guest.goto(`./?${q}#room=${code}`);
  await expect(guest.locator('#online')).toContainText(`invited to a Pooket Tabks game (room ${code})`);
  await guest.screenshot({ path: 'test-results/invite.png' });
  await guest.waitForTimeout(1500);
  await expect(host.locator('#online-room-code')).toHaveText(code); // still waiting

  // A "preview" that did join (an older version, say) and then vanished: the host frees the seat.
  const ctx = await browser.newContext(devices['Pixel 7 landscape']);
  const ghost = await ctx.newPage();
  await ghost.goto(`./?${q}`);
  await ghost.locator('#open-browser').tap();
  await ghost.getByLabel('Room code').fill(code);
  await ghost.locator('#online .games-private').getByRole('button', { name: 'Join' }).tap();
  await pickTank(ghost);
  await expect(host.locator('#online h2')).toHaveText('Connected!', { timeout: 20_000 });
  await ctx.close();
  await expect(host.locator('#online-room-code')).toHaveText(code, { timeout: 20_000 }); // back to waiting, same code

  // The real player taps Join game and plays.
  await guest.locator('#online-accept').tap();
  await pickTank(guest);
  await playFromLobby(host, guest);
  expect(errors).toEqual([]);
  await close();
});

test('a host that reloads mid-match goes straight back on the Games list', async ({ browser }) => {
  test.setTimeout(120_000);
  const { host, guest, q: base, errors, close } = await phones(browser, 'games-relist');
  const q = `${base}&lost=1500`;
  await host.goto(`./?${q}`);
  await setName(host, 'Bo');
  await host.locator('#open-browser').tap();
  await host.locator('#online-host').tap();
  await pickTank(host);
  const code = (await host.locator('#online-room-code').textContent({ timeout: 10_000 }))!;
  await guest.goto(`./?${q}#room=${code}`);
  await guest.locator('#online-accept').tap();
  await pickTank(guest);
  await playFromLobby(host, guest);

  // The host's page reloads: back in the match, and its listing is refreshed (not left to go stale).
  const listingTs = () => {
    const lobby = (db.tree().lobby ?? {}) as Record<string, Record<string, { ts: number }>>;
    return Math.max(0, ...Object.values(lobby).flatMap((l) => Object.values(l).map((e) => e.ts)));
  };
  const reloadedAt = Date.now();
  await host.reload();
  await expect(host.locator('#online')).toBeHidden({ timeout: 20_000 });
  await expect.poll(listingTs, { timeout: 15_000 }).toBeGreaterThan(reloadedAt);

  const ctx = await browser.newContext(devices['Pixel 7 landscape']);
  const fan = await ctx.newPage();
  await fan.goto(`./?${q}`);
  await fan.locator('#open-browser').tap();
  await expect(rows(fan, 'live')).toContainText('Bo vs', { timeout: 10_000 });
  await ctx.close();
  expect(errors).toEqual([]);
  await close();
});

test('turn by turn: take your turn and go back to the menu; the other player finds it in My games, and so on', async ({ browser }) => {
  test.setTimeout(180_000);
  const { host, guest, q: base, errors, close } = await phones(browser, 'games-async');
  const q = `${base}&lost=1500`;
  await host.goto(`./?${q}`);
  await setName(host, 'Ann');
  await host.locator('#open-browser').tap();
  await host.locator('#online-host').tap();
  await pickTank(host);
  const code = (await host.locator('#online-room-code').textContent({ timeout: 10_000 }))!;
  await guest.goto(`./?${q}#room=${code}`);
  await guest.locator('#online-accept').tap();
  await pickTank(guest);
  await playFromLobby(host, guest); // the guest's turn now

  // The host goes back to the menu; the match waits for it.
  await host.locator('#net-menu').tap();
  await expect(host.locator('#online')).toContainText('Game menu');
  await host.locator('#menu-leave').tap();
  await expect(host.locator('#setup')).toBeVisible();
  await expect(host.locator('#turns-dot')).toBeHidden(); // it's the guest's turn
  // The guest is told, and takes its turn anyway.
  await expect(guest.locator('#net-away')).toContainText("Ann isn't here. Take your turn", { timeout: 10_000 });
  await guest.locator('#fire').tap();
  await expect(guest.locator('#net-away')).toContainText("It's Ann's turn, and they're not here", { timeout: 20_000 });
  await expect(guest.locator('#net-away .nudge')).toBeVisible();
  await guest.screenshot({ path: 'test-results/async-their-turn.png' });
  const afterGuest = await summary(guest);
  await guest.locator('#net-away').getByRole('button', { name: 'Menu' }).tap();
  await expect(guest.locator('#setup')).toBeVisible();

  // Later the host opens the game again: My games says it's its turn; it sees the guest's shot, then plays.
  await host.reload();
  await expect(host.locator('#turns-dot')).toHaveText('1', { timeout: 10_000 });
  await host.screenshot({ path: 'test-results/landing-turns.png' });
  await host.locator('#open-browser').tap();
  const mine = rows(host, 'mine');
  await expect(mine).toHaveCount(1);
  await expect(mine).toContainText('Your turn');
  await host.screenshot({ path: 'test-results/async-my-games.png' });
  await mine.getByRole('button', { name: 'Play' }).tap();
  await expect(host.locator('#online')).toBeHidden({ timeout: 20_000 });
  await expect.poll(() => canAct(host), { timeout: 40_000 }).toBe(true);
  expect(await summary(host)).toEqual(afterGuest);
  await host.locator('#fire').tap();
  await expect.poll(async () => (await summary(host)).turn, { timeout: 30_000 }).toBe(4);
  await expect(host.locator('#net-away')).toContainText("It's", { timeout: 20_000 });
  const afterHost = await summary(host);
  await host.locator('#net-menu').tap();
  await host.locator('#menu-leave').tap();

  // The guest's turn again, from My games.
  await guest.reload();
  await guest.locator('#open-browser').tap();
  await expect(rows(guest, 'mine')).toContainText('Your turn');
  await rows(guest, 'mine').getByRole('button', { name: 'Play' }).tap();
  await expect.poll(() => canAct(guest), { timeout: 40_000 }).toBe(true);
  expect(await summary(guest)).toEqual(afterHost);

  // The guest resigns; the host finds out when it looks.
  await guest.locator('#net-menu').tap();
  await guest.locator('#menu-resign').tap();
  await guest.locator('#menu-resign').tap();
  await expect(guest.locator('#winner')).toContainText('Ann wins!');
  // No rematch: watch the match again (what this phone saw of it), or leave.
  await expect(guest.locator('#gameover-leave')).toHaveText('Leave');
  await expect(guest.locator('#watch-replay')).toHaveText('▶ Watch replay');
  await guest.locator('#watch-replay').tap();
  await expect(guest.locator('#spectate-leave')).toHaveText('▶ Replay · Leave', { timeout: 10_000 });
  await expect(guest.locator('#watch-replay')).toHaveText('↺ Watch again', { timeout: 40_000 });
  await expect(guest.locator('#winner')).toContainText('Ann wins!');
  await guest.locator('#gameover-leave').tap();
  await expect(guest.locator('#setup')).toBeVisible();
  await host.reload();
  await host.locator('#open-browser').tap();
  await expect(rows(host, 'mine')).toContainText('You won');
  await rows(host, 'mine').getByRole('button', { name: 'Open' }).tap();
  await expect(host.locator('#gameover')).toBeVisible({ timeout: 20_000 });
  await expect(host.locator('#winner')).toContainText('resigned');
  await expect(host.locator('#watch-replay')).toBeHidden(); // nothing played on this phone since it came back
  // Seen how it ended: leaving forgets it.
  await host.locator('#gameover-leave').tap();
  await expect(host.locator('#setup')).toBeVisible();
  await host.locator('#open-browser').tap();
  await expect(rows(host, 'mine')).toHaveCount(0);
  expect(errors).toEqual([]);
  await close();
});

test('host a game and go: it stays open, whoever joins first starts it, and the host takes its turn later', async ({ browser }) => {
  test.setTimeout(150_000);
  const { host, guest, q, errors, close } = await phones(browser, 'games-open');
  await host.goto(`./?${q}`);
  await setName(host, 'Jack');
  await host.locator('#open-browser').tap();
  await host.locator('#online-host').tap();
  await pickTank(host, 'kie');
  await expect(host.locator('#online-room-code')).toHaveText(/^[A-Z]{4}$/, { timeout: 10_000 });
  await host.screenshot({ path: 'test-results/host-open.png' });
  // Back to the menu: the game stays open, and it's in the host's own games.
  await host.locator('#online-host-leave').tap();
  await expect(host.locator('#setup')).toBeVisible();
  await host.locator('#open-browser').tap();
  await expect(rows(host, 'mine')).toContainText('Waiting for a player');
  await host.goto('about:blank'); // and the host closes the game altogether

  // Someone finds it in the Game browser and joins: the match starts without the host.
  await guest.goto(`./?${q}`);
  await setName(guest, 'Bo');
  await guest.locator('#open-browser').tap();
  const game = rows(guest, 'open');
  await expect(game).toContainText("Jack's game", { timeout: 10_000 });
  await expect(game).toContainText('kie');
  await game.getByRole('button', { name: 'Join' }).tap();
  // Choose a tank first: what each does, and the join only goes ahead once one's picked.
  await expect(guest.locator('#online .screen-top h2')).toHaveText('Choose your tank');
  await expect(guest.locator('#online')).toContainText("Joining Jack's game");
  // An upcoming character can be looked at, not picked.
  await guest.getByLabel('Your tank').selectOption('kiwicore');
  await expect(guest.locator('.tank-details .coming-soon-banner')).toHaveText('Coming soon');
  await expect(guest.locator('#tank-go')).toBeDisabled();
  await guest.screenshot({ path: 'test-results/coming-soon-tank.png' });
  await guest.getByLabel('Your tank').selectOption('larinovsky');
  await expect(guest.locator('#online .info-card h3')).toHaveText(['Pill Pusher', 'the Rizzler', 'Take a Nap', 'Women in Scam']);
  await expect(guest.locator('#tank-go')).toHaveText('Join with larinovsky');
  await guest.screenshot({ path: 'test-results/choose-tank.png' });
  await guest.locator('#tank-go').tap();
  await expect(guest.locator('#online')).toBeHidden({ timeout: 20_000 });
  await expect(guest.locator('#net-away')).toContainText("It's Jack's turn, and they're not here", { timeout: 10_000 });
  await guest.screenshot({ path: 'test-results/joined-open-game.png' });
  type Chars = { __pooket: { state: { players: { characterId: string }[] } } };
  expect(await guest.evaluate(() => (window as unknown as Chars).__pooket.state.players.map((p) => p.characterId))).toEqual(['kie', 'larinovsky']);

  // The host comes back to its turn; with both there it's live.
  await host.goto(`./?${q}`);
  await expect(host.locator('#turns-dot')).toHaveText('1', { timeout: 10_000 });
  await host.locator('#open-browser').tap();
  const mine = rows(host, 'mine');
  await expect(mine).toContainText('You vs Bo');
  await expect(mine).toContainText('Your turn');
  await mine.getByRole('button', { name: 'Play' }).tap();
  await expect.poll(() => canAct(host), { timeout: 30_000 }).toBe(true);
  await host.locator('#fire').tap();
  await expect.poll(() => canAct(guest), { timeout: 30_000 }).toBe(true);
  expect(await summary(guest)).toEqual(await summary(host));
  expect(errors).toEqual([]);
  await close();
});

test('Cancel game takes a hosted game down', async ({ browser }) => {
  const { host, guest, q, close } = await phones(browser, 'games-cancel');
  await host.goto(`./?${q}`);
  await host.locator('#open-browser').tap();
  await host.locator('#online-host').tap();
  await pickTank(host);
  const code = (await host.locator('#online-room-code').textContent({ timeout: 10_000 }))!;
  await guest.goto(`./?${q}`);
  await guest.locator('#open-browser').tap();
  await expect(rows(guest, 'open')).toHaveCount(1, { timeout: 10_000 });
  await host.locator('#online-host-cancel').tap();
  await expect(host.locator('#setup')).toBeVisible();
  await expect(rows(guest, 'open')).toHaveCount(0, { timeout: 10_000 });
  await guest.getByLabel('Room code').fill(code);
  await guest.locator('#online .games-private').getByRole('button', { name: 'Join' }).tap();
  await pickTank(guest);
  await expect(guest.locator('#online')).toContainText('No game with code', { timeout: 10_000 });
  await close();
});

test("notifications: the host's away; the guest's turn ends, and the host's open page says it's their turn", async ({ browser }) => {
  test.setTimeout(120_000);
  const { host, guest, q: base, errors, close } = await phones(browser, 'games-push');
  const q = `${base}&lost=1500&vapid=test-key`;
  await host.addInitScript(() => localStorage.setItem('pooket.push', 'on')); // (as if turned on: tests can't subscribe)
  await host.goto(`./?${q}`);
  await setName(host, 'Ann');
  // The 🔔 is there to turn on (only from a tap; a test browser can't actually subscribe).
  await expect(host.locator('#notify')).toBeVisible();
  await host.locator('#open-browser').tap();
  await host.locator('#online-host').tap();
  await pickTank(host);
  const code = (await host.locator('#online-room-code').textContent({ timeout: 10_000 }))!;
  await guest.goto(`./?${q}#room=${code}`);
  await guest.locator('#online-accept').tap();
  await pickTank(guest);
  await playFromLobby(host, guest); // the guest's turn now

  // The host goes back to the menu; the guest plays: it's the host's turn, and the host's page says so.
  await host.locator('#net-menu').tap();
  await host.locator('#menu-leave').tap();
  await expect(host.locator('#setup')).toBeVisible();
  await expect(guest.locator('#net-away')).toBeVisible({ timeout: 10_000 });
  await guest.locator('#fire').tap();
  await expect(host.locator('#toast')).toHaveText('🎯 Your turn! Your move in Pooket Tabks. Tap to play.', { timeout: 30_000 });
  await host.screenshot({ path: 'test-results/notified.png' });
  // Tapping it goes straight to that match.
  await host.locator('#toast').tap();
  await expect(host.locator('#online')).toBeHidden({ timeout: 20_000 });
  await expect.poll(() => canAct(host), { timeout: 40_000 }).toBe(true);
  // (The guest didn't hear about its own turn.)
  await expect(guest.locator('#toast')).toBeHidden();
  expect(errors).toEqual([]);
  await close();
});

test('sign in with Google (optional): your name follows you to another phone, and signing out leaves the game as it was', async ({ browser }) => {
  const { host: a, guest: b, q, errors, close } = await phones(browser, 'signin');
  const url = `./?${q}&fakegoogle=ann`;
  const profile = () => (db.tree().users as Record<string, { profile?: { name?: string } }> | undefined)?.['uid-ann']?.profile?.name;

  // Phone A has a name and a tank, and isn't signed in: it plays as ever, with a sign-in button on offer.
  await a.goto(url);
  await setName(a, 'Annie');
  await expect(a.locator('#sign-in')).toBeVisible();
  expect(profile()).toBeUndefined();
  await a.locator('#sign-in').tap();
  await expect(a.locator('#account')).toContainText('Signed in');
  await expect.poll(profile).toBe('Annie'); // sent up: the account had no profile yet
  await a.screenshot({ path: 'test-results/signed-in.png' });

  // Phone B has another name; signing in as the same account brings Annie down.
  await b.goto(url);
  await setName(b, 'Phone B');
  await b.locator('#sign-in').tap();
  await expect(b.locator('#you-name')).toHaveText('Annie');
  expect(profile()).toBe('Annie');

  // A change on B goes up; A has it the next time it opens.
  await setName(b, 'Bea');
  await expect.poll(profile, { timeout: 10_000 }).toBe('Bea');
  await a.reload();
  await expect(a.locator('#you-name')).toHaveText('Bea');
  await expect(a.locator('#account')).toContainText('Signed in'); // still signed in after a reload

  // Signing out keeps the name on the phone and puts the button back.
  await a.getByRole('button', { name: 'Sign out' }).tap();
  await expect(a.locator('#sign-in')).toBeVisible();
  await expect(a.locator('#you-name')).toHaveText('Bea');
  expect(await a.evaluate(() => localStorage.getItem('pooket.auth'))).toBeNull();
  expect(errors).toEqual([]);
  await close();
});

test('no sign-in button where there is nothing to sign in to (a test database without the stand-in)', async ({ browser }) => {
  const { host, q, close } = await phones(browser, 'signin-off');
  await host.goto(`./?${q}`);
  await expect(host.locator('#setup')).toBeVisible();
  await expect(host.locator('#account')).toBeHidden();
  await close();
});

test('signed in, your matches follow you: carry one on from another phone, which plays while the first stands aside', async ({ browser }) => {
  test.setTimeout(150_000);
  const { host: a, guest: c, q: base, errors, close } = await phones(browser, 'seats-follow');
  const q = `${base}&lost=1500`;
  const bCtx = await browser.newContext(devices['Pixel 7 landscape']);
  const b = await bCtx.newPage();
  b.on('pageerror', (e) => errors.push(e.message));

  // (An account of this test's own.) Ann, signed in on phone A, hosts; C (not signed in) joins; one turn each way.
  await a.goto(`./?${q}&fakegoogle=cara`);
  await setName(a, 'Ann');
  await a.locator('#sign-in').tap();
  await expect(a.locator('#account')).toContainText('Signed in');
  await a.locator('#open-browser').tap();
  await a.locator('#online-host').tap();
  await pickTank(a);
  const code = (await a.locator('#online-room-code').textContent({ timeout: 10_000 }))!;
  await c.goto(`./?${q}#room=${code}`);
  await c.locator('#online-accept').tap();
  await pickTank(c);
  await playFromLobby(a, c); // C's turn now
  await expect.poll(() => (db.tree().users as Record<string, { games?: Record<string, unknown> }>)['uid-cara']?.games?.[code]).toBeTruthy();

  // Ann picks up phone B and signs in: the match is in her games there, and she carries on with it.
  await b.goto(`./?${q}&fakegoogle=cara`);
  await b.locator('#sign-in').tap();
  await expect(b.locator('#you-name')).toHaveText('Ann');
  await b.locator('#open-browser').tap();
  await expect(rows(b, 'mine')).toHaveCount(1);
  await expect(rows(b, 'mine')).toContainText('their turn', { ignoreCase: true });
  await rows(b, 'mine').getByRole('button', { name: 'Open' }).tap();
  await expect(b.locator('#online')).toBeHidden({ timeout: 20_000 });
  // Phone A stands aside (no word to C: Ann's still here, on B).
  await expect(a.locator('#online')).toContainText('Playing on another phone', { timeout: 15_000 });
  await a.screenshot({ path: 'test-results/playing-elsewhere.png' });
  expect(await canAct(a)).toBe(false);
  // C plays; B sees it and takes Ann's turn.
  await expect.poll(() => canAct(c), { timeout: 20_000 }).toBe(true);
  await c.locator('#fire').tap();
  await expect.poll(() => canAct(b), { timeout: 40_000 }).toBe(true);
  expect(await summary(b)).toEqual(await summary(c));
  await b.locator('#fire').tap();
  await expect.poll(() => canAct(c), { timeout: 40_000 }).toBe(true);
  expect(await summary(c)).toEqual(await summary(b));

  // Back to phone A: "Play here instead" takes the seat back, and B stands aside in turn.
  await a.locator('#online-play-here').tap();
  await expect(b.locator('#online')).toContainText('Playing on another phone', { timeout: 20_000 });
  await expect(a.locator('#online')).toBeHidden({ timeout: 20_000 });
  await expect.poll(async () => (await summary(a)).turn, { timeout: 40_000 }).toBe((await summary(c)).turn);
  expect(errors).toEqual([]);
  await bCtx.close();
  await close();
});

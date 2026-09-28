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

/** Game server unreachable. */
const OFFLINE = 'debug&db=http%3A%2F%2F127.0.0.1%3A1&lobby=offline';

test("when the game server can't be reached, Host and Join say so (and hotseat still works)", async ({ page }) => {
  await page.goto(`./?${OFFLINE}`);
  for (const button of ['#host-online', '#join-online']) {
    await page.locator(button).tap();
    await expect(page.locator('#online')).toContainText("Couldn't reach the game server", { timeout: 15_000 });
    await expect(page.locator('#online').getByRole('button', { name: 'Try again' })).toBeVisible();
    await page.locator('#online .online-cancel').tap();
    await expect(page.locator('#setup')).toBeVisible();
  }
  await page.locator('#start').tap();
  await expect(page.locator('#setup')).toBeHidden();
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
  await host.getByLabel('Player 1 character').selectOption('tones');
  await host.getByLabel('Player 1 name').fill('Jack');
  await host.locator('#host-online').tap();
  const code = (await host.locator('#online-room-code').textContent({ timeout: 10_000 }))!;
  expect(code).toMatch(/^[A-Z]{4}$/);
  await host.screenshot({ path: 'test-results/room-host.png' });

  await guest.goto(`./?${q}`);
  await guest.locator('#join-online').tap();
  const game = guest.locator('#online-open .online-game');
  await expect(game).toHaveCount(1, { timeout: 10_000 });
  await expect(game).toContainText('Jack');
  await expect(game).toContainText('tap to join');
  await expect(game).toHaveAttribute('data-room', code);
  await expect(guest.locator('#online-live')).toContainText('No games on right now');
  await guest.screenshot({ path: 'test-results/room-join-list.png' });
  await game.tap();
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
  await host.locator('#host-online').tap();
  const code = (await host.locator('#online-room-code').textContent({ timeout: 10_000 }))!;
  const link = await host.locator('#online .online-link').inputValue();
  expect(link).toMatch(new RegExp(`#room=${code}$`));
  await expect(host.locator('#online-listed')).toHaveAttribute('aria-pressed', 'true'); // listed unless you say otherwise
  await host.locator('#online-listed').tap();
  await expect(host.locator('#online-listed')).toHaveAttribute('aria-pressed', 'false');
  await expect(host.locator('#online')).toContainText('Private');

  await guest.goto(`./?${q}`);
  await guest.locator('#join-online').tap();
  await expect(guest.locator('#online-open')).toContainText("No one's waiting");
  await guest.waitForTimeout(1000);
  await expect(guest.locator('#online-open .online-game')).toHaveCount(0);
  await guest.getByLabel('Room code').fill(code.toLowerCase());
  await guest.locator('#online').getByRole('button', { name: 'Join', exact: true }).tap();
  await playFromLobby(host, guest);

  // A wrong code is explained.
  const lost = await browser.newContext(devices['Pixel 7 landscape']);
  const third = await lost.newPage();
  await third.goto(`./?${q}#room=ZZZZ`);
  await third.locator('#online-accept').tap(); // an invite link asks first
  await expect(third.locator('#online')).toContainText('No game with code ZZZZ', { timeout: 35_000 });
  await lost.close();
  expect(errors).toEqual([]);
  await close();
});

test('a third phone watches a match in progress (from the Live list), view only', async ({ browser }) => {
  test.setTimeout(120_000);
  const { host, guest, q, errors, close } = await phones(browser, 'games-watch');
  await host.goto(`./?${q}`);
  await host.getByLabel('Player 1 name').fill('Ann');
  await host.locator('#host-online').tap();
  const code = (await host.locator('#online-room-code').textContent({ timeout: 10_000 }))!;
  await guest.goto(`./?${q}#room=${code}`);
  await guest.locator('#online-accept').tap(); // an invite link asks first
  await expect(host.locator('#online h2')).toHaveText('Connected!', { timeout: 20_000 });
  await host.locator('#online-start').tap();
  await expect(guest.locator('#online')).toBeHidden({ timeout: 15_000 });

  // A third phone: the match shows as in progress; tap to watch.
  const ctx = await browser.newContext(devices['Pixel 7 landscape']);
  const fan = await ctx.newPage();
  fan.on('pageerror', (e) => errors.push(e.message));
  await fan.goto(`./?${q}`);
  await fan.locator('#join-online').tap();
  const game = fan.locator('#online-live .online-game');
  await expect(game).toContainText('Ann (tones) vs', { timeout: 10_000 });
  await expect(game).toContainText('playing · watch');
  await expect(fan.locator('#online-open')).toContainText("No one's waiting");
  await fan.screenshot({ path: 'test-results/games-list.png' });
  await game.tap();
  await expect(fan.locator('#online')).toBeHidden({ timeout: 15_000 });
  await expect(fan.locator('#spectate-leave')).toBeVisible();
  await expect(fan.locator('.pad.right')).toBeHidden(); // no controls
  expect(await summary(fan)).toEqual(await summary(host));
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
  await expect(late.locator('#spectate-leave')).toBeVisible({ timeout: 15_000 });

  // Leaving takes the watcher back to the setup screen; the players carry on.
  await fan.locator('#spectate-leave').tap();
  await expect(fan.locator('#setup')).toBeVisible();
  expect(await canAct(guest)).toBe(true);
  expect(errors).toEqual([]);
  await ctx.close();
  await ctx2.close();
  await close();
});

test('a phone that drops out gets straight back into its seat (reload, or opening the game again)', async ({ browser }) => {
  test.setTimeout(150_000);
  const { host, guest, q: base, errors, close } = await phones(browser, 'games-rejoin');
  const q = `${base}&lost=1500`; // notice a quiet phone quickly
  await host.goto(`./?${q}`);
  await host.getByLabel('Player 1 name').fill('Ann');
  await host.locator('#host-online').tap();
  const code = (await host.locator('#online-room-code').textContent({ timeout: 10_000 }))!;
  await guest.goto(`./?${q}#room=${code}`);
  await guest.locator('#online-accept').tap(); // an invite link asks first
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
  await expect(host.locator('#net-away')).toContainText('Waiting for them to come back');
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

  // Leaving for good ends it for both, and the seat is forgotten.
  await guest.evaluate(() => (window as unknown as { __pooket: { net: { leave(): void } } }).__pooket.net.leave());
  await expect(host.locator('#online')).toContainText('Connection lost', { timeout: 15_000 });
  expect(errors).toEqual([]);
  await close();
});

test('the setup screen offers to rejoin a match from a while ago; typing its code rejoins too', async ({ browser }) => {
  test.setTimeout(120_000);
  const { host, guest, q: base, errors, close } = await phones(browser, 'games-rejoin-later');
  const q = `${base}&lost=1500`;
  await host.goto(`./?${q}`);
  await host.locator('#host-online').tap();
  const code = (await host.locator('#online-room-code').textContent({ timeout: 10_000 }))!;
  await guest.goto(`./?${q}#room=${code}`);
  await guest.locator('#online-accept').tap(); // an invite link asks first
  await playFromLobby(host, guest);

  // The guest dropped out a while ago (too long for rejoining by itself on opening).
  await guest.evaluate(() => {
    const seat = JSON.parse(localStorage.getItem('pooket.seat')!);
    localStorage.setItem('pooket.seat', JSON.stringify({ ...seat, ts: Date.now() - 30 * 60_000 }));
  });
  await guest.goto('about:blank');
  await guest.goto(`./?${q}`);
  await expect(guest.locator('#setup')).toBeVisible();
  await expect(guest.locator('#setup-rejoin')).toHaveText(`↩ Rejoin ${code}`);
  await guest.screenshot({ path: 'test-results/rejoin-button.png' });

  // Typing the code rejoins (it's this phone's match), rather than watching.
  await guest.locator('#join-online').tap();
  await guest.getByLabel('Room code').fill(code);
  await guest.locator('#online').getByRole('button', { name: 'Join', exact: true }).tap();
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
  await host.locator('#host-online').tap();
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
  await ghost.locator('#join-online').tap();
  await ghost.getByLabel('Room code').fill(code);
  await ghost.locator('#online').getByRole('button', { name: 'Join', exact: true }).tap();
  await expect(host.locator('#online h2')).toHaveText('Connected!', { timeout: 20_000 });
  await ctx.close();
  await expect(host.locator('#online-room-code')).toHaveText(code, { timeout: 20_000 }); // back to waiting, same code

  // The real player taps Join game and plays.
  await guest.locator('#online-accept').tap();
  await playFromLobby(host, guest);
  expect(errors).toEqual([]);
  await close();
});

test('a host that reloads mid-match goes straight back on the Games list', async ({ browser }) => {
  test.setTimeout(120_000);
  const { host, guest, q: base, errors, close } = await phones(browser, 'games-relist');
  const q = `${base}&lost=1500`;
  await host.goto(`./?${q}`);
  await host.getByLabel('Player 1 name').fill('Bo');
  await host.locator('#host-online').tap();
  const code = (await host.locator('#online-room-code').textContent({ timeout: 10_000 }))!;
  await guest.goto(`./?${q}#room=${code}`);
  await guest.locator('#online-accept').tap();
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
  await fan.locator('#join-online').tap();
  await expect(fan.locator('#online-live .online-game')).toContainText('Bo (tones) vs', { timeout: 10_000 });
  await ctx.close();
  expect(errors).toEqual([]);
  await close();
});

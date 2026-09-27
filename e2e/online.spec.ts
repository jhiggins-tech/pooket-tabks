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
const OFFLINE = 'debug&db=http%3A%2F%2F127.0.0.1%3A1&lan=none';

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

async function phones(browser: Browser, lan: string) {
  const q = `debug&db=${encodeURIComponent(db.url)}&lan=${lan}`;
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

test('same Wi-Fi: the host shows up in the Join list, one tap to connect (through the game server)', async ({ browser }) => {
  test.setTimeout(90_000);
  const { host, guest, q, errors, close } = await phones(browser, 'home-wifi');
  await host.goto(`./?${q}`);
  await host.getByLabel('Player 1 character').selectOption('tones');
  await host.getByLabel('Player 1 name').fill('Jack');
  await host.locator('#host-online').tap();
  const code = (await host.locator('#online-room-code').textContent({ timeout: 10_000 }))!;
  expect(code).toMatch(/^[A-Z]{4}$/);
  await host.screenshot({ path: 'test-results/room-host.png' });

  await guest.goto(`./?${q}`);
  await guest.locator('#join-online').tap();
  const game = guest.locator('#online-games .online-game');
  await expect(game).toHaveCount(1, { timeout: 10_000 });
  await expect(game).toContainText("Jack's game");
  await expect(game).toContainText(code);
  await guest.screenshot({ path: 'test-results/room-join-list.png' });
  await game.tap();
  await expect(host.locator('#online h2')).toHaveText('Connected!', { timeout: 20_000 });

  // The logs button copies a readable account of what happened, for bug reports.
  await host.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await host.locator('#online-logs').tap();
  await expect(host.locator('#online-logs')).toHaveText('✓ Logs copied');
  const log = await host.evaluate(() => navigator.clipboard.readText());
  for (const line of ['Pooket Tabks network log', `rooms: hosting ${code}`, `ui: room ${code} open, on the nearby list`, 'db: streaming', 'joined', 'ui: connected as host', 'session: hello from the other phone']) {
    expect(log).toContain(line);
  }
  console.log(log);
  await playFromLobby(host, guest);
  // Once connected, the game is off the list for anyone else.
  expect(errors).toEqual([]);
  await close();
});

test('any network: type the room code, or open the room link', async ({ browser }) => {
  test.setTimeout(90_000);
  const { host, guest, q, errors, close } = await phones(browser, 'none');
  await host.goto(`./?${q}`);
  await host.locator('#host-online').tap();
  const code = (await host.locator('#online-room-code').textContent({ timeout: 10_000 }))!;
  const link = await host.locator('#online .online-link').inputValue();
  expect(link).toMatch(new RegExp(`#room=${code}$`));

  await guest.goto(`./?${q}`);
  await guest.locator('#join-online').tap();
  await expect(guest.locator('#online-games')).toHaveCount(0); // no Wi-Fi list without a shared address
  await guest.getByLabel('Room code').fill(code.toLowerCase());
  await guest.locator('#online').getByRole('button', { name: 'Join', exact: true }).tap();
  await playFromLobby(host, guest);

  // A wrong code is explained.
  const lost = await browser.newContext(devices['Pixel 7 landscape']);
  const third = await lost.newPage();
  await third.goto(`./?${q}#room=ZZZZ`);
  await expect(third.locator('#online')).toContainText('No game with code ZZZZ', { timeout: 35_000 });
  await lost.close();
  expect(errors).toEqual([]);
  await close();
});

test('a third phone watches a match in progress (from the nearby list), view only', async ({ browser }) => {
  test.setTimeout(120_000);
  const { host, guest, q, errors, close } = await phones(browser, 'watch-wifi');
  await host.goto(`./?${q}`);
  await host.getByLabel('Player 1 name').fill('Ann');
  await host.locator('#host-online').tap();
  const code = (await host.locator('#online-room-code').textContent({ timeout: 10_000 }))!;
  await guest.goto(`./?${q}#room=${code}`);
  await expect(host.locator('#online h2')).toHaveText('Connected!', { timeout: 20_000 });
  await host.locator('#online-start').tap();
  await expect(guest.locator('#online')).toBeHidden({ timeout: 15_000 });

  // A third phone: the match shows as in progress; tap to watch.
  const ctx = await browser.newContext(devices['Pixel 7 landscape']);
  const fan = await ctx.newPage();
  fan.on('pageerror', (e) => errors.push(e.message));
  await fan.goto(`./?${q}`);
  await fan.locator('#join-online').tap();
  const game = fan.locator('#online-games .online-game');
  await expect(game).toContainText("Ann's game", { timeout: 10_000 });
  await expect(game).toContainText('watch');
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

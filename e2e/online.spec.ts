import { devices, expect, test, type Page } from '@playwright/test';

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

test('two phones play over WebRTC: QR link to join, reply relayed back, lobby, turns stay in sync', async ({ browser }) => {
  test.setTimeout(120_000);
  const phone = devices['Pixel 7 landscape'];
  const hostCtx = await browser.newContext(phone);
  const guestCtx = await browser.newContext(phone);
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  const errors: string[] = [];
  for (const p of [host, guest]) p.on('pageerror', (e) => errors.push(e.message));

  // Host picks kcaj and hosts: a QR code of the join link appears.
  await host.goto('./?debug');
  await host.getByLabel('Player 1 character').selectOption('kcaj');
  await host.locator('#host-online').tap();
  const qr = host.locator('#online canvas.online-qr');
  await expect(qr).toBeVisible({ timeout: 10_000 });
  const joinLink = (await qr.getAttribute('data-link'))!;
  expect(joinLink).toMatch(/#join=1~o~/);
  expect(joinLink.length).toBeLessThan(260);
  await host.screenshot({ path: 'test-results/online-host.png' });

  // The other phone opens the link (as its camera app would) and shows its reply.
  await guest.goto(`./?debug${joinLink.slice(joinLink.indexOf('#'))}`);
  const reply = guest.locator('#online canvas.online-qr');
  await expect(reply).toBeVisible({ timeout: 10_000 });
  const answerLink = (await reply.getAttribute('data-link'))!;
  expect(answerLink).toMatch(/#answer=1~a~/);
  await guest.screenshot({ path: 'test-results/online-guest.png' });

  // The host's camera app opens the reply in a new tab, which hands it to the waiting game tab.
  const relay = await hostCtx.newPage();
  await relay.goto(`./${answerLink.slice(answerLink.indexOf('#'))}`);
  await expect(relay.locator('#online h2')).toHaveText('Reply sent');

  // Connected: the lobby on both. The guest changes character there; the host starts.
  await expect(host.locator('#online h2')).toHaveText('Connected!', { timeout: 15_000 });
  await expect(guest.locator('#online h2')).toHaveText('Connected!', { timeout: 15_000 });
  await guest.getByLabel('Your character').selectOption('larinovsky');
  await expect(host.locator('.online-seat').nth(1)).toContainText('larinovsky');
  await host.screenshot({ path: 'test-results/online-lobby.png' });
  await host.locator('#online-start').tap();
  await expect(host.locator('#online')).toBeHidden();
  await expect(guest.locator('#online')).toBeHidden({ timeout: 5000 });
  await expect(host.locator('#turn-banner')).toHaveText('Your turn!');
  await expect(guest.locator('#turn-banner')).toHaveText("kcaj's turn");
  expect(await summary(guest)).toEqual(await summary(host));

  // The guest watches: controls step aside, and it sees the host's aim live.
  await expect(guest.locator('body')).toHaveAttribute('data-remote', 'true');
  await expect(guest.locator('#hint')).toHaveText('kcaj is aiming…');
  expect(await canAct(guest)).toBe(false);
  await host.getByRole('button', { name: 'More power' }).tap();
  await host.getByRole('button', { name: 'More power' }).tap();
  await expect.poll(() => guest.evaluate(() => (window as unknown as { __pooket: { state: { players: { power: number }[] } } }).__pooket.state.players[0]!.power)).toBe(
    await host.evaluate(() => (window as unknown as { __pooket: { state: { players: { power: number }[] } } }).__pooket.state.players[0]!.power),
  );
  await guest.screenshot({ path: 'test-results/online-watching.png' });

  // Host fires; when it has played out it's the guest's turn on both, and both match.
  await host.locator('#fire').tap();
  await expect.poll(() => canAct(guest), { timeout: 20_000 }).toBe(true);
  await expect(guest.locator('body')).toHaveAttribute('data-remote', 'false');
  await expect(host.locator('body')).toHaveAttribute('data-remote', 'true');
  expect(await summary(guest)).toEqual(await summary(host));

  // Guest fires back.
  await guest.locator('#fire').tap();
  await expect.poll(() => canAct(host), { timeout: 20_000 }).toBe(true);
  expect(await summary(guest)).toEqual(await summary(host));
  expect((await summary(host)).turn).toBe(3);

  // The guest leaves: the host is told.
  await guestCtx.close();
  await expect(host.locator('#online h2')).toHaveText('Connection lost', { timeout: 30_000 });
  await host.locator('#online .online-cancel').tap();
  await expect(host.locator('#setup')).toBeVisible();
  expect(errors).toEqual([]);
  await hostCtx.close();
});

test('joining by pasting the code, and a bad code is refused kindly', async ({ page }) => {
  await page.goto('./');
  await page.locator('#join-online').tap();
  await expect(page.locator('#online h2')).toHaveText('Join a game');
  await page.getByLabel("Host's code or link").fill('not a code');
  await page.locator('#online .online-paste button').tap();
  await expect(page.locator('#online p')).toContainText("doesn't look right");
  await page.locator('#online .online-cancel').tap();
  await expect(page.locator('#setup')).toBeVisible();
});

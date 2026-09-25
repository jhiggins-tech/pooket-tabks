import { expect, test } from '@playwright/test';

test('sets up players and plays a turn on a landscape phone', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('./?seed=12345');
  await expect(page.locator('#rotate')).toBeHidden();

  // --- Setup screen: two players, three characters, names pre-filled ---
  const rows = page.locator('.setup-row');
  await expect(rows).toHaveCount(2);
  const p1Char = page.getByLabel('Player 1 character');
  const p2Char = page.getByLabel('Player 2 character');
  const p1Name = page.getByLabel('Player 1 name');
  const p2Name = page.getByLabel('Player 2 name');
  await expect(p1Char.locator('option')).toHaveText(['tones', 'kie', 'kcaj']);
  await expect(p1Char).toHaveValue('tones');
  await expect(p2Char).toHaveValue('kie');
  await expect(p1Name).toHaveValue('tones');
  await expect(p2Name).toHaveValue('kie');

  // Picking a character pre-fills its name; a typed name sticks.
  await p2Char.selectOption('kcaj');
  await expect(p2Name).toHaveValue('kcaj');
  await p1Name.fill('Jack');
  await p1Char.selectOption('kie');
  await expect(p1Name).toHaveValue('Jack');
  const swatches = await rows.evaluateAll((els) => els.map((el) => getComputedStyle(el).getPropertyValue('--c')));
  expect(new Set(swatches).size).toBe(2);

  await page.screenshot({ path: 'test-results/setup.png' });
  await page.locator('#start').tap();
  await expect(page.locator('#setup')).toBeHidden();

  // --- Battle ---
  await expect(page.locator('#players .chip')).toHaveCount(2);
  await expect(page.locator('.chip.active .name')).toHaveText('Jack');
  await expect(page.locator('#players .chip .name').nth(1)).toHaveText('kcaj');
  await expect(page.locator('body')).toHaveAttribute('data-turn', '1');

  const weapons = page.locator('#weapons .weapon');
  await expect(weapons).toHaveCount(3);
  await expect(weapons.nth(0)).toHaveAttribute('aria-label', 'Shell, 5 left');
  await expect(weapons.nth(1)).toHaveAttribute('aria-label', 'Heavy Shell, 3 left');
  await expect(weapons.nth(2)).toHaveAttribute('aria-label', 'Trollogram, 1 left');
  await expect(weapons.nth(0)).toHaveAttribute('aria-pressed', 'true');

  // Slingshot: pull down-left from the middle of the screen => aim up-right.
  const vp = page.viewportSize()!;
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 40, cy + 45, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('#angle')).not.toHaveText('45° ▸');

  const powerBefore = Number(await page.locator('#power').textContent());
  await page.getByRole('button', { name: 'More power' }).tap();
  await expect(page.locator('#power')).toHaveText(String(Math.min(100, powerBefore + 1)));

  // Fire a tier 2 Heavy Shell.
  await weapons.nth(1).tap();
  await expect(weapons.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#fire').tap();

  await expect(page.locator('body')).toHaveAttribute('data-turn', '2', { timeout: 15_000 });
  await expect(page.locator('.chip.active .name')).toHaveText('kcaj');
  // Player 2 (kcaj) has their own full inventory.
  await expect(weapons.nth(0)).toHaveAttribute('aria-label', 'Double Park, 5 left');
  await expect(weapons.nth(1)).toHaveAttribute('aria-label', 'Hyperfixate, 3 left');
  await expect(weapons.nth(2)).toHaveAttribute('aria-label', 'Unmedicated, 1 left');
  await expect(weapons.nth(2)).toBeEnabled();

  await page.waitForTimeout(1700); // let the turn banner fade for a clean screenshot
  await page.screenshot({ path: 'test-results/phone-landscape.png' });

  // kcaj fires Double Park: a volley of two ice cream cones.
  await page.locator('#fire').tap();
  await page.waitForTimeout(450);
  await page.screenshot({ path: 'test-results/double-park.png' });
  await expect(page.locator('body')).toHaveAttribute('data-turn', '3', { timeout: 15_000 });
  await expect(page.locator('.chip.active .name')).toHaveText('Jack');
  expect(errors).toEqual([]);
});

test("kcaj's Hyperfixate beam and Unmedicated pill storm", async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./?seed=4242');
  await page.getByLabel('Player 1 character').selectOption('kcaj');
  await page.locator('#start').tap();

  const weapons = page.locator('#weapons .weapon');
  await expect(weapons.nth(1)).toHaveAttribute('aria-label', 'Hyperfixate, 3 left');
  await expect(weapons.nth(2)).toHaveAttribute('aria-label', 'Unmedicated, 1 left');

  // Hyperfixate: fire the beam at a low angle and catch it on screen.
  await weapons.nth(1).tap();
  for (let i = 0; i < 40; i++) await page.getByRole('button', { name: 'Rotate barrel clockwise' }).tap();
  await page.locator('#fire').tap();
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'test-results/hyperfixate.png' });
  await expect(page.locator('body')).toHaveAttribute('data-turn', '2', { timeout: 15_000 });

  // Player 2 lobs a shell back.
  await page.locator('#fire').tap();
  await expect(page.locator('body')).toHaveAttribute('data-turn', '3', { timeout: 15_000 });

  // Unmedicated: aim controls are greyed out and no aim needed.
  await weapons.nth(2).tap();
  await expect(page.locator('body')).toHaveAttribute('data-aimless', 'true');
  await expect(page.locator('.hint')).toBeVisible();
  const angle = await page.locator('#angle').textContent();
  await page.getByRole('button', { name: 'Rotate barrel anticlockwise' }).tap({ force: true });
  await expect(page.locator('#angle')).toHaveText(angle!);

  await page.locator('#fire').tap();
  await page.waitForTimeout(1600);
  await page.screenshot({ path: 'test-results/unmedicated.png' });
  await expect(page.locator('body')).toHaveAttribute('data-turn', '4', { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("tones' ten-1 water jet", async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./?seed=777');
  await expect(page.getByLabel('Player 1 character')).toHaveValue('tones');
  await page.locator('#start').tap();

  const weapons = page.locator('#weapons .weapon');
  await expect(weapons.nth(0)).toHaveAttribute('aria-label', 'ten-1, 5 left');
  await expect(weapons.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#fire').tap();

  // Pressure is still building early on, then the jet reaches full arc.
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'test-results/ten-1-building.png' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/ten-1-full.png' });
  await expect(page.locator('body')).toHaveAttribute('data-phase', 'flying');

  await expect(page.locator('body')).toHaveAttribute('data-turn', '2', { timeout: 20_000 });
  expect(errors).toEqual([]);
});

test("kie's Trollogram decoys and secret swap", async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./?seed=31&debug');
  await page.getByLabel('Player 1 character').selectOption('kie');
  await page.getByLabel('Player 2 character').selectOption('kcaj');
  await page.locator('#start').tap();

  type Debug = { state: { holograms: { id: number; x: number; y: number }[]; players: { x: number; y: number }[] }; renderer: { worldToScreen(x: number, y: number): { x: number; y: number } } };
  const holos = () => page.evaluate(() => (window as unknown as { __pooket: Debug }).__pooket.state.holograms.map((h) => ({ ...h })));
  const kiePos = () => page.evaluate(() => {
    const p = (window as unknown as { __pooket: Debug }).__pooket.state.players[0]!;
    return { x: p.x, y: p.y };
  });

  // Turn 1: kie deploys Trollogram. No aiming needed.
  const weapons = page.locator('#weapons .weapon');
  await expect(weapons.nth(2)).toHaveAttribute('aria-label', 'Trollogram, 1 left');
  await weapons.nth(2).tap();
  await expect(page.locator('#hint')).toHaveText('No aiming needed. Just FIRE');
  await page.locator('#fire').tap();
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'test-results/trollogram-deploy.png' });
  await expect(page.locator('body')).toHaveAttribute('data-turn', '2', { timeout: 15_000 });
  expect(await holos()).toHaveLength(2);

  // Turn 2: kcaj fires a laser straight up, missing everything.
  await weapons.nth(1).tap();
  for (let i = 0; i < 45; i++) await page.getByRole('button', { name: 'Rotate barrel clockwise' }).tap();
  await expect(page.locator('#angle')).toHaveText('90° ▴');
  await page.locator('#fire').tap();
  await expect(page.locator('body')).toHaveAttribute('data-turn', '3', { timeout: 15_000 });

  // Turn 3: kie taps a decoy to swap with it after firing.
  await expect(page.locator('#hint')).toHaveText('Drag to aim · tap a decoy to swap after firing');
  const [target] = await holos();
  const screen = await page.evaluate(
    ([x, y]) => (window as unknown as { __pooket: Debug }).__pooket.renderer.worldToScreen(x, y),
    [target!.x, target!.y - 8] as const,
  );
  await page.touchscreen.tap(screen.x, screen.y);
  await expect(page.locator('#hint')).toHaveText('Swapping to that decoy after you fire');
  await page.waitForTimeout(1600);
  await page.screenshot({ path: 'test-results/trollogram-pick.png' });

  const before = await kiePos();
  await page.locator('#fire').tap();
  // Catch the end-of-turn shimmer that hides the swap.
  await page.waitForFunction(() => (window as unknown as { __pooket: { state: { shimmers: unknown[] } } }).__pooket.state.shimmers.length > 0, undefined, { timeout: 15_000, polling: 16 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/trollogram-shimmer.png' });
  await expect(page.locator('body')).toHaveAttribute('data-turn', '4', { timeout: 15_000 });
  const after = await kiePos();
  expect(after.x).toBe(target!.x);
  expect((await holos()).some((h) => h.x === before.x)).toBe(true);
  expect(errors).toEqual([]);
});

test("tones' ten-2 jetpack", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./?seed=777&debug');
  await page.locator('#start').tap();
  type Debug = { state: { players: { x: number; y: number }[] } };
  const tonesPos = () => page.evaluate(() => {
    const p = (window as unknown as { __pooket: Debug }).__pooket.state.players[0]!;
    return { x: p.x, y: p.y };
  });

  const weapons = page.locator('#weapons .weapon');
  await expect(weapons.nth(1)).toHaveAttribute('aria-label', 'ten-2, 3 left');
  await weapons.nth(1).tap();
  const start = await tonesPos();
  await page.locator('#fire').tap();
  await expect(page.locator('#hint')).toHaveText(/ten-2 charging… (10|9)/);

  await page.waitForTimeout(8500);
  await expect(page.locator('#hint')).toHaveText(/ten-2 charging… [12]/);
  await page.screenshot({ path: 'test-results/ten-2-charging.png' });
  await page.waitForFunction(() => {
    const s = (window as unknown as { __pooket: { state: { jets: { launched: boolean }[] } } }).__pooket.state;
    return s.jets[0]?.launched === true;
  }, undefined, { timeout: 5_000, polling: 16 });
  await page.waitForTimeout(380);
  await page.screenshot({ path: 'test-results/ten-2-blastoff.png' });

  await expect(page.locator('body')).toHaveAttribute('data-turn', '2', { timeout: 20_000 });
  const end = await tonesPos();
  expect(Math.abs(end.x - start.x)).toBeGreaterThan(40);
  await page.screenshot({ path: 'test-results/ten-2-landed.png' });
  expect(errors).toEqual([]);
});

test('remembers the last setup', async ({ page }) => {
  await page.goto('./');
  await page.getByLabel('Player 1 name').fill('Remembered');
  await page.getByLabel('Player 2 character').selectOption('kcaj');
  await page.locator('#start').tap();
  await page.reload();
  await expect(page.getByLabel('Player 1 name')).toHaveValue('Remembered');
  await expect(page.getByLabel('Player 2 character')).toHaveValue('kcaj');
});

test('asks to rotate when held in portrait', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('./');
  await expect(page.locator('#rotate')).toBeVisible();
  await page.screenshot({ path: 'test-results/phone-portrait.png' });
});

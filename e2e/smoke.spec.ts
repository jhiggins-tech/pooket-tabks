import { expect, test } from '@playwright/test';

test('sets up players and plays a turn on a landscape phone', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('./?seed=12345');
  await expect(page.locator('#rotate')).toBeHidden();

  // --- Setup screen ---
  const rows = page.locator('.setup-row');
  await expect(rows).toHaveCount(2);
  await expect(page.getByLabel('Player 1 character')).toHaveValue('rookie');
  await page.getByLabel('Player 1 name').fill('Jack');
  await page.getByLabel('Player 2 name').fill('Sam');

  // Same character for everyone, but colours stay distinct.
  await page.locator('#add-player').tap();
  await expect(rows).toHaveCount(3);
  const swatches = await rows.evaluateAll((els) => els.map((el) => getComputedStyle(el).getPropertyValue('--c')));
  expect(new Set(swatches).size).toBe(3);
  await page.getByLabel('Remove player 3').tap();
  await expect(rows).toHaveCount(2);

  await page.screenshot({ path: 'test-results/setup.png' });
  await page.locator('#start').tap();
  await expect(page.locator('#setup')).toBeHidden();

  // --- Battle ---
  await expect(page.locator('#players .chip')).toHaveCount(2);
  await expect(page.locator('.chip.active .name')).toHaveText('Jack');
  await expect(page.locator('body')).toHaveAttribute('data-turn', '1');

  const weapons = page.locator('#weapons .weapon');
  await expect(weapons).toHaveCount(3);
  await expect(weapons.nth(0)).toHaveAttribute('aria-label', 'Shell, 5 left');
  await expect(weapons.nth(1)).toHaveAttribute('aria-label', 'Heavy Shell, 3 left');
  await expect(weapons.nth(2)).toHaveAttribute('aria-label', 'Mega Shell, 1 left');
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

  // Fire the one-and-only tier 3 round.
  await weapons.nth(2).tap();
  await expect(weapons.nth(2)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#fire').tap();

  await expect(page.locator('body')).toHaveAttribute('data-turn', '2', { timeout: 15_000 });
  await expect(page.locator('.chip.active .name')).toHaveText('Sam');
  // Sam has his own full inventory.
  await expect(weapons.nth(2)).toHaveAttribute('aria-label', 'Mega Shell, 1 left');
  await expect(weapons.nth(2)).toBeEnabled();

  await page.waitForTimeout(1700); // let the turn banner fade for a clean screenshot
  await page.screenshot({ path: 'test-results/phone-landscape.png' });
  expect(errors).toEqual([]);
});

test('remembers the last setup', async ({ page }) => {
  await page.goto('./');
  await page.getByLabel('Player 1 name').fill('Remembered');
  await page.locator('#start').tap();
  await page.reload();
  await expect(page.getByLabel('Player 1 name')).toHaveValue('Remembered');
});

test('asks to rotate when held in portrait', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('./');
  await expect(page.locator('#rotate')).toBeVisible();
  await page.screenshot({ path: 'test-results/phone-portrait.png' });
});

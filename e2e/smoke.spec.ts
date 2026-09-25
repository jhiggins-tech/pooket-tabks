import { expect, test } from '@playwright/test';

test('plays a turn on a landscape phone', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('./?seed=12345');
  await expect(page.locator('#rotate')).toBeHidden();
  await page.locator('#start').tap();
  await expect(page.locator('#title')).toBeHidden();

  await expect(page.locator('#players .chip')).toHaveCount(2);
  await expect(page.locator('.chip.active .name')).toHaveText('Player 1');
  await expect(page.locator('body')).toHaveAttribute('data-turn', '1');

  // Slingshot: pull down-left from the middle of the screen => aim up-right.
  const vp = page.viewportSize()!;
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 60, cy + 70, { steps: 5 });
  await page.mouse.up();
  const angle = await page.locator('#angle').textContent();
  expect(angle).toMatch(/°/);
  expect(angle).not.toBe('45° ▸'); // drag changed the aim

  // Fine-tune with the buttons.
  const powerBefore = Number(await page.locator('#power').textContent());
  await page.getByRole('button', { name: 'More power' }).tap();
  await expect(page.locator('#power')).toHaveText(String(Math.min(100, powerBefore + 1)));

  await page.locator('#fire').tap();
  await expect(page.locator('body')).toHaveAttribute('data-turn', '2', { timeout: 15_000 });
  await expect(page.locator('.chip.active .name')).toHaveText('Player 2');

  await page.waitForTimeout(1700); // let the turn banner fade for a clean screenshot
  await page.screenshot({ path: 'test-results/phone-landscape.png' });
  expect(errors).toEqual([]);
});

test('asks to rotate when held in portrait', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('./');
  await expect(page.locator('#rotate')).toBeVisible();
  await page.screenshot({ path: 'test-results/phone-portrait.png' });
});

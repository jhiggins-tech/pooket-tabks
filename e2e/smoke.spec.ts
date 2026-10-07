import { expect, startHotseat, test } from './support';

test('sets up players and plays a turn on a landscape phone', async ({ page }) => {
  await page.goto('./?seed=12345&debug');
  await expect(page.locator('#rotate')).toBeHidden();

  // --- Landing screen: the Game browser, or Local hotseat ---
  await expect(page.locator('#setup')).toBeVisible();
  await expect(page.locator('#open-browser')).toContainText('Game browser');
  await expect(page.locator('#turns-dot')).toBeHidden();
  await page.screenshot({ path: 'test-results/landing.png' });
  await page.locator('#open-hotseat').tap();
  await expect(page.locator('#setup')).toBeHidden();

  // --- Local hotseat: two players, a character each, names pre-filled ---
  const cards = page.locator('#hotseat .seat-card');
  await expect(cards).toHaveCount(2);
  const p1Char = page.getByLabel('Player 1 character');
  const p2Char = page.getByLabel('Player 2 character');
  const p1Name = page.getByLabel('Player 1 name');
  const p2Name = page.getByLabel('Player 2 name');
  await expect(p1Char.locator(':scope > option')).toHaveText(['tones2', 'kie', 'kcaj', 'torikloud', 'ciarra', 'larinovsky', 'garyoldmancorp (beta)', 'kiwicore (beta)']);
  await expect(p1Char.locator('optgroup[label="Coming soon"] option')).toHaveCount(4);
  await expect(p1Char).toHaveValue('tones');
  await expect(p2Char).toHaveValue('kie');
  await expect(p1Name).toHaveValue('tones2');
  await expect(p2Name).toHaveValue('kie');

  // Picking a character pre-fills its name; a typed name sticks.
  await p2Char.selectOption('kcaj');
  await expect(p2Name).toHaveValue('kcaj');
  await p1Name.fill('Jack');
  await p1Char.selectOption('kie');
  await expect(p1Name).toHaveValue('Jack');
  const colours = await cards.evaluateAll((els) => els.map((el) => getComputedStyle(el).getPropertyValue('--c')));
  expect(new Set(colours).size).toBe(2);

  await page.screenshot({ path: 'test-results/setup.png' });
  // Back to the landing screen and in again: the picks are kept.
  await page.locator('#hotseat-back').tap();
  await expect(page.locator('#setup')).toBeVisible();
  await page.locator('#open-hotseat').tap();
  await expect(p2Char).toHaveValue('kcaj');
  await page.locator('#start').tap();
  await expect(page.locator('#hotseat')).toBeHidden();

  // --- Battle ---
  await expect(page.locator('#players .chip')).toHaveCount(2);
  await expect(page.locator('.chip.active .name')).toHaveText('Jack');
  await expect(page.locator('#players .chip .name').nth(1)).toHaveText('kcaj');
  await expect(page.locator('body')).toHaveAttribute('data-turn', '1');

  const weapons = page.locator('#weapons .weapon');
  await expect(weapons).toHaveCount(3);
  await expect(weapons.nth(0)).toHaveAttribute('aria-label', 'Weasel Pop, 5 left');
  await expect(weapons.nth(1)).toHaveAttribute('aria-label', 'Trollogram, 3 left');
  await expect(weapons.nth(2)).toHaveAttribute('aria-label', 'Steal, 1 left');
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

  // Fire a tier 1 Weasel Pop: three tumbling weasels that land and scurry towards the enemy.
  await weapons.nth(0).tap();
  await expect(weapons.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#fire').tap();
  await page.waitForTimeout(450);
  expect(await page.evaluate(() => window.__pooket.state.projectiles.length)).toBe(3);
  await page.screenshot({ path: 'test-results/weasel-flight.png' });
  await page.waitForFunction(() => window.__pooket.state.projectiles.some((p) => p.walkDir !== 0), undefined, { timeout: 10_000, polling: 16 });
  // Pop Goes the Weasel plays while they scurry…
  const tuneOn = () => page.evaluate(() => window.__pooket.sfx.tunes.isPlaying('pop-goes-the-weasel'));
  await expect.poll(tuneOn).toBe(true);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/weasel-walk.png' });

  await expect(page.locator('body')).toHaveAttribute('data-turn', '2', { timeout: 15_000 });
  expect(await tuneOn()).toBe(false); // …and stops dead when the last one pops
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
});

test("kcaj's Hyperfixate beam and Unmedicated pill storm", async ({ page }) => {
  // Three turns, the last a ~13s pill storm: ~25s here, so the default 30s is too tight on a slow runner.
  test.setTimeout(60_000);
  await startHotseat(page, { seed: 4242, p1: 'kcaj' });

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
});

test("tones' ten-1 water jet", async ({ page }) => {
  await page.goto('./?seed=777');
  await expect(page.getByLabel('Player 1 character')).toHaveValue('tones');
  await page.locator('#open-hotseat').tap();
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
});

test("kie's Trollogram decoys and secret swap", async ({ page }) => {
  test.setTimeout(60_000); // several turns, each played out (about 30 s)
  await startHotseat(page, { seed: 31, p1: 'kie', p2: 'kcaj', query: 'debug' });

  const holos = () => page.evaluate(() => window.__pooket.state.holograms.map((h) => ({ ...h })));
  const kiePos = () => page.evaluate(() => {
    const p = window.__pooket.state.players[0]!;
    return { x: p.x, y: p.y };
  });

  // Turn 1: kie deploys Trollogram. No aiming needed.
  const weapons = page.locator('#weapons .weapon');
  await expect(weapons.nth(1)).toHaveAttribute('aria-label', 'Trollogram, 3 left');
  await weapons.nth(1).tap();
  await expect(page.locator('#hint')).toHaveText('No aiming needed. Just FIRE');
  const start = await kiePos();
  await page.locator('#fire').tap();
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'test-results/trollogram-deploy.png' });

  // Right away, kie can pick one of the new decoys to swap into this turn; FIRE says DONE.
  await expect(page.locator('#hint')).toHaveText(/^Tap a decoy to swap into it · DONE when ready \(\d\)$/);
  await expect(page.locator('#fire')).toHaveText('DONE');
  const fresh = await holos();
  expect(fresh).toHaveLength(2);
  const tapWorld = async (x: number, y: number) => {
    const at = await page.evaluate(([wx, wy]) => window.__pooket.renderer.worldToScreen(wx, wy), [x, y] as const);
    await page.touchscreen.tap(at.x, at.y);
  };
  await tapWorld(fresh[1]!.x, fresh[1]!.y - 8);
  await expect(page.locator('#hint')).toHaveText(/^Swapping into that decoy · DONE when ready/);
  await page.screenshot({ path: 'test-results/trollogram-cast-pick.png' });
  await page.locator('#fire').tap(); // DONE
  await expect(page.locator('body')).toHaveAttribute('data-turn', '2', { timeout: 5_000 });
  await expect(page.locator('#fire')).toHaveText('FIRE');
  expect((await kiePos()).x).toBe(fresh[1]!.x);
  expect((await holos()).some((h) => h.x === start.x)).toBe(true);

  // Turn 2: kcaj fires a laser straight up, missing everything.
  await weapons.nth(1).tap();
  const angle = () => page.evaluate(() => window.__pooket.state.players[1]!.angle);
  const turn = (await angle()) > 90 ? 'Rotate barrel clockwise' : 'Rotate barrel anticlockwise';
  for (let i = 0; i < 90 && (await angle()) !== 90; i++) await page.getByRole('button', { name: turn }).tap();
  await expect(page.locator('#angle')).toHaveText('90° ▴');
  await page.locator('#fire').tap();
  await expect(page.locator('body')).toHaveAttribute('data-turn', '3', { timeout: 15_000 });

  // Turn 3: kie switches back to Weasel Pop and taps a decoy to swap with it after firing.
  await weapons.nth(0).tap();
  await expect(page.locator('#hint')).toHaveText('Drag to aim · tap a decoy to swap after firing');
  const [target] = await holos();
  const screen = await page.evaluate(
    ([x, y]) => window.__pooket.renderer.worldToScreen(x, y),
    [target!.x, target!.y - 8] as const,
  );
  await page.touchscreen.tap(screen.x, screen.y);
  await expect(page.locator('#hint')).toHaveText('Swapping to that decoy after you fire');
  await page.waitForTimeout(1600);
  await page.screenshot({ path: 'test-results/trollogram-pick.png' });

  const before = await kiePos();
  await page.locator('#fire').tap();
  // Catch the end-of-turn shimmer that hides the swap.
  await page.waitForFunction(() => window.__pooket.state.fx.shimmers.length > 0, undefined, { timeout: 15_000, polling: 16 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/trollogram-shimmer.png' });
  await expect(page.locator('body')).toHaveAttribute('data-turn', '4', { timeout: 15_000 });
  const after = await kiePos();
  expect(after.x).toBe(target!.x);
  expect((await holos()).some((h) => h.x === before.x)).toBe(true);
});

test("kie's Steal roulette", async ({ page }) => {
  await startHotseat(page, { seed: 31, p1: 'kie', p2: 'tones', query: 'debug' });
  await page.waitForTimeout(1700); // let the turn banner fade

  const weapons = page.locator('#weapons .weapon');
  await weapons.nth(2).tap();
  await expect(page.locator('#hint')).toHaveText('No aiming needed. Just FIRE');
  await page.locator('#fire').tap();

  // The roulette spins over tones' weapons, one lit at a time; nothing else can be done meanwhile.
  const heist = page.locator('#heist');
  await expect(heist).toBeVisible();
  await expect(page.locator('.heist-title')).toHaveText('kie is stealing from tones2…');
  await expect(page.locator('.heist-card .wname')).toHaveText(['ten-1', 'ten-2', 'ten-3']);
  await expect(page.locator('.heist-card.lit')).toHaveCount(1);
  await expect(page.locator('#fire')).toBeDisabled();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'test-results/steal-spin.png' });

  // It lands: the round changes hands and Steal's slot now holds it.
  await expect(page.locator('.heist-card.stolen')).toHaveCount(1, { timeout: 5000 });
  const stolen = (await page.locator('.heist-card.stolen .wname').textContent())!;
  await expect(page.locator('.heist-result')).toHaveText(`kie stole ${stolen}!`);
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/steal-landed.png' });
  await expect(heist).toBeHidden({ timeout: 5000 });
  await expect(weapons.nth(2)).toHaveAttribute('aria-label', `${stolen}, 1 left`);
  await expect(weapons.nth(2)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('body')).toHaveAttribute('data-turn', '1'); // still kie's turn

  // And kie fires it.
  await page.locator('#fire').tap();
  await expect(weapons.nth(2)).toBeDisabled();
});

test("tones' ten-2 jetpack", async ({ page }) => {
  test.setTimeout(60_000);
  await startHotseat(page, { seed: 777, query: 'debug' });
  const tonesPos = () => page.evaluate(() => {
    const p = window.__pooket.state.players[0]!;
    return { x: p.x, y: p.y };
  });

  const weapons = page.locator('#weapons .weapon');
  await expect(weapons.nth(1)).toHaveAttribute('aria-label', 'ten-2, 3 left');
  await weapons.nth(1).tap();
  const start = await tonesPos();
  await page.locator('#fire').tap();
  await expect(page.locator('#hint')).toHaveText(/ten-2 charging… (10|9)/);

  await expect(page.locator('#hint')).toHaveText(/ten-2 charging… [12]$/, { timeout: 10_000 });
  await page.screenshot({ path: 'test-results/ten-2-charging.png' });
  await page.waitForFunction(() => {
    const s = window.__pooket.state;
    return s.jets[0]?.launched === true;
  }, undefined, { timeout: 5_000, polling: 16 });
  await page.waitForTimeout(380);
  await page.screenshot({ path: 'test-results/ten-2-blastoff.png' });

  await expect(page.locator('body')).toHaveAttribute('data-turn', '2', { timeout: 20_000 });
  const end = await tonesPos();
  expect(Math.abs(end.x - start.x)).toBeGreaterThan(40);
  await page.screenshot({ path: 'test-results/ten-2-landed.png' });
});

test("tones' ten-3 spew", async ({ page }) => {
  await startHotseat(page, { seed: 777 });
  const weapons = page.locator('#weapons .weapon');
  await expect(weapons.nth(2)).toHaveAttribute('aria-label', 'ten-3, 1 left');
  await weapons.nth(2).tap();
  await page.locator('#fire').tap();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/ten-3.png' });
  await expect(page.locator('body')).toHaveAttribute('data-turn', '2', { timeout: 15_000 });
  await expect(weapons.nth(2)).toBeEnabled(); // kie's turn now, with his own tier 3
});

test("torikloud's Sonic Boom and the kookaburra in the sky", async ({ page }) => {
  await page.goto('./?seed=777');
  await page.locator('#open-hotseat').tap();
  await page.getByLabel('Player 1 character').selectOption('torikloud');
  await expect(page.getByLabel('Player 1 name')).toHaveValue('torikloud');
  await page.getByLabel('Player 2 character').selectOption('larinovsky');
  await page.locator('#start').tap();

  const weapons = page.locator('#weapons .weapon');
  await expect(weapons.nth(1)).toHaveAttribute('aria-label', 'Sonic Boom, 3 left');
  await weapons.nth(1).tap();
  for (let i = 0; i < 40; i++) await page.getByRole('button', { name: 'Rotate barrel clockwise' }).tap();
  await page.locator('#fire').tap();
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'test-results/sonic-boom.png' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'test-results/sonic-boom-2.png' });
  await expect(page.locator('body')).toHaveAttribute('data-turn', '2', { timeout: 15_000 });
  // larinovsky's own kit.
  await expect(weapons.nth(1)).toHaveAttribute('aria-label', 'the Rizzler, 3 left');
});

test('drive with fuel before firing', async ({ page }) => {
  await startHotseat(page, { seed: 777, query: 'debug' });
  const me = () => page.evaluate(() => ({ ...window.__pooket.state.players[0]! }));
  const start = await me();

  // Hold ▶ for a second.
  const right = page.getByRole('button', { name: 'Drive right' });
  const box = (await right.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'test-results/drive.png' });
  await page.mouse.up();
  const after = await me();
  expect(after.x).toBeGreaterThan(start.x + 15);
  expect(after.fuel).toBeLessThan(start.fuel);
  const gauge = await page.locator('#fuel-fill').evaluate((e) => parseFloat((e as HTMLElement).style.width));
  expect(gauge).toBeLessThan(100);

  // Released: it stops.
  await page.waitForTimeout(300);
  expect((await me()).x).toBe(after.x);

  // After firing, driving does nothing.
  await page.locator('#fire').tap();
  await expect(right).toBeDisabled();
});

test("larinovsky's Pill Pusher, the Rizzler and Take a Nap", async ({ page }) => {
  await startHotseat(page, { seed: 777, p1: 'larinovsky', query: 'debug' });
  const weapons = page.locator('#weapons .weapon');
  await expect(weapons.nth(0)).toHaveAttribute('aria-label', 'Pill Pusher, 5 left');
  await expect(weapons.nth(1)).toHaveAttribute('aria-label', 'the Rizzler, 3 left');
  await expect(weapons.nth(2)).toHaveAttribute('aria-label', 'Take a Nap, 1 left');
  await expect(weapons.nth(3)).toHaveAttribute('aria-label', 'Women in Scam, 1 left');

  await weapons.nth(2).tap();
  await expect(page.locator('#hint')).toHaveText('No aiming needed. Just FIRE');
  await weapons.nth(0).tap();
  await page.locator('#fire').tap();
  // A close-up of the pills in flight: four different ones.
  await page.waitForFunction(() => window.__pooket.state.projectiles.length === 4, undefined, { timeout: 5_000, polling: 16 });
  await page.waitForTimeout(260);
  const pills = await page.evaluate(() => {
    const d = window.__pooket;
    return d.state.projectiles.map((p) => ({ ...d.renderer.worldToScreen(p.x, p.y), variant: p.variant }));
  });
  expect(new Set(pills.map((p) => p.variant))).toEqual(new Set([0, 1, 2, 3]));
  const xs = pills.map((p) => p.x);
  const ys = pills.map((p) => p.y);
  await page.screenshot({
    path: 'test-results/pill-pusher-pills.png',
    clip: { x: Math.min(...xs) - 30, y: Math.min(...ys) - 30, width: Math.max(...xs) - Math.min(...xs) + 60, height: Math.max(...ys) - Math.min(...ys) + 60 },
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/pill-pusher.png' });
  await expect(page.locator('body')).toHaveAttribute('data-turn', '2', { timeout: 15_000 });
});

test("larinovsky's Take a Nap: cats curl up alongside, and the weapons come back restocked", async ({ page }) => {
  await startHotseat(page, { seed: 777, p1: 'larinovsky', query: 'debug' });
  await page.evaluate(() => (window.__pooket.state.players[0]!.ammo = [1, 0, 1, 1]));
  await page.locator('#weapons .weapon').nth(2).tap();
  await page.locator('#fire').tap();
  await page.waitForFunction(() => window.__pooket.state.naps.length === 1);
  await page.waitForTimeout(900);
  const at = await page.evaluate(() => {
    const d = window.__pooket;
    const p = d.state.players[0]!;
    return d.renderer.worldToScreen(p.x, p.y);
  });
  await page.screenshot({ path: 'test-results/take-a-nap-cats.png', clip: { x: at.x - 90, y: at.y - 70, width: 180, height: 100 } });
  await expect(page.locator('body')).toHaveAttribute('data-turn', '2', { timeout: 10_000 });
  expect(await page.evaluate(() => window.__pooket.state.players[0]!.ammo)).toEqual([5, 3, 0, 1]);
});

test("larinovsky's Women in Scam: a bonus move, and a scammed round turns up as a weapon", async ({ page }) => {
  await startHotseat(page, { seed: 777, p1: 'larinovsky', p2: 'kcaj', query: 'debug' });
  const weapons = page.locator('#weapons .weapon');
  await weapons.nth(3).tap();
  await expect(page.locator('#hint')).toHaveText('Bonus move: FIRE it, then take your turn');
  await page.locator('#fire').tap();
  // Still larinovsky's turn, the bonus spent, and scamming.
  await expect(weapons.nth(3)).toHaveAttribute('aria-label', 'Women in Scam, 0 left');
  await expect(weapons.nth(3)).toBeDisabled();
  await expect(page.locator('body')).toHaveAttribute('data-turn', '1');
  await expect(page.locator('#players .scam')).toHaveCount(1);
  const upAndAway = (i: number) =>
    page.evaluate((i) => Object.assign(window.__pooket.state.players[i]!, { angle: 90, power: 5 }), i);
  await upAndAway(0);
  await page.locator('#fire').tap();
  await expect(page.locator('body')).toHaveAttribute('data-turn', '2', { timeout: 15_000 });
  // kcaj's turn: say their shot hits larinovsky (the hit itself is covered by the unit tests).
  await page.evaluate(() => (window.__pooket.state.players[0]!.scam!.loot = 'double-park'));
  await upAndAway(1);
  await page.locator('#fire').tap();
  await expect(page.locator('body')).toHaveAttribute('data-turn', '3', { timeout: 15_000 });
  await expect(weapons).toHaveCount(5);
  await expect(weapons.nth(4)).toHaveAttribute('aria-label', 'Double Park, 1 left');
  await expect(page.locator('#players .scam')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/women-in-scam.png' });
  await weapons.nth(4).tap();
  await expect(weapons.nth(4)).toHaveAttribute('aria-pressed', 'true');
});

test("kiwicore's berètta M2: the cap comes off his head, loops out through anything and back, and hits both ways", async ({ page }) => {
  await startHotseat(page, { seed: 777, p1: 'kiwicore', p2: 'kcaj', query: 'debug' });
  const at = await page.evaluate(() => {
    const d = window.__pooket;
    const p = d.state.players[0]!;
    return d.renderer.worldToScreen(p.x, p.y);
  });
  await page.screenshot({ path: 'test-results/kiwicore-cap.png', clip: { x: at.x - 50, y: at.y - 50, width: 100, height: 70 } });
  // Aimed right at kcaj (over whatever's between), with the power to reach: the far end of the loop is on them.
  await page.evaluate(() => {
    const [kiwi, kcaj] = window.__pooket.state.players as [typeof window.__pooket.state.players[0], typeof window.__pooket.state.players[0]];
    const dx = kcaj.x - kiwi.x;
    const dy = kiwi.y - kcaj.y;
    Object.assign(kiwi, { angle: Math.round((Math.atan2(dy, dx) * 180) / Math.PI), power: Math.round((Math.hypot(dx, dy) - 100) / 8) });
  });
  await page.locator('#fire').tap();
  await page.waitForFunction(() => window.__pooket.state.boomerangs.length === 1);
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'test-results/beretta-m2.png' });
  await expect(page.locator('body')).toHaveAttribute('data-turn', '2', { timeout: 10_000 });
  const hp = await page.evaluate(() => window.__pooket.state.players.map((p) => p.hp));
  expect(hp).toEqual([100, 60]);
});

test("garyoldmancorp's scooter: much faster than driving, and a wall is a crash", async ({ page }) => {
  await startHotseat(page, { seed: 777, p1: 'garyoldmancorp', query: 'debug' });
  const me = () => page.evaluate(() => ({ ...window.__pooket.state.players[0]! }));
  const start = await me();
  const right = page.getByRole('button', { name: 'Drive right' });
  const box = (await right.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/scooter.png' });
  await page.mouse.up();
  const after = await me();
  expect(after.x).toBeGreaterThan(start.x + 30); // a tank would have gone ~13px
  expect(after.fuel).toBeLessThan(start.fuel);
  // A wall right ahead: the next push is a crash.
  await page.evaluate(() => {
    const s = window.__pooket.state;
    const p = s.players[0]!;
    for (let y = p.y; y > p.y - 60; y -= 4) s.terrain.addDirt(p.x + 22, y, 5, [120, 90, 60]);
  });
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.mouse.up();
  const crashed = await me();
  expect(crashed.hp).toBe(crashed.maxHp - 5);
  expect(crashed.scooterCrash).toBe(1);
  await page.screenshot({ path: 'test-results/scooter-crash.png' });
});

test("garyoldmancorp's Diced Coffee: lactose free goes again, full cream jetpacks up, ends the turn and it's gone", async ({ page }) => {
  test.setTimeout(60_000);
  await startHotseat(page, { seed: 777, p1: 'garyoldmancorp', p2: 'kcaj', query: 'debug' });
  // The spinner's two draws (whether it fails, where it stops): `v`, then the game's own RNG again.
  const rig = (v: number) =>
    page.evaluate((v) => {
      const s = window.__pooket.state;
      const real = s.rng;
      let left = 2;
      s.rng = Object.assign(() => (left-- > 0 ? v : real()), { state: real.state });
    }, v);
  const weapons = page.locator('#weapons .weapon');
  const coffee = weapons.nth(3);
  await expect(coffee).toHaveAttribute('aria-label', 'Diced Coffee, bonus move: 10% chance of full cream');
  await coffee.tap();
  await expect(page.locator('#hint')).toHaveText('Diced Coffee: 10% full cream (ends your turn) · FIRE to spin');

  // Lactose free: the wheel spins, the tank drinks, and it's still gary's turn (with another to come).
  await rig(0.9);
  await page.locator('#fire').tap();
  await expect(page.locator('#coffee')).toBeVisible();
  await expect(page.locator('.coffee-label')).toHaveText(['full cream', 'lactose free']);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'test-results/diced-coffee-spinner.png' });
  await expect(page.locator('.coffee-result')).toHaveText('Lactose free! ☕ Go again', { timeout: 5_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/diced-coffee-drink.png' });
  await expect(page.locator('body')).toHaveAttribute('data-phase', 'aiming', { timeout: 5_000 });
  await expect(page.locator('#coffee')).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-turn', '1');
  await expect(page.locator('#players .again')).toHaveCount(1);
  await expect(coffee).toBeDisabled(); // once a turn
  await expect(coffee.locator('.pips')).toHaveText('had one');
  await expect(weapons.nth(0)).toHaveAttribute('aria-pressed', 'true');
  // Fire a shot: kcaj's turn is skipped.
  await page.evaluate(() => Object.assign(window.__pooket.state.players[0]!, { angle: 90, power: 5 }));
  await page.locator('#fire').tap();
  await expect(page.locator('body')).toHaveAttribute('data-turn', '2', { timeout: 15_000 });
  expect(await page.evaluate(() => window.__pooket.state.current)).toBe(0);
  await expect(page.locator('#turn-banner')).toHaveText("garyoldmancorp's turn");
  await expect(coffee).toHaveAttribute('aria-label', 'Diced Coffee, bonus move: 20% chance of full cream');

  // Full cream: a little jetpack straight up, the turn is over, and Diced Coffee is spilt for good.
  await coffee.tap();
  await rig(0);
  const ground = await page.evaluate(() => window.__pooket.state.players[0]!.y);
  await page.locator('#fire').tap();
  await expect(page.locator('.coffee-result')).toHaveText('Full cream… 🥛 turn over', { timeout: 5_000 });
  await expect.poll(() => page.evaluate(() => window.__pooket.state.players[0]!.y), { timeout: 5_000 }).toBeLessThan(ground - 40);
  await page.screenshot({ path: 'test-results/diced-coffee-spill.png' });
  await expect(page.locator('body')).toHaveAttribute('data-turn', '3', { timeout: 10_000 });
  expect(await page.evaluate(() => window.__pooket.state.current)).toBe(1);
  await expect(page.locator('#turn-banner')).toHaveText("kcaj's turn");
  // Back to gary: a shot selected, the coffee greyed out.
  await page.evaluate(() => Object.assign(window.__pooket.state.players[1]!, { angle: 90, power: 5 }));
  await page.locator('#fire').tap();
  await expect(page.locator('body')).toHaveAttribute('data-turn', '4', { timeout: 15_000 });
  await expect(coffee).toBeDisabled();
  await expect(coffee.locator('.pips')).toHaveText('spilt');
  await expect(weapons.nth(0)).toHaveAttribute('aria-pressed', 'true');
});

test("torikloud's Twins and Debate", async ({ page }) => {
  test.setTimeout(60_000);
  await startHotseat(page, { seed: 777, p1: 'torikloud', query: 'debug' });
  const weapons = page.locator('#weapons .weapon');
  await expect(weapons.nth(0)).toHaveAttribute('aria-label', 'Debate, 5 left');
  await expect(weapons.nth(2)).toHaveAttribute('aria-label', 'Twins, 1 left');
  const tori = () => page.evaluate(() => window.__pooket.state.players[0]!);

  // Twins: a ghost at a suggested spot; tap the ground to put the twin somewhere else, then FIRE.
  await weapons.nth(2).tap();
  await expect(page.locator('#hint')).toHaveText('Tap the ground to place your twin, then FIRE');
  const start = await tori();
  const target = start.x + 160;
  const at = await page.evaluate((x) => window.__pooket.renderer.worldToScreen(x, 300), target);
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await tori()).twinSpot, { timeout: 5_000 }).toBeCloseTo(target, -1);
  await page.screenshot({ path: 'test-results/twin-placing.png' });
  await page.locator('#fire').tap();
  await expect(page.locator('#players .chip').first().locator('.hp')).toHaveCount(2);
  expect((await tori()).twin!.x).toBeCloseTo(target, -1);
  await expect(page.locator('body')).toHaveAttribute('data-turn', '2', { timeout: 15_000 });

  // kie passes (fires straight up), then torikloud aims each tank on its own and both argue.
  for (let i = 0; i < 45; i++) await page.getByRole('button', { name: 'Rotate barrel clockwise' }).tap();
  await page.locator('#fire').tap();
  await expect(page.locator('body')).toHaveAttribute('data-turn', '3', { timeout: 15_000 });

  // Twins spent: its button is Yolk Sucker, greyed out while the two tanks' health is even.
  const hp = () => page.evaluate(() => {
    const p = window.__pooket.state.players[0]!;
    return [p.hp, p.twin!.hp];
  });
  await expect(weapons.nth(2)).toContainText('Yolk Sucker');
  await expect(weapons.nth(2)).toBeDisabled();
  // The twin takes a beating (as if hit): now there's yolk to share.
  await page.evaluate(() => {
    const p = window.__pooket.state.players[0]!;
    p.twin!.hp = 21;
  });
  await expect(weapons.nth(2)).toBeEnabled();
  const pool = (await hp()).reduce((a, b) => a + b, 0);
  await weapons.nth(2).tap();
  await expect(page.locator('#hint')).toHaveText('Bonus move: FIRE it, then take your turn');
  await page.locator('#fire').tap();
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'test-results/yolk-sucker.png' });
  const [main, twin] = await hp();
  expect([main, twin]).toEqual([pool - Math.floor(pool / 2), Math.floor(pool / 2)]);
  await expect(weapons.nth(2)).toBeDisabled(); // even again
  await expect(page.locator('body')).toHaveAttribute('data-turn', '3'); // still torikloud's turn

  await weapons.nth(0).tap();
  const aimSwitch = page.locator('#aim-switch');
  await expect(aimSwitch).toHaveText('🎯 Main tank');
  await aimSwitch.tap();
  await expect(aimSwitch).toHaveText('🎯 Twin');
  const before = await tori();
  for (let i = 0; i < 20; i++) await page.getByRole('button', { name: 'Rotate barrel anticlockwise' }).tap();
  const after = await tori();
  expect(after.twin!.angle).toBe((before.twin!.angle + 20) % 360);
  expect(after.angle).toBe(before.angle); // the main tank's aim is its own
  await expect(page.locator('#angle')).toHaveText(new RegExp(`${after.twin!.angle > 90 ? 180 - after.twin!.angle : after.twin!.angle}`));
  await page.screenshot({ path: 'test-results/twin-aiming.png' });
  await page.locator('#fire').tap();
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'test-results/debate-twins.png' });
  await expect(page.locator('body')).toHaveAttribute('data-turn', '4', { timeout: 20_000 });
});

test("ciarra's frog hops, Tattoo Gun, Sew and Marathon", async ({ page }) => {
  await startHotseat(page, { seed: 777, p1: 'ciarra', query: 'debug' });
  const weapons = page.locator('#weapons .weapon');
  await expect(weapons.nth(0)).toHaveAttribute('aria-label', 'Tattoo Gun, 5 left');
  await expect(weapons.nth(1)).toHaveAttribute('aria-label', 'Sew, 3 left');
  await expect(weapons.nth(2)).toHaveAttribute('aria-label', 'Marathon, 1 left');
  await expect(page.locator('.fuel small')).toHaveText('HOPS');

  // Hold ▶: she hops along.
  const x0 = await page.evaluate(() => window.__pooket.state.players[0]!.x);
  const right = page.getByRole('button', { name: 'Drive right' });
  const box = (await right.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/frog-hop.png' });
  await page.waitForTimeout(600);
  await page.mouse.up();
  await page.waitForFunction(() => window.__pooket.state.players[0]!.hop === null, undefined, { timeout: 5_000 }); // landed
  expect(await page.evaluate(() => window.__pooket.state.players[0]!.x)).toBeGreaterThan(x0 + 20);

  // Sew.
  await weapons.nth(1).tap();
  await page.locator('#fire').tap();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/sew.png' });
  await expect(page.locator('body')).toHaveAttribute('data-turn', '2', { timeout: 15_000 });
});

test('info screen explains every character and weapon', async ({ page }) => {
  await page.goto('./?seed=4242&debug');
  await page.locator('#open-hotseat').tap();
  await page.getByLabel('Player 1 character').selectOption('ciarra');

  // From the hotseat screen: opens on player 1's character.
  await page.locator('#hotseat-info').tap();
  const info = page.locator('#info');
  await expect(info).toBeVisible();
  await expect(page.locator('.info-character h2')).toHaveText('ciarra');
  await expect(page.locator('.info-card h3')).toHaveText(['Tattoo Gun', 'Sew', 'Marathon']);
  await expect(page.locator('.info-move b')).toHaveText(['Frog hops', 'Health']);
  await expect(page.locator('.info-health')).toHaveText('Health · 100');
  await page.getByRole('tab', { name: 'How to play' }).tap();
  await expect(page.locator('.info-list h2')).toHaveText(['Controls', 'Status effects']);
  await page.screenshot({ path: 'test-results/info-basics.png' });
  await page.locator('#info-close').tap();
  await expect(info).toBeHidden();

  // In battle: opens on the current player's character, pauses the game, and lists every character.
  await page.locator('#start').tap();
  await page.locator('#fire').tap(); // Tattoo Gun burst in flight
  await page.locator('#info-open').tap();
  await expect(page.locator('.info-character h2')).toHaveText('ciarra');
  await page.screenshot({ path: 'test-results/info-ciarra.png' });
  const shots = () => page.evaluate(() => JSON.stringify(window.__pooket.state.projectiles.map((p) => [p.x, p.y])));
  const frozen = await shots();
  expect(frozen).not.toBe('[]');
  await page.waitForTimeout(400);
  expect(await shots()).toBe(frozen);
  await expect(page.getByRole('tab')).toHaveCount(13); // how to play, the eight, and four coming soon
  for (const [name, weapon] of [['tones2', 'ten-2'], ['kie', 'Trollogram'], ['kcaj', 'Hyperfixate'], ['torikloud', 'Twins'], ['larinovsky', 'Take a Nap']]) {
    await page.getByRole('tab', { name, exact: true }).tap();
    await expect(page.locator('.info-card h3').filter({ hasText: weapon })).toBeVisible();
  }
  await page.getByRole('tab', { name: 'torikloud', exact: true }).tap();
  await expect(page.locator('.info-health')).toHaveText('Health · 150 (most start with 100)');
  await page.locator('#info-close').tap();
  await expect(info).toBeHidden();
  await expect.poll(shots).not.toBe(frozen); // and carries on once it's closed
});

test('upcoming characters: in the pickers and the info screen with a Coming soon banner, not playable', async ({ page }) => {
  await page.goto('./?debug');
  await page.locator('#open-hotseat').tap();
  const p2 = page.getByLabel('Player 2 character');
  const before = await p2.inputValue();
  await p2.selectOption('doctorfox');
  const card = page.locator('.seat-card').nth(1);
  await expect(card.locator('.coming-soon-banner')).toHaveText('Coming soon');
  await expect(page.locator('#start')).toBeDisabled();
  await page.screenshot({ path: 'test-results/coming-soon-hotseat.png' });
  // Back to someone playable: as before, and Start works again.
  await p2.selectOption(before);
  await expect(card.locator('.coming-soon-banner')).toHaveCount(0);
  await expect(page.locator('#start')).toBeEnabled();
  await expect(page.locator('#start')).toHaveText('Start battle');

  // The info screen: a tab each, with the banner.
  await page.locator('#hotseat-info').tap();
  for (const name of ['shotdownboyz', 'odsey', 'lankcity', 'doctorfox']) {
    await page.getByRole('tab', { name, exact: true }).tap();
    await expect(page.locator('.coming-soon h2')).toHaveText(name);
    await expect(page.locator('.coming-soon .coming-soon-banner')).toHaveText('Coming soon');
  }
  await page.screenshot({ path: 'test-results/coming-soon-info.png' });
  // Teased moves, marked work in progress.
  await page.getByRole('tab', { name: 'lankcity', exact: true }).tap();
  await expect(page.locator('.coming-soon-cards .info-card h3')).toHaveText(['HARD disk drive', 'lizard walk']);
  await expect(page.locator('.coming-soon-cards .info-tags')).toHaveText(['Tier 2', 'Movement']);
  await expect(page.locator('.coming-soon-wip')).toContainText('subject to change');
  await page.getByRole('tab', { name: 'shotdownboyz', exact: true }).tap();
  await expect(page.locator('.coming-soon-cards .info-card h3')).toHaveText(['summon digger', 'neurodiverge', 'tank build']);
  await page.screenshot({ path: 'test-results/coming-soon-teasers.png' });
  // garyoldmancorp is playable now, in beta.
  await page.getByRole('tab', { name: 'garyoldmancorp', exact: true }).tap();
  await expect(page.locator('.info-character .beta-banner')).toHaveText('Beta: stand-in moves for now');
  await expect(page.locator('.info-card h3')).toHaveText(['Beta Shot', 'Beta Mortar', 'Beta Bomb', 'Diced Coffee']);
  await expect(page.locator('.info-card').last().locator('.info-tags')).toHaveText('Bonus moveOnce a turnNo aiming');
  // So is kiwicore.
  await page.getByRole('tab', { name: 'kiwicore', exact: true }).tap();
  await expect(page.locator('.info-character .beta-banner')).toHaveText('Beta: stand-in moves for now');
  await expect(page.locator('.info-card h3')).toHaveText(['berètta M2', 'Beta Mortar', 'Beta Bomb']);
});

test('8-bit sound effects play, and the sound toggle is remembered', async ({ page }) => {
  await startHotseat(page, { seed: 77, p1: 'kcaj', query: 'debug' });
  const toggle = page.locator('#sound-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  // The first tap unlocked audio.
  await expect.poll(() => page.evaluate(() => window.__pooket.chip.ready)).toBe(true);

  // kcaj's Unmedicated: the jingle, a pill storm of pops and the damage oofs, all without errors.
  await page.locator('#weapons .weapon').nth(2).tap();
  await page.locator('#fire').tap();
  await expect.poll(() => page.evaluate(() => window.__pooket.sfx.played), { timeout: 10_000 }).toBeGreaterThan(3);
  await expect(page.locator('body')).toHaveAttribute('data-turn', '2', { timeout: 20_000 });

  // Mute, and it stays muted next visit.
  await toggle.tap();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle).toHaveText('🔇');
  expect(await page.evaluate(() => window.__pooket.chip.ready)).toBe(false);
  await page.reload();
  await page.locator('#open-hotseat').tap();
  await page.locator('#start').tap();
  await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'false');
});

test('remembers the last setup', async ({ page }) => {
  await page.goto('./');
  await page.locator('#open-hotseat').tap();
  await page.getByLabel('Player 1 name').fill('Remembered');
  await page.getByLabel('Player 2 character').selectOption('kcaj');
  await page.locator('#start').tap();
  await page.reload();
  await page.locator('#open-hotseat').tap();
  await expect(page.getByLabel('Player 1 name')).toHaveValue('Remembered');
  await expect(page.getByLabel('Player 2 character')).toHaveValue('kcaj');
});

test('asks to rotate when held in portrait', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('./');
  await expect(page.locator('#rotate')).toBeVisible();
  await page.screenshot({ path: 'test-results/phone-portrait.png' });
});

test('a first visit asks your name; it sticks, ✎ Change changes it, and it starts as Player 1 in hotseat', async ({ page }) => {
  await page.goto('./?askname');
  const prompt = page.locator('#name-prompt');
  await expect(prompt).toBeVisible();
  const ok = page.locator('#name-ok');
  await expect(ok).toBeDisabled();
  await prompt.getByRole('textbox').fill('   ');
  await expect(ok).toBeDisabled();
  await prompt.getByRole('textbox').fill('  Jack  ');
  await page.screenshot({ path: 'test-results/name-prompt.png' });
  await ok.tap();
  await expect(prompt).toBeHidden();
  await expect(page.locator('#you-name')).toHaveText('Jack');

  // Remembered: no question next time.
  await page.reload();
  await expect(page.locator('#setup')).toBeVisible();
  await expect(prompt).toBeHidden();
  await expect(page.locator('#you-name')).toHaveText('Jack');

  // ✎ Change, from the landing screen.
  await page.locator('#you-change').tap();
  await expect(prompt.getByRole('textbox')).toHaveValue('Jack');
  await prompt.getByRole('textbox').fill('Jacko');
  await ok.tap();
  await expect(page.locator('#you-name')).toHaveText('Jacko');

  // Hotseat: Player 1 starts as you; a name typed there is just for that match.
  await page.locator('#open-hotseat').tap();
  const p1 = page.getByLabel('Player 1 name');
  await expect(p1).toHaveValue('Jacko');
  await page.getByLabel('Player 1 character').selectOption('ciarra');
  await expect(p1).toHaveValue('Jacko');
  await p1.fill('Nan');
  await page.locator('#start').tap();
  await expect(page.locator('#players .chip').first()).toContainText('Nan');
  await page.reload();
  await expect(page.locator('#you-name')).toHaveText('Jacko');
  await page.locator('#open-hotseat').tap();
  await expect(p1).toHaveValue('Jacko');
});

test('a first visit from an invite link asks your name before the invite', async ({ page }) => {
  await page.goto('./?askname&debug&db=http%3A%2F%2F127.0.0.1%3A1&lobby=offline#room=ABCD');
  await expect(page.locator('#name-prompt')).toBeVisible();
  await expect(page.locator('#online-accept')).toBeHidden();
  await page.getByRole('textbox', { name: 'Your name' }).fill('Ann');
  await page.locator('#name-ok').tap();
  await expect(page.locator('#online-accept')).toBeVisible();
  await expect(page.locator('#you-name')).toHaveText('Ann');
});

test("what's new shows once per version, and can be reopened from setup", async ({ page }) => {
  await page.goto('./?whatsnew');
  const popup = page.locator('#whatsnew');
  await expect(popup).toBeVisible();
  await expect(popup.locator('h3').first()).not.toBeEmpty();
  await page.screenshot({ path: 'test-results/whatsnew.png' });
  await page.locator('#whatsnew-ok').tap();
  await expect(popup).toBeHidden();

  // Already seen: it stays away.
  await page.reload();
  await expect(page.locator('#setup')).toBeVisible();
  await expect(popup).toBeHidden();

  // The setup screen's button brings back the whole changelog.
  await page.locator('#setup-whatsnew').tap();
  await expect(popup).toBeVisible();
  expect(await popup.locator('h3').count()).toBeGreaterThan(1);
  await page.locator('#whatsnew-ok').tap();
  await expect(popup).toBeHidden();
});

test('who goes first is random, picked from the seed', async ({ page }) => {
  // Seed 12345 picks player 2, seed 12347 player 1.
  for (const [seed, starts] of [[12345, 'kie'], [12347, 'tones2']] as const) {
    await startHotseat(page, { seed, query: 'first=random' });
    await expect(page.locator('.chip.active .name')).toHaveText(starts);
  }
});

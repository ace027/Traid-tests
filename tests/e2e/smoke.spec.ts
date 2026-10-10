import { expect, test, type Page } from '@playwright/test';

const rollBtn = (p: Page) => p.getByRole('button', { name: 'Roll', exact: true });

// Drives whatever panel is showing for the active player until End Turn is available.
async function playTurn(p: Page): Promise<void> {
  await rollBtn(p).click();
  const endTurn = p.getByRole('button', { name: 'End Turn' });
  const goTo = p.getByRole('button', { name: /^Go to / });
  const attack = p.getByRole('button', { name: 'Attack', exact: true });
  const leave = p.getByRole('button', { name: 'Leave', exact: true });
  const waiting = p.locator('.waiting');
  for (let i = 0; i < 200; i++) {
    if (await p.locator('.winner-banner').count()) return;
    if (await endTurn.isVisible()) {
      await endTurn.click();
      return;
    }
    if (await goTo.count()) await goTo.first().click({ timeout: 2000 }).catch(() => {});
    else if (await attack.isVisible()) await attack.click({ timeout: 2000 }).catch(() => {});
    else if (await leave.isVisible()) await leave.click({ timeout: 2000 }).catch(() => {});
    else if (await waiting.count() && (await waiting.first().textContent())?.startsWith('Waiting for')) {
      // Turn passed automatically (e.g. roller defeated in battle).
      return;
    }
    await p.waitForTimeout(150);
  }
  throw new Error('turn did not complete');
}

test('two tabs create, join, start and take turns', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await a.goto('/');
  await a.locator('#create-name').fill('Ana');
  await a.locator('#create-class').selectOption('knight');
  await a.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(a.locator('#room-code')).toHaveText(/\S+/);
  const code = (await a.locator('#room-code').textContent())!.trim();

  await b.goto('/');
  await b.locator('#join-code').fill(code);
  await b.locator('#join-name').fill('Bo');
  await b.locator('#join-class').selectOption('mage');
  await b.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(b.locator('#room-code')).toHaveText(code);

  await expect(a.locator('#start-btn')).toBeEnabled();
  await a.locator('#start-btn').click();

  for (const p of [a, b]) {
    await expect(p.locator('canvas.board')).toBeVisible();
    await expect(p.locator('.score-row')).toHaveCount(2);
  }

  // First player's tab shows Roll; the other waits.
  await expect
    .poll(async () => (await rollBtn(a).count()) + (await rollBtn(b).count()))
    .toBe(1);
  const [active, other] = (await rollBtn(a).count()) ? [a, b] : [b, a];

  await playTurn(active);
  await expect(rollBtn(other)).toBeVisible({ timeout: 15_000 });

  // Reload mid-game: tab rejoins and still shows the board.
  await other.reload();
  await expect(other.locator('canvas.board')).toBeVisible();
  await expect(other.locator('.score-row')).toHaveCount(2);
  await expect(rollBtn(other)).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});

test('two tabs play a full game to game-over and agree on the winner', async ({ browser }) => {
  test.setTimeout(480_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await a.goto('/');
  await a.locator('#create-name').fill('Ana');
  await a.locator('#create-class').selectOption('knight');
  await a.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(a.locator('#room-code')).toHaveText(/\S+/);
  const code = (await a.locator('#room-code').textContent())!.trim();

  await b.goto('/');
  await b.locator('#join-code').fill(code);
  await b.locator('#join-name').fill('Bo');
  await b.locator('#join-class').selectOption('mage');
  await b.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(b.locator('#room-code')).toHaveText(code);

  await expect(a.locator('#start-btn')).toBeEnabled();
  await a.locator('#start-btn').click();

  for (const p of [a, b]) {
    await expect(p.locator('canvas.board')).toBeVisible();
    await expect(p.locator('.score-row')).toHaveCount(2);
  }

  const deadline = Date.now() + 420_000;
  while (!(await a.locator('.winner-banner').count()) && Date.now() < deadline) {
    for (const p of [a, b]) {
      if (await rollBtn(p).count()) await playTurn(p);
    }
    await a.waitForTimeout(100);
  }

  for (const p of [a, b]) {
    await expect(p.locator('.winner-banner')).toBeVisible({ timeout: 15_000 });
    await expect(p.locator('.ranking')).toBeVisible();
  }
  const bannerA = (await a.locator('.winner-banner').textContent())!.trim();
  expect(bannerA).toMatch(/wins!|Game over/);
  await expect(b.locator('.winner-banner')).toHaveText(bannerA);

  await ctxA.close();
  await ctxB.close();
});

import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

const STUB_PORT = 4590;
let stub: DshStubHost | undefined;
test.beforeAll(async () => { stub = new DshStubHost(STUB_PORT); await stub.start(); });
test.afterAll(async () => { await stub?.stop(); });

test('REAL engine, NO mocks: chips read the live progress file', async ({ page }) => {
  test.setTimeout(300_000);
  // deliberately NO route mocks — the real /api/skills plane runs
  await page.goto('/?sessionKey=' + STUB_SESSION_ID);
  const composer = page.locator('textarea').first();
  await expect(composer).toBeVisible();
  await composer.fill('/dsi-skill-shelf');
  await composer.press('Enter');
  await expect(page.getByTestId('skill-shelf')).toBeVisible();
  await page.getByTestId('shelf-reload').click();
  await expect(page.getByTestId('shelf-reload')).toHaveAttribute('data-reload-state', 'loading');
  const t0 = Date.now();
  // THE CHIP PROOF: at least one source chip is visibly working mid-harvest
  await expect(page.locator('[data-testid^="shelf-source-working-"]').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(15_000);
  await page.screenshot({ path: 'tmp/real-1-mid.png' });
  console.log('MID', Math.round((Date.now() - t0) / 1000) + 's',
    await page.getByTestId('shelf-reload-progress').textContent().catch(() => 'none'));
  await expect(page.getByTestId('shelf-reload')).toHaveAttribute('data-reload-state', 'done', { timeout: 400_000 });
  console.log('DONE at', Math.round((Date.now() - t0) / 1000) + 's');
  await page.screenshot({ path: 'tmp/real-2-done.png' });
  await expect(page.getByTestId('shelf-reload')).toHaveAttribute('data-reload-state', 'idle', { timeout: 10_000 });
  console.log('IDLE at', Math.round((Date.now() - t0) / 1000) + 's');
});

import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

test('probe visual explorer layout', async ({ page }) => {
  writeFileSync(process.env.DSI_CONFIG_PATH!, 'workspace:\n  layout: explorer\n', 'utf-8');
  await page.goto('/?sessionKey=' + 'e2e-panel-session-0001');
  await expect(page.getByTestId('session-workspace').first()).toBeVisible();
  await page.getByTestId('session-workspace').first().click();
  await expect(page.getByTestId('workspace-explorer')).toBeVisible();
  const col = page.getByTestId('panel-column').filter({ has: page.getByTestId('workspace-explorer') });
  const box = await col.boundingBox();
  console.log('PROBE explorer column width =', box?.width, 'height =', box?.height);
  await page.screenshot({ path: 'test-results/probe-1-explorer-open.png' });
  await page.getByTestId('tree-file').filter({ hasText: 'README.md' }).first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/probe-2-file-open.png' });
  const tab = page.getByTestId('workspace-file-tab-README.md');
  console.log('PROBE tab visible =', await tab.isVisible());
  const body = page.locator('[data-testid="workspace-file-panel"]');
  console.log('PROBE file panel count =', await body.count());
  const bbox = await body.first().boundingBox();
  console.log('PROBE file body box =', JSON.stringify(bbox));
});

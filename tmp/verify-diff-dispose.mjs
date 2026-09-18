import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: false, slowMo: 120 });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e?.message ?? e).slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
try {
  await page.goto('http://localhost:5175/?profile=widi', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('sidebar-session-card').first().click();
  const column = page.getByTestId('panel-column').first();
  await column.waitFor({ state: 'visible', timeout: 15000 });
  await column.getByTestId('session-workspace').click();
  await page.getByTestId('workspace-explorer').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.locator('[data-testid="tree-dir"][data-repo="true"]', { hasText: 'ai-proxy' }).first().click();
  await page.waitForTimeout(1500);
  await page.locator('[data-testid="tree-file"]', { hasText: 'package.json' }).first().click();
  await page.getByTestId('workspace-file-panel').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1000);
  // Diff -> Edit -> Diff -> Edit -> hard reload (every dispose path)
  for (let i = 0; i < 2; i++) {
    await page.getByTestId('file-view-diff').first().click();
    await page.waitForTimeout(1200);
    await page.getByTestId('file-view-edit').first().click();
    await page.waitForTimeout(800);
  }
  await page.getByTestId('file-view-diff').first().click();
  await page.waitForTimeout(1500);
  await page.reload();
  await page.waitForTimeout(2500);
  console.log('PAGE ERRORS:', errors.length === 0 ? 'NONE' : JSON.stringify(errors, null, 1));
  console.log('VERDICT no dispose error:', errors.length === 0 ? 'YES' : 'NO');
  await page.screenshot({ path: 'tmp/file-eye-dispose-clean.png' });
} catch (err) {
  console.error('FAILED:', err.message?.slice(0, 300));
  process.exitCode = 1;
} finally { await browser.close(); }

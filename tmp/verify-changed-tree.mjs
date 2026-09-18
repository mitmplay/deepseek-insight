import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: false, slowMo: 200 });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
try {
  await page.goto('http://localhost:5175/?profile=widi', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('sidebar-session-card').first().click();
  const column = page.getByTestId('panel-column').first();
  await column.waitFor({ state: 'visible', timeout: 15000 });
  await column.getByTestId('session-workspace').click();
  await page.getByTestId('workspace-explorer').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(3500);
  // expand ai-proxy to see its changed files
  await page.locator('[data-testid="tree-dir"][data-repo="true"]', { hasText: 'ai-proxy' }).first().click();
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid="tree-file"]')];
    return rows.map((el) => {
      const name = el.querySelector('.entry-name');
      const s = name ? getComputedStyle(name) : null;
      return { label: name?.textContent?.trim().slice(0, 30), changed: el.hasAttribute('data-changed'), fontWeight: s?.fontWeight, color: s?.color };
    });
  });
  console.log('TREE FILES:', JSON.stringify(info, null, 1));
  const changed = info.filter((r) => r.changed);
  const ok = changed.length > 0 && changed.every((r) => r.color === 'rgb(185, 28, 28)' && Number(r.fontWeight) >= 600);
  console.log('VERDICT changed tree files red+bold:', ok ? 'YES (' + changed.length + ' rows)' : 'NO');
  await page.screenshot({ path: 'tmp/git-eye-changed-tree.png' });
} catch (err) {
  console.error('FAILED:', err.message?.slice(0, 300));
  process.exitCode = 1;
} finally { await browser.close(); }

import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: false, slowMo: 150 });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
try {
  await page.goto('http://localhost:5175/?profile=widi', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('sidebar-session-card').first().click();
  const column = page.getByTestId('panel-column').first();
  await column.waitFor({ state: 'visible', timeout: 15000 });
  await column.getByTestId('session-workspace').click();
  await page.getByTestId('workspace-explorer').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(3000);
  // walk the ancestor chain in deepseek-insight: src → lib → components → answerer
  for (const label of ['deepseek-insight', 'src', 'lib', 'components']) {
    await page.locator('[data-testid="tree-dir"]', { hasText: label }).first().click();
    await page.waitForTimeout(1800);
  }
  const info = await page.evaluate(() => {
    const dirs = [...document.querySelectorAll('[data-testid="tree-dir"][data-hot="true"]')];
    const s = (el) => {
      const n = el.querySelector('.entry-name');
      const st = n ? getComputedStyle(n) : null;
      return { label: n?.textContent?.trim(), fontWeight: st?.fontWeight, color: st?.color };
    };
    return { hot: dirs.map(s) };
  });
  console.log('HOT DIRS:', JSON.stringify(info.hot, null, 1));
  const ok = info.hot.length > 0 && info.hot.every((r) => r.color === 'rgb(210, 105, 30)' && Number(r.fontWeight) >= 600);
  console.log('VERDICT ancestors chocolate bold:', ok ? 'YES (' + info.hot.length + ' dirs)' : 'NO');
  await page.screenshot({ path: 'tmp/git-eye-hotdirs.png' });
} catch (err) {
  console.error('FAILED:', err.message?.slice(0, 300));
  process.exitCode = 1;
} finally { await browser.close(); }

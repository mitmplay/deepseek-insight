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
  await page.waitForTimeout(3000);
  // expand ai-proxy so changed files render
  await page.locator('[data-testid="tree-dir"][data-repo="true"]', { hasText: 'ai-proxy' }).first().click();
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const style = (el) => {
      const name = el.querySelector('.entry-name');
      const s = name ? getComputedStyle(name) : null;
      return { label: name?.textContent?.trim().slice(0, 30), fontWeight: s?.fontWeight, color: s?.color };
    };
    return {
      flagged: [...document.querySelectorAll('[data-repo="true"]')].map(style),
      changed: [...document.querySelectorAll('[data-changed="true"]')].map(style)
    };
  });
  console.log('REPO ROWS:', JSON.stringify(info.flagged.slice(0, 2), null, 1), 'count:', info.flagged.length);
  console.log('CHANGED ROWS:', JSON.stringify(info.changed, null, 1));
  const okRepo = info.flagged.length > 0 && info.flagged.every((r) => r.color === 'rgb(255, 69, 0)' && Number(r.fontWeight) >= 600);
  const okChoc = info.changed.length > 0 && info.changed.every((r) => r.color === 'rgb(210, 105, 30)' && Number(r.fontWeight) >= 600);
  console.log('VERDICT repo #FF4500 bold:', okRepo ? 'YES' : 'NO', '| changed chocolate bold:', okChoc ? 'YES' : 'NO');
  await page.screenshot({ path: 'tmp/git-eye-orange-choc.png' });
} catch (err) {
  console.error('FAILED:', err.message?.slice(0, 300));
  process.exitCode = 1;
} finally { await browser.close(); }

import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: false, slowMo: 150 });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });

// Sample per-toolbar (keyed by DOM position among explorer toolbars) and
// report each toolbar's OWN tab history separately.
await page.addInitScript(() => {
  window.__tabHistories = [];
  const sample = () => {
    const tbs = [...document.querySelectorAll('[data-testid="explorer-toolbar"]')];
    tbs.forEach((tb, i) => {
      const t = tb.querySelector('[data-testid="git-tab-changes"]');
      const e = tb.querySelector('[data-testid="git-tab-explorer"]');
      if (!t || !e) return;
      const sel = t.getAttribute('aria-selected') === 'true' ? 'changes' : 'explorer';
      const hist = window.__tabHistories[i] ?? (window.__tabHistories[i] = []);
      if (!hist.length || hist[hist.length - 1].tab !== sel) {
        hist.push({ tab: sel, ms: Math.round(performance.now()) });
      }
    });
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
});

try {
  await page.goto('http://localhost:5175/?profile=widi', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('sidebar-session-card').first().click();
  const column = page.getByTestId('panel-column').first();
  await column.waitFor({ state: 'visible', timeout: 15000 });
  await column.getByTestId('session-workspace').click();
  await page.getByTestId('workspace-explorer').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(2000);

  await page.getByTestId('git-tab-changes').first().click();
  await page.waitForTimeout(1200);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('sidebar-session-card').first().click();
  const col = page.getByTestId('panel-column').first();
  await col.waitFor({ state: 'visible', timeout: 15000 });
  await col.getByTestId('session-workspace').click();
  await page.getByTestId('workspace-explorer').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(2000);

  const histories = await page.evaluate(() => window.__tabHistories);
  const changesPanel = histories.find((h) => h[h.length - 1].tab === 'changes');
  const changesVisible = await page.getByTestId('git-changes').first().isVisible().catch(() => false);
  histories.forEach((h, i) => console.log('toolbar ' + i + ' history:', JSON.stringify(h)));
  console.log('Changes view visible at end:', changesVisible);
  const glitch = changesPanel ? changesPanel.some((s) => s.tab === 'explorer') : null;
  console.log('VERDICT — changes panel ever flashed Explorer?', glitch === null ? 'no changes panel' : glitch ? 'YES (glitch)' : 'NO — clean');
} catch (err) {
  console.error('FAILED:', err.message?.slice(0, 300));
  process.exitCode = 1;
} finally {
  await browser.close();
}

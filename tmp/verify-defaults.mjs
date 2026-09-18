// Verify DSI defaults: clear localStorage -> sidebar width 400, filter row
// and panel group expanded. Usage: node tmp/verify-defaults.mjs [headed]
import { chromium } from '/Users/wharsojo/agentic-ai/deepseek-insight/node_modules/.pnpm/playwright@1.61.0/node_modules/playwright/index.mjs';

const headed = process.argv[2] === 'headed';
const browser = await chromium.launch({ headless: !headed, channel: undefined });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();

// Fresh storage: clear before load by opening the origin once.
await page.goto('http://localhost:5175/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.goto('http://localhost:5175/', { waitUntil: 'networkidle' });

const check = async (name, fn) => {
  try { console.log('PASS', name, '-', await fn()); }
  catch (e) { console.log('FAIL', name, '-', e.message.split('\n')[0]); }
};

// 1. Sidebar width = 400px
await check('sidebar width', async () => {
  const rail = page.getByTestId('app-sidebar');
  await rail.waitFor({ state: 'visible', timeout: 10_000 });
  const w = await rail.evaluate((el) => {
    const s = getComputedStyle(el);
    return { width: el.getBoundingClientRect().width, style: s.width, min: s.minWidth, max: s.maxWidth };
  });
  return JSON.stringify(w);
});

// 2. localStorage dsi-sidebar default width
await check('stored dsi-sidebar', async () => {
  return await page.evaluate(() => localStorage.getItem('dsi-sidebar') ?? '(absent)');
});

// 3. Filter row expanded
await check('filter row expanded', async () => {
  const t = page.getByTestId('filter-toggle');
  await t.waitFor({ state: 'visible', timeout: 10_000 });
  return 'aria-expanded=' + (await t.getAttribute('aria-expanded'));
});

// 4. Panel group expanded (only renders when panels exist)
await check('panel group', async () => {
  const t = page.getByTestId('sidebar-panel-group-toggle');
  const count = await t.count();
  if (count === 0) return 'no panels on floor -> group not rendered (n/a)';
  return 'aria-expanded=' + (await t.getAttribute('aria-expanded'));
});

// 5. Panel-group stored prefs
await check('stored dsi-panel-group', async () => {
  return await page.evaluate(() => localStorage.getItem('dsi-panel-group') ?? '(absent)');
});

console.log('DONE — browser stays open for manual inspection (Ctrl+C to quit).');
const since = Date.now();
while (Date.now() - since < 10 * 60 * 1000) await new Promise((r) => setTimeout(r, 15_000));
await browser.close();

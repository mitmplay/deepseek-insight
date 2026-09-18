// Verify SidebarOpenPanels group ships EXPANDED when a panel is on the floor.
import { chromium } from '/Users/wharsojo/agentic-ai/deepseek-insight/node_modules/.pnpm/playwright@1.61.0/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
await page.goto('http://localhost:5175/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.goto('http://localhost:5175/', { waitUntil: 'networkidle' });

// Open a panel: click the first session card in the sidebar.
const card = page.locator('[data-testid="sidebar-session-card"]').first();
await card.waitFor({ state: 'visible', timeout: 10_000 });
await card.click();
const toggle = page.getByTestId('sidebar-panel-group-toggle');
await toggle.waitFor({ state: 'visible', timeout: 10_000 });
const expanded = await toggle.getAttribute('aria-expanded');
const rows = await page.locator('[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"]').count();
console.log('panel-group aria-expanded =', expanded, '| visible rows =', rows);
console.log(expanded === 'true' && rows > 0 ? 'PASS panel group ships expanded' : 'FAIL');
// Reload: stored choice (expanded) survives.
await page.reload({ waitUntil: 'networkidle' });
await toggle.waitFor({ state: 'visible', timeout: 10_000 });
console.log('after reload aria-expanded =', (await toggle.getAttribute('aria-expanded')));
await browser.close();

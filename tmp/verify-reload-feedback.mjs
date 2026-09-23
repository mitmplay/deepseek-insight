// Headed verification #2: the reload button feedback state machine on the
// real dev server. Macro "/dsi-skill-shelf --reload" -> poll data-reload-state.
// Expect: loading (minutes) -> done (check, 5s) -> idle.
import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:5175/';
const browser = await chromium.launch({ headless: false, slowMo: 100 });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.setDefaultTimeout(600000);

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const rows = page.locator('[data-testid="sidebar-session-card"]');
  await rows.first().waitFor({ state: 'visible', timeout: 60000 });
  await rows.nth(1).click();

  const composer = page.locator('textarea').first();
  await composer.waitFor({ state: 'visible' });
  await composer.fill('/dsi-skill-shelf');
  await composer.press('Enter');

  const shelf = page.getByTestId('skill-shelf');
  await shelf.waitFor({ state: 'visible', timeout: 120000 });
  await page.getByTestId('shelf-reload').waitFor({ state: 'visible' });
  console.log('SHELF_OPEN');

  // The panel opens with the cached snapshot (loading=idle). The macro's
  // --reload already fired the reload API; the button state machine runs on
  // OUR click too - click the button and poll its state through the walk.
  const button = page.getByTestId('shelf-reload');
  await button.click();
  const transitions = [];
  let last = '';
  const t0 = Date.now();
  for (;;) {
    const s = await button.getAttribute('data-reload-state');
    if (s !== last) {
      transitions.push(s + ' @' + Math.round((Date.now() - t0) / 1000) + 's');
      console.log('STATE', s, '@' + Math.round((Date.now() - t0) / 1000) + 's');
      last = s;
    }
    if (s === 'idle' && transitions.length > 1) break; // done -> idle completes the walk
    if (Date.now() - t0 > 590000) break; // safety ceiling
    await page.waitForTimeout(500);
  }
  console.log('TRANSITIONS', JSON.stringify(transitions));

  // the reloaded snapshot carries the credentials
  await page.getByTestId('shelf-expand-all').click();
  const versions = page.locator('[data-testid^="shelf-version-"]');
  await versions.first().waitFor({ state: 'visible', timeout: 30000 });
  const n = await versions.count();
  const texts = [];
  for (let i = 0; i < n; i++) texts.push(await versions.nth(i).textContent());
  console.log('VERSION_TAGS', n, JSON.stringify(texts));
  console.log('REPO_DOORS', await page.locator('[data-testid^="shelf-door-repo-"]').count());
  await page.screenshot({ path: 'tmp/shelf-reload-feedback.png' });
  console.log('VERIFY_PASS');
} catch (e) {
  console.log('VERIFY_FAIL', String(e).slice(0, 400));
  await page.screenshot({ path: 'tmp/shelf-reload-feedback-FAIL.png' }).catch(() => {});
} finally {
  await browser.close();
}

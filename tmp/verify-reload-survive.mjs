// Headed verification #3: reload feedback SURVIVES a hard browser reload.
// Open shelf -> click reload (loading) -> HARD page.reload() mid-flight
// -> reopen the shelf: the persisted 'loading' blob re-issues the reload
// and the button walks loading -> done (check) -> idle (5s).
import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:5175/';
const browser = await chromium.launch({ headless: false, slowMo: 100 });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.setDefaultTimeout(600000);

async function openShelf() {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const rows = page.locator('[data-testid="sidebar-session-card"]');
  await rows.first().waitFor({ state: 'visible', timeout: 60000 });
  await rows.nth(1).click();
  const composer = page.locator('textarea').first();
  await composer.waitFor({ state: 'visible' });
  await composer.fill('/dsi-skill-shelf');
  await composer.press('Enter');
  await page.getByTestId('skill-shelf').waitFor({ state: 'visible', timeout: 60000 });
}

try {
  await openShelf();
  const button = page.getByTestId('shelf-reload');
  await button.click();
  const s0 = await button.getAttribute('data-reload-state');
  console.log('PRE_RELOAD_STATE', s0);
  if (s0 !== 'loading') throw new Error('expected loading after click, got ' + s0);

  // let Svelte's persistence effect flush to localStorage
  await page.waitForTimeout(800);
  const dumpKeys = () => page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('dsi-panels')).map((k) => k + ' :: ' + String(localStorage.getItem(k)).includes('"state":"loading"')));
  console.log('KEYS_BEFORE', JSON.stringify(await dumpKeys()));

  // HARD reload mid-flight
  await page.reload({ waitUntil: 'domcontentloaded' });
  console.log('HARD_RELOAD_DONE');
  await openShelf();
  const b2 = page.getByTestId('shelf-reload');
  await b2.waitFor({ state: 'visible' });
  const s1 = await b2.getAttribute('data-reload-state');
  console.log('RESTORED_STATE', s1);
  const note1 = await page.getByTestId('shelf-note').textContent().catch(() => '(no note)');
  console.log('NOTE_AT_RESTORE', note1);
  const shelfPart = await dumpKeys();
  console.log('KEYS_AFTER_BOOT', JSON.stringify(shelfPart));
  if (s1 !== 'loading' && s1 !== 'done') throw new Error('state did not survive: ' + s1);

  // the restored state must walk to done then idle
  const t0 = Date.now();
  const seen = [];
  let doneSeen = false;
  let idleAfterDone = false;
  for (;;) {
    const s = await b2.getAttribute('data-reload-state');
    if (!seen.length || seen[seen.length - 1] !== s) {
      seen.push(s + ' @' + Math.round((Date.now() - t0) / 1000) + 's');
      console.log('STATE', s, '@' + Math.round((Date.now() - t0) / 1000) + 's');
      if (s === 'done') doneSeen = true;
      if (s === 'idle' && doneSeen) { idleAfterDone = true; break; }
      if (s === 'idle' && !doneSeen && s1 === 'done') { idleAfterDone = true; break; }
    }
    if (Date.now() - t0 > 560000) break;
    await page.waitForTimeout(400);
  }
  console.log('TRANSITIONS', JSON.stringify(seen));
  if (!doneSeen || !idleAfterDone) throw new Error('walk incomplete: ' + JSON.stringify(seen));

  // the reloaded snapshot carries the credentials
  await page.getByTestId('shelf-expand-all').click();
  await page.locator('[data-testid^="shelf-version-"]').first().waitFor({ state: 'visible', timeout: 30000 });
  console.log('VERSION_TAGS', await page.locator('[data-testid^="shelf-version-"]').count());
  await page.screenshot({ path: 'tmp/shelf-reload-survive.png' });
  console.log('VERIFY_PASS');
} catch (e) {
  console.log('VERIFY_FAIL', String(e).slice(0, 400));
  await page.screenshot({ path: 'tmp/shelf-reload-survive-FAIL.png' }).catch(() => {});
} finally {
  await browser.close();
}

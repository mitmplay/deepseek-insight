// Headed verification: The Shelf Credentials on the real dev server.
// goto 5175 -> click 2nd sidebar session -> run "/dsi-skill-shelf --reload"
// -> expect version tags + repo/author doors visible on the real snapshot.
import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:5175/';
const browser = await chromium.launch({ headless: false, slowMo: 150 });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.setDefaultTimeout(240000);

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  // 1. click the 2nd session in the sidebar sessions list
  const rows = page.locator('[data-testid="sidebar-session-card"]');
  await rows.first().waitFor({ state: 'visible', timeout: 60000 });
  const count = await rows.count();
  console.log('SESSION_ROWS', count);
  if (count < 2) throw new Error('need at least 2 sessions in the sidebar');
  await rows.nth(1).click();

  // 2. run the macro with --reload against the REAL engine + SKR
  const composer = page.locator('textarea').first();
  await composer.waitFor({ state: 'visible' });
  await composer.fill('/dsi-skill-shelf');
  await composer.press('Enter');

  const shelf = page.getByTestId('skill-shelf');
  await shelf.waitFor({ state: 'visible', timeout: 120000 });
  console.log('SHELF_VISIBLE');

  // 3. expand all groups so the heads are on screen
  const expand = page.getByTestId('shelf-expand-all');
  if (await expand.isVisible().catch(() => false)) {
    await expand.click();
    console.log('EXPANDED');
  }

  // 4. --reload rebuilds the snapshot with version + authorUrl: wait it out
  const versions = page.locator('[data-testid^="shelf-version-"]');
  await versions.first().waitFor({ state: 'visible', timeout: 240000 });
  const nVer = await versions.count();
  const texts = [];
  for (let i = 0; i < nVer; i++) texts.push(await versions.nth(i).textContent());
  console.log('VERSION_TAGS', nVer, JSON.stringify(texts));

  const repoDoors = page.locator('[data-testid^="shelf-door-repo-"]');
  const authorDoors = page.locator('[data-testid^="shelf-door-author-"]');
  const nRepo = await repoDoors.count();
  const nAuthor = await authorDoors.count();
  console.log('REPO_DOORS', nRepo, 'AUTHOR_DOORS', nAuthor);
  console.log('FIRST_REPO_HREF', await repoDoors.first().getAttribute('href'));
  console.log('FIRST_AUTHOR_HREF', await authorDoors.first().getAttribute('href'));
  const label = await repoDoors.first().getAttribute('aria-label');
  console.log('REPO_ARIA_LABEL', JSON.stringify(label));

  // screenshot the open shelf for the report
  await page.screenshot({ path: 'tmp/shelf-credentials-headed.png', fullPage: false });
  console.log('SCREENSHOT tmp/shelf-credentials-headed.png');
  console.log('VERIFY_PASS');
} catch (e) {
  console.log('VERIFY_FAIL', String(e).slice(0, 500));
  await page.screenshot({ path: 'tmp/shelf-credentials-headed-FAIL.png' }).catch(() => {});
} finally {
  await browser.close();
}

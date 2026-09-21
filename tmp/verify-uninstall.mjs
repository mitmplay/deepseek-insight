import { chromium } from '@playwright/test';
import { writeFileSync, existsSync } from 'node:fs';

const BASE = 'http://127.0.0.1:5175';
const out = { steps: [], errors: [] };
const shot = async (page, name) => writeFileSync('/tmp/' + name + '.png', await page.screenshot());

const browser = await chromium.launch({ headless: false, slowMo: 200 });
const page = await browser.newPage({ viewport: { width: 1680, height: 980 } });
const composer = () => page.locator('textarea').first();

try {
  await page.goto(BASE + '/');
  await page.waitForLoadState('load');
  const cards = page.locator('[data-testid="sidebar-session-card"]');
  await cards.first().waitFor({ state: 'visible', timeout: 20000 });
  await cards.nth(1).click();
  await composer().waitFor({ state: 'visible', timeout: 20000 });
  out.steps.push('session opened');

  await composer().fill('/dsi-skill-shelf');
  await composer().press('Enter');
  const shelf = page.getByTestId('skill-shelf');
  await shelf.waitFor({ state: 'visible', timeout: 60000 });
  out.steps.push('shelf visible');

  // D5 negative check: a not-installed shelf row (arena) has no uninstall button
  const arenaRow = page.getByTestId('shelf-row-arena');
  await arenaRow.waitFor({ state: 'visible', timeout: 20000 });
  out.arenaUninstallAbsent = (await arenaRow.locator('[data-testid^="shelf-uninstall"]').count()) === 0;
  out.steps.push('not-installed row arena has no uninstall button: ' + out.arenaUninstallAbsent);

  // the signed architect row HAS the button - click it
  const archRow = page.getByTestId('shelf-row-architect');
  await archRow.waitFor({ state: 'visible', timeout: 20000 });
  const unBtn = archRow.getByTestId('shelf-uninstall-architect');
  out.architectUninstallPresent = await unBtn.count() === 1;
  await unBtn.click();
  out.steps.push('uninstall clicked');

  // after uninstall + refetch the row loses its badge and gains the install checkbox back
  await page.waitForFunction(
    () => {
      const row = document.querySelector('[data-testid="shelf-row-architect"]');
      return row !== null && row.querySelector('input[type="checkbox"]') !== null;
    },
    { timeout: 30000 }
  );
  out.steps.push('row flipped back to installable (uninstalled)');

  // disk truth
  out.folderGone = !existsSync('/Users/wharsojo/.agents/skills/architect');
  out.steps.push('architect folder gone from disk: ' + out.folderGone);
  await shot(page, 'uninstall-1-done');

  // slash menu check: architect must be GONE from the host catalog
  await composer().click();
  await composer().fill('');
  await composer().pressSequentially('/');
  await page.waitForTimeout(1500);
  const menu = page.getByTestId('slash-menu');
  await menu.waitFor({ state: 'visible', timeout: 10000 });
  const menuText = await menu.innerText();
  out.menuArchitectGone = !/\barchitect\b/i.test(menuText);
  out.steps.push('slash menu no longer lists architect: ' + out.menuArchitectGone);
  await shot(page, 'uninstall-2-menu');
} catch (e) {
  out.errors.push(e && e.message ? e.message : String(e));
  await shot(page, 'uninstall-error');
}
writeFileSync('/tmp/uninstall-verify.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await page.waitForTimeout(5000);
await browser.close();

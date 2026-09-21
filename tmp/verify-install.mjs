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
  const count = await cards.count();
  out.steps.push('sidebar cards: ' + count);
  // pick a DIFFERENT session - the second card, not the current one
  const target = count > 1 ? cards.nth(1) : cards.first();
  await target.click();
  out.steps.push('clicked a non-current session card');
  await composer().waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(1200);

  // open the shelf
  await composer().fill('/dsi-skill-shelf');
  await composer().press('Enter');
  const shelf = page.getByTestId('skill-shelf');
  await shelf.waitFor({ state: 'visible', timeout: 120000 });
  out.steps.push('shelf panel visible');
  await page.waitForTimeout(1500);
  await shot(page, 'real-1-shelf-open');

  const row = page.getByTestId('shelf-row-architect');
  await row.waitFor({ state: 'visible', timeout: 20000 });
  await row.locator('input[type="checkbox"]').check();
  out.steps.push('architect (1.1) selected');
  await shot(page, 'real-2-selected');

  await page.getByTestId('shelf-install').click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="shelf-row-architect"] input[type="checkbox"]') === null,
    { timeout: 180000 }
  );
  out.steps.push('install completed');
  await shot(page, 'real-3-installed');

  out.onDisk = existsSync('/Users/wharsojo/.agents/skills/architect/SKILL.md');
  out.provenance = existsSync('/Users/wharsojo/.agents/skills/architect/.dsi-provenance.json');
  out.voice = existsSync('/Users/wharsojo/.agents/skills/architect/.dsi-voice/en.json');

  await composer().click();
  await composer().fill('');
  await composer().pressSequentially('/');
  await page.waitForTimeout(1500);
  const menu = page.getByTestId('slash-menu');
  await menu.waitFor({ state: 'visible', timeout: 10000 });
  const menuText = await menu.innerText();
  out.menuShowsArchitect = /architect/i.test(menuText);
  out.steps.push('slash menu shows architect: ' + out.menuShowsArchitect);
  await shot(page, 'real-4-slash-menu');
} catch (e) {
  out.errors.push(e && e.message ? e.message : String(e));
  await shot(page, 'real-error');
}
writeFileSync('/tmp/real-verify.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await page.waitForTimeout(5000);
await browser.close();

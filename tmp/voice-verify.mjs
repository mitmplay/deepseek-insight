import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:5175';
const results = { steps: [], bug: null };
const shot = async (page, name) => writeFileSync('/tmp/' + name + '.png', await page.screenshot());

const browser = await chromium.launch({ headless: false, slowMo: 250 });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
try {
  // 1. open the app and a session from the sidebar
  await page.goto(BASE + '/');
  await page.waitForLoadState('load');
  const card = page.locator('[data-testid="sidebar-session-card"]').first();
  await card.waitFor({ state: 'visible', timeout: 20000 });
  await card.click();
  const composer = page.locator('textarea').first();
  await composer.waitFor({ state: 'visible', timeout: 20000 });
  results.steps.push('session opened, composer visible');

  // 2. type "/dsi-skill" - the slash menu must list dsi-skill-shelf
  await composer.fill('/dsi-skill');
  await composer.press('End');
  await page.waitForTimeout(600);
  const menu = page.getByTestId('slash-menu');
  await menu.waitFor({ state: 'visible', timeout: 5000 });
  const menuText = await menu.innerText();
  results.menuShowsShelf = /dsi-skill-shelf/i.test(menuText);
  results.steps.push('menu text captured; shows shelf row: ' + results.menuShowsShelf);
  await shot(page, 'voice-step1-menu');
  if (!results.menuShowsShelf) results.bug = 'BUG-1: /dsi-skill does not list dsi-skill-shelf in the slash menu';

  // 3. the ? helper in the current (default) language
  await composer.fill('');
  await composer.fill('/dsi-skill-shelf ?');
  await page.waitForTimeout(600);
  const help = page.getByTestId('command-help');
  await help.waitFor({ state: 'visible', timeout: 5000 });
  const helperEn = await help.innerText();
  results.helperEn = helperEn.slice(0, 400);
  results.steps.push('helper card visible (default language), ' + helperEn.length + ' chars');
  await shot(page, 'voice-step2-helper-en');

  // 4. switch to Bahasa indonesia
  await page.getByTestId('language-menu-trigger').click();
  await page.getByTestId('locale-option-id').click();
  await page.waitForTimeout(600);
  results.steps.push('locale switched to id');

  // 5. re-draft the help line and read the card again
  await composer.fill('');
  await composer.fill('/dsi-skill-shelf ?');
  await page.waitForTimeout(600);
  await help.waitFor({ state: 'visible', timeout: 5000 });
  const helperId = await help.innerText();
  results.helperId = helperId.slice(0, 400);
  await shot(page, 'voice-step3-helper-id');
  const sameText = helperEn === helperId;
  results.helperChangedAfterLocaleSwitch = !sameText;
  results.steps.push('helper after id switch: ' + (sameText ? 'UNCHANGED' : 'changed') + ' (' + helperId.length + ' chars)');
  if (sameText) results.bug = (results.bug ? results.bug + '; ' : '') + 'BUG-2: ? helper copy is not localized - identical after switching to Bahasa indonesia';
} catch (e) {
  results.error = String(e);
  await shot(page, 'voice-error');
}
writeFileSync('/tmp/voice-verify.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await page.waitForTimeout(6000); // stay visible for the operator
await browser.close();

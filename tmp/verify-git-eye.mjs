import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: false, slowMo: 250 });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });

try {
  await page.goto('http://localhost:5175/?profile=widi', { waitUntil: 'domcontentloaded' });

  // First sidebar item → panel column.
  await page.getByTestId('sidebar-session-card').first().click();
  const column = page.getByTestId('panel-column').first();
  await column.waitFor({ state: 'visible', timeout: 15000 });

  // Access chip → its menu → pick the danger-full-access option.
  const chip = page.getByTestId('access-mode-chip').first();
  await chip.waitFor({ state: 'visible', timeout: 15000 });
  console.log('ACCESS BEFORE:', (await chip.textContent())?.slice(0, 60));
  await chip.click();
  const menu = page.getByTestId('access-mode-menu');
  await menu.waitFor({ state: 'visible', timeout: 5000 });
  const options = page.getByTestId('access-mode-option');
  const count = await options.count();
  let picked = null;
  for (let i = 0; i < count; i++) {
    const txt = (await options.nth(i).textContent()) ?? '';
    if (txt.toLowerCase().includes('full access') || txt.includes('danger-full-access')) {
      picked = options.nth(i);
      console.log('PICKING OPTION:', txt.slice(0, 80));
      await picked.click();
      break;
    }
  }
  if (!picked) {
    console.log('OPTIONS SEEN:', await options.allTextContents());
  }
  // A full-access confirmation (acknowledge/enable) may be required.
  const enable = page.getByTestId('access-mode-enable');
  if (await enable.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('CONFIRMING full access');
    await enable.click();
  }
  await page.waitForTimeout(2500);
  console.log('ACCESS AFTER:', (await chip.textContent())?.slice(0, 60));

  // Close any open menu/popover, then open the explorer via the workspace chip.
  await page.keyboard.press('Escape');
  const wsChip = column.getByTestId('session-workspace');
  await wsChip.click();
  await page.getByTestId('workspace-explorer').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(2500);

  const rows = await page.evaluate(() => {
    const flagged = [...document.querySelectorAll('[data-repo="true"]')];
    const plain = [...document.querySelectorAll('[data-testid="tree-dir"]:not([data-repo])')];
    const style = (el) => {
      const name = el.querySelector('.entry-name');
      const icon = el.querySelector('.entry-icon');
      return {
        fontWeight: name ? getComputedStyle(name).fontWeight : null,
        color: icon ? getComputedStyle(icon).color : null
      };
    };
    return {
      flaggedCount: flagged.length,
      flagged: flagged.slice(0, 6).map((el) => ({ label: el.textContent?.trim().slice(0, 40), ...style(el) })),
      plainCount: plain.length
    };
  });
  console.log('REPO ROWS:', JSON.stringify(rows, null, 2));

  // Changes tab, if present.
  const changesTab = page.getByTestId('git-tab-changes');
  if (await changesTab.isVisible().catch(() => false)) {
    await changesTab.click();
    await page.waitForTimeout(2500);
    const changeInfo = await page.evaluate(() => ({
      groups: document.querySelectorAll('[data-testid="git-changes-group"]').length,
      rows: document.querySelectorAll('[data-testid="git-change-row"]').length
    }));
    console.log('CHANGES TAB:', JSON.stringify(changeInfo));
  } else {
    console.log('CHANGES TAB: not rendered');
  }

  const verdict = rows.flaggedCount > 0 && rows.flagged.every((r) => Number(r.fontWeight) >= 600);
  console.log('VERDICT bold repo rows visible:', verdict ? 'YES' : 'NO');
  await page.screenshot({ path: 'tmp/git-eye-headed.png', fullPage: false });
} catch (err) {
  console.error('FAILED:', err.message?.slice(0, 300));
  await page.screenshot({ path: 'tmp/git-eye-headed-failure.png', fullPage: false }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}

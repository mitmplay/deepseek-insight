import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: false, slowMo: 200 });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });

try {
  await page.goto('http://localhost:5175/?profile=widi', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('sidebar-session-card').first().click();
  const column = page.getByTestId('panel-column').first();
  await column.waitFor({ state: 'visible', timeout: 15000 });

  const wsChip = column.getByTestId('session-workspace');
  await wsChip.click();
  await page.getByTestId('workspace-explorer').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(3000);

  // Tree: repo rows vs plain rows — icon color, stroke shape, weight.
  const tree = await page.evaluate(() => {
    const info = (el) => {
      const name = el.querySelector('.entry-name');
      const iconSvg = el.querySelector('.entry-icon svg');
      const nameStyle = name ? getComputedStyle(name) : null;
      const iconColor = iconSvg ? getComputedStyle(iconSvg).color : null;
      // stroked folder detection: a path with stroke attr and no fill attr
      const stroked = iconSvg ? [...iconSvg.querySelectorAll('path')].some((p) => p.getAttribute('stroke') && !p.getAttribute('fill')) : false;
      return {
        label: el.querySelector('.entry-name')?.textContent?.trim().slice(0, 30),
        fontWeight: nameStyle?.fontWeight,
        nameColor: nameStyle?.color,
        iconColor,
        iconStroked: stroked
      };
    };
    const flagged = [...document.querySelectorAll('[data-repo="true"]')].map(info);
    const plain = [...document.querySelectorAll('[data-testid="tree-dir"]:not([data-repo])')].map(info);
    return { flagged, plain: plain.slice(0, 3) };
  });
  console.log('TREE FLAGGED:', JSON.stringify(tree.flagged, null, 1));
  console.log('TREE PLAIN:', JSON.stringify(tree.plain, null, 1));

  // Changes tab: rows purple + bold.
  const tab = page.getByTestId('git-tab-changes');
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
    await page.waitForTimeout(2500);
    const changes = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-testid="git-change-row"]')];
      const style = (el) => {
        const name = el.querySelector('.entry-name');
        const s = name ? getComputedStyle(name) : null;
        return { label: name?.textContent?.trim().slice(0, 30), fontWeight: s?.fontWeight, color: s?.color };
      };
      return { groups: document.querySelectorAll('[data-testid="git-changes-group"]').length, rowCount: rows.length, sample: rows.slice(0, 4).map(style) };
    });
    console.log('CHANGES:', JSON.stringify(changes, null, 1));
    await page.screenshot({ path: 'tmp/git-eye-purple-changes.png' });
    // back to Explorer for the tree screenshot
    await page.getByTestId('git-tab-explorer').click();
    await page.waitForTimeout(1200);
  }
  await page.screenshot({ path: 'tmp/git-eye-purple-tree.png' });

  const treeOk = tree.flagged.length > 0 && tree.flagged.every((r) => Number(r.fontWeight) >= 600 && r.nameColor === 'rgb(185, 28, 28)' && r.iconColor === 'rgb(247, 173, 49)' && r.iconStroked);
  const chRow = await page.evaluate(() => null);
  console.log('VERDICT repo rows (bold + #7c3aed + stroked icon):', treeOk ? 'YES' : 'NO');
} catch (err) {
  console.error('FAILED:', err.message?.slice(0, 300));
  await page.screenshot({ path: 'tmp/git-eye-purple-failure.png' }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}

import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: false, slowMo: 150 });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
try {
  await page.goto('http://localhost:5175/?profile=widi', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('sidebar-session-card').first().click();
  const column = page.getByTestId('panel-column').first();
  await column.waitFor({ state: 'visible', timeout: 15000 });
  await column.getByTestId('session-workspace').click();
  await page.getByTestId('workspace-explorer').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(2500);
  // expand ai-proxy (changed .gitignore/package.json) and open package.json
  await page.locator('[data-testid="tree-dir"][data-repo="true"]', { hasText: 'ai-proxy' }).first().click();
  await page.waitForTimeout(2000);
  await page.locator('[data-testid="tree-file"]', { hasText: 'package.json' }).first().click();
  await page.getByTestId('workspace-file-panel').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1500);
  // to Diff
  const diffBtn = page.getByTestId('file-view-diff').first();
  await diffBtn.waitFor({ state: 'visible', timeout: 10000 });
  await diffBtn.click();
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const view = document.querySelector('[data-testid="file-diff-view"]');
    if (!view) return { found: false };
    const el = view.querySelector('.monaco-diff-editor');
    const cls = el ? el.className : '';
    const sideBySide = cls.includes('side-by-side');
    const inline = cls.includes('inline');
    const editors = view.querySelectorAll('.monaco-editor').length;
    return { found: true, className: cls.slice(0, 200), sideBySide, inline, monacoEditorCount: editors };
  });
  console.log('DIFF DOM:', JSON.stringify(info, null, 1));
  const ok = info.found && info.sideBySide && info.monacoEditorCount >= 2;
  console.log('VERDICT side-by-side:', ok ? 'YES' : 'NO');
  await page.screenshot({ path: 'tmp/file-eye-diff-sbs.png' });
} catch (err) {
  console.error('FAILED:', err.message?.slice(0, 300));
  await page.screenshot({ path: 'tmp/file-eye-diff-failure.png' }).catch(() => {});
  process.exitCode = 1;
} finally { await browser.close(); }

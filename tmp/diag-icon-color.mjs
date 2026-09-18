import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
await page.goto('http://localhost:5175/?profile=widi', { waitUntil: 'domcontentloaded' });
await page.getByTestId('sidebar-session-card').first().click();
const column = page.getByTestId('panel-column').first();
await column.waitFor({ state: 'visible', timeout: 15000 });
await column.getByTestId('session-workspace').click();
await page.getByTestId('workspace-explorer').first().waitFor({ state: 'visible', timeout: 15000 });
await page.waitForTimeout(3000);
const diag = await page.evaluate(() => {
  const row = document.querySelector('[data-testid="tree-dir"]');
  const span = row?.querySelector('.entry-icon');
  const svg = span?.querySelector('svg');
  const spanStyle = span ? getComputedStyle(span) : null;
  // find CSS rules whose selector text mentions entry-icon
  const rules = [];
  for (const sheet of document.styleSheets) {
    let list; try { list = sheet.cssRules; } catch { continue; }
    for (const r of list) {
      if (r.selectorText && r.selectorText.includes('entry-icon')) rules.push(r.cssText.slice(0, 200));
    }
  }
  return {
    rowClasses: row?.className,
    spanColor: spanStyle?.color,
    svgColor: svg ? getComputedStyle(svg).color : null,
    svgHTML: svg ? svg.outerHTML.slice(0, 160) : null,
    rules
  };
});
console.log(JSON.stringify(diag, null, 1));
await browser.close();

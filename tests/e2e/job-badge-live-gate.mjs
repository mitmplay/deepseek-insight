/**
 * Job Badge Live Gate (ADR 2026-10-17 D4) — the acceptance test that
 * exposed the bug is the gate that clears it. Run headed against a REAL
 * floor with a REAL live harness job running:
 *
 *   node tests/e2e/job-badge-live-gate.mjs [baseUrl] [expectedBadgeText]
 *
 * Passes when a [data-testid=job-badge-trigger] is visible and its text
 * parses to a count >= 1 while jobs are live; captures a screenshot and
 * the roster network log beside it as evidence.
 */
import { chromium } from '/Users/wharsojo/agentic-ai/deepseek-insight/node_modules/.pnpm/playwright@1.61.0/node_modules/playwright/index.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:5175';
const outDir = process.argv[3] ?? '/Users/wharsojo/agentic-ai/deepseek-insight/tmp';
const browser = await chromium.launch({ headless: false, slowMo: 150 });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const rosterResponses = [];
page.on('response', async (res) => {
  if (res.url().includes('/api/dsh/jobs')) {
    rosterResponses.push(res.status() + ' ' + (await res.text().catch(() => '')).slice(0, 160));
  }
});
await page.goto(base, { waitUntil: 'networkidle' });
const badge = page.locator('[data-testid="job-badge-trigger"]').first();
let ok = false;
try {
  await badge.waitFor({ state: 'visible', timeout: 20_000 });
  const text = (await badge.textContent()) ?? '';
  const count = parseInt(text.replace(/[^0-9]/g, ''), 10);
  ok = Number.isFinite(count) && count >= 1;
  console.log('BADGE TEXT:', JSON.stringify(text), '— count:', count, '— PASS:', ok);
  await badge.click();
  await page.waitForTimeout(800);
  const popoverText = await page.locator('[data-testid="job-badge-popover"]').first().textContent().catch(() => 'n/a');
  console.log('POPOVER:', JSON.stringify((popoverText ?? '').slice(0, 300)));
} catch {
  console.log('BADGE NOT VISIBLE within 20s — FAIL');
}
await page.screenshot({ path: `${outDir}/live-gate-badge.png`, fullPage: false });
const { writeFileSync } = await import('node:fs');
writeFileSync(`${outDir}/live-gate-network.log`, rosterResponses.join('\n'));
console.log('ROSTER RESPONSES:', rosterResponses.length, '— non-200:', rosterResponses.filter((r) => !r.startsWith('200')).length);
await browser.close();
process.exit(ok ? 0 : 1);

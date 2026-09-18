/**
 * Real-session headed verification (operator BUG report, 2026-09-14).
 * NOT the e2e stub: drives the operator's RUNNING dev server (:5175),
 * opens a REAL recent session (bare-id dir created today by the real
 * harness), clicks the real button, reads the REAL clipboard, and
 * compares byte-for-byte with the path resolved straight from disk.
 */
import { chromium } from '../node_modules/.pnpm/@playwright+test@1.61.0/node_modules/@playwright/test/index.mjs';
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const HOME = process.env.HOME;
const ROOT = join(HOME, '.dsh', 'sessions');
const BASE = 'http://127.0.0.1:5175';

// Newest real session dirs across every project dir (disk truth).
const candidates = [];
for (const proj of readdirSync(ROOT)) {
  const p = join(ROOT, proj);
  try {
    for (const name of readdirSync(p)) {
      const full = join(p, name);
      if (statSync(full).isDirectory()) candidates.push({ id: name, full });
    }
  } catch {}
}
candidates.sort((a, b) => statSync(b.full).mtimeMs - statSync(a.full).mtimeMs);
console.log('newest real session dirs:', candidates.slice(0, 3).map((c) => c.id));

const browser = await chromium.launch({ headless: false, slowMo: 300 });
const context = await browser.newContext({
  permissions: ['clipboard-read', 'clipboard-write'],
  viewport: { width: 1400, height: 900 }
});
const page = await context.newPage();

let failures = 0;
for (const cand of candidates.slice(0, 3)) {
  const expected = cand.full; // disk truth: the dir itself
  console.log('\n=== session', cand.id, '===');
  await page.goto(BASE + '/?sessionKey=' + cand.id, { waitUntil: 'domcontentloaded' });
  const header = page.getByTestId('session-id-and-name');
  try {
    await header.waitFor({ state: 'visible', timeout: 15000 });
  } catch {
    console.log('FAIL: header never rendered (page state:', await page.title(), ')');
    failures++;
    continue;
  }
  const button = header.locator('[data-testid="conversation-header-copy-path"]');
  const visible = await button.isVisible().catch(() => false);
  if (!visible) {
    console.log('FAIL: button not visible');
    failures++;
    continue;
  }
  console.log('button visible: yes');
  await button.click();
  await page.waitForTimeout(300);
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  const ok = clipboard === expected;
  console.log('clipboard :', clipboard);
  console.log('disk truth:', expected);
  console.log(ok ? 'MATCH ✅' : 'MISMATCH ❌');
  if (!ok) failures++;
}
await page.screenshot({ path: 'tmp/verify-real-session-path.png', fullPage: false });
await browser.close();
console.log('\nRESULT:', failures === 0 ? 'ALL REAL SESSIONS VERIFIED ✅' : failures + ' FAILURE(S) ❌');
process.exit(failures === 0 ? 0 : 1);

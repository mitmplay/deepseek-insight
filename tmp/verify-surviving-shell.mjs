import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:5175';
const MARK = Math.floor(Math.random() * 1_000_000);
const plain = (t) => t.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '').replace(/[\x00-\x1f]/g, '').replace(/\s+/g, '');

const browser = await chromium.launch({ headless: false, slowMo: 120 });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const log = (m) => console.log('•', m);

try {
  await page.goto(BASE + '/');
  await page.waitForSelector('[data-testid="sidebar-session-card"]', { timeout: 20000 });
  log('floor loaded');

  // 1. click the 2nd session in the sidebar sessions list
  await page.locator('[data-testid="sidebar-session-card"]').nth(1).click();
  await page.waitForTimeout(800);
  log('clicked 2nd sidebar session');

  // 2. run /dsi-terminal in the composer
  const input = page.locator('textarea').first();
  await input.fill('/dsi-terminal');
  await input.press('Enter');
  await page.waitForSelector('[data-testid="panel-terminal"]', { timeout: 20000 });
  log('terminal panel open');

  // 3. type ls -a into the terminal
  await page.getByTestId('terminal-host').click();
  await page.keyboard.type('ls -a'); await page.keyboard.press('Enter'); await page.waitForTimeout(500); await page.keyboard.type('echo SURVIVE-' + MARK);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);

  const before = await (await fetch(BASE + '/api/terminal')).json();
  const sid = before.sessions.find((s) => !s.exited)?.id;
  const outBefore = plain((await (await fetch(BASE + '/api/terminal/' + sid + '/output?fromByte=0')).json()).text);
  if (!outBefore.includes('SURVIVE-' + MARK)) throw new Error('ls -a not echoed pre-reload; tail: ' + outBefore.slice(-200));
  log('session ' + sid + ' holds the ls -a output (pre-reload)');
  await page.screenshot({ path: 'tmp/survive-before.png' });

  // 4. HARD RELOAD
  await page.reload({ waitUntil: 'domcontentloaded' });
  log('page hard-reloaded');

  // 5. terminal must survive: panel returns, SAME session, output retained
  await page.waitForSelector('[data-testid="panel-terminal"]', { timeout: 20000 });
  const after = await (await fetch(BASE + '/api/terminal')).json();
  const sidAfter = after.sessions.find((s) => !s.exited)?.id;
  if (sidAfter !== sid) throw new Error('session changed across reload: ' + sid + ' -> ' + sidAfter);
  const outAfter = plain((await (await fetch(BASE + '/api/terminal/' + sid + '/output?fromByte=0')).json()).text);
  if (!outAfter.includes('SURVIVE-' + MARK)) throw new Error('ls -a output LOST across reload');
  // exactly one live session — the ladder re-claimed, never duplicated
  if (after.sessions.filter((s) => !s.exited).length !== 1) throw new Error('duplicate live sessions: ' + JSON.stringify(after.sessions));
  log('SURVIVED: same session ' + sidAfter + ', ls -a output retained, no duplicate session');
  await page.waitForTimeout(2500); // let the ring replay paint into xterm
  await page.screenshot({ path: 'tmp/survive-after.png' });

  console.log('PASS ✓');
} catch (e) {
  await page.screenshot({ path: 'tmp/survive-fail.png' }).catch(() => {});
  console.log('FAIL ✗ —', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}

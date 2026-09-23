import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

const STUB_PORT = 4590;
let stub: DshStubHost | undefined;
test.beforeAll(async () => { stub = new DshStubHost(STUB_PORT); await stub.start(); });
test.afterAll(async () => { await stub?.stop(); });

const SNAP = { ok: true, reused: true, uninstallable: [], snapshot: { v: 1, generatedAt: '2026-09-23T18:00:00Z', sources: [
  { id: 'superpowers', author: 'Jesse Vincent', repo: 'r', skills: [{ n: '1.1', id: 'demo-a', path: 'p', tier: null, installed: false, signed: false, installedFrom: null }] },
  { id: 'mattpocock', author: 'Matt Pocock', repo: 'r', skills: [{ n: '2.1', id: 'demo-b', path: 'p', tier: null, installed: false, signed: false, installedFrom: null }] },
  { id: 'pstack', author: 'Lauren Tan', repo: 'r', skills: [{ n: '3.1', id: 'demo-c', path: 'p', tier: null, installed: false, signed: false, installedFrom: null }] },
  { id: 'agent-skills', author: 'Addy Osmani', repo: 'r', skills: [{ n: '4.1', id: 'demo-d', path: 'p', tier: null, installed: false, signed: false, installedFrom: null }] },
  { id: 'web-quality-skills', author: 'Addy Osmani', repo: 'r', skills: [{ n: '5.1', id: 'demo-e', path: 'p', tier: null, installed: false, signed: false, installedFrom: null }] },
  { id: 'ecc', author: 'Affaan M', repo: 'r', skills: [{ n: '6.1', id: 'demo-f', path: 'p', tier: null, installed: false, signed: false, installedFrom: null }] },
  { id: 'impeccable', author: 'Paul Bakaus', repo: 'r', skills: [{ n: '7.1', id: 'demo-g', path: 'p', tier: null, installed: false, signed: false, installedFrom: null }] }
] } };

function prog(done: number, ecc: string, skillDone = 0) {
  const states = ['done', 'done', 'done', 'done', 'done', ecc, 'pending'].slice(0, 7);
  states[5] = ecc;
  return { ok: true, running: true, done, total: 7, skillDone, skillTotal: 1035,
    sources: ['superpowers','mattpocock','pstack','agent-skills','web-quality-skills','ecc','impeccable'].map((name, i) => ({ name, state: i === 5 ? ecc : states[i] })) };
}

test('chip demo: screenshots of the live states', async ({ page }) => {
  test.setTimeout(120_000);
  await page.route('**/api/skills/snapshot', (r) => r.fulfill({ json: SNAP }));
  await page.route('**/api/skills/reload', async (r) => { await new Promise((res) => setTimeout(res, 14_000)); await r.fulfill({ json: { ...SNAP, reused: false } }); });
  await page.goto('/?sessionKey=' + STUB_SESSION_ID);
  const composer = page.locator('textarea').first();
  await expect(composer).toBeVisible();
  await composer.fill('/dsi-skill-shelf');
  await composer.press('Enter');
  await expect(page.getByTestId('skill-shelf')).toBeVisible();
  let phase = 0;
  await page.route('**/api/skills/progress', (r) => r.fulfill({ json: [prog(0, 'pending'), prog(4, 'working', 380), prog(6, 'working', 980), prog(7, 'done', 1035)][phase] }));
  await page.getByTestId('shelf-reload').click();
  // phase 1: just started 0/7, ecc pending
  await expect(page.getByTestId('shelf-reload-progress')).toContainText('0/7');
  await page.screenshot({ path: 'tmp/chip-1-started.png' });
  // phase 2: mid-harvest, ecc working
  phase = 1;
  await expect(page.getByTestId('shelf-reload-progress')).toContainText('4/7 · 380/1035', { timeout: 4000 });
  await expect(page.getByTestId('shelf-source-working-ecc')).toBeVisible();
  await page.screenshot({ path: 'tmp/chip-2-ecc-working.png' });
  // phase 3: 6/7, ecc STILL working (the long tail)
  phase = 2;
  await expect(page.getByTestId('shelf-reload-progress')).toContainText('6/7 · 980/1035', { timeout: 4000 });
  await page.screenshot({ path: 'tmp/chip-3-six-of-seven.png' });
  // phase 4: all done -> check icon
  phase = 3;
  await expect(page.getByTestId('shelf-source-done-ecc')).toBeVisible({ timeout: 4000 });
  await page.screenshot({ path: 'tmp/chip-4-all-done.png' });
});

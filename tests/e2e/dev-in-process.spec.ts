import { test, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Wave 4 (The In-Process Host ADR): boot the REAL floor via the real CLI —
 * `dsi dsh --sync --dev in-process` — and prove the shape end to end:
 *   one vite process · UI serves · embedded host answers · token lands in
 *   the ISOLATED settings.yaml · the PAGE dials the host the page can see
 *   (regression pin for the 2026-10-11 "Failed to fetch" smoke bug:
 *   DSH_HOST_PORT must reach dshBase) · SIGTERM leaves zero listeners.
 *
 * Isolation: DSI_CONFIG_PATH + DSH_HOST_PORT + PORT point at throwaway
 * paths/ports — the production floor (3080) and its token are never touched.
 */
const HOST_PORT = 3479;
const UI_PORT = 5187;
const DSI_ROOT = join(process.cwd());
const CLI = join(DSI_ROOT, 'bin', 'dsi.mjs');
const CONFIG = join(DSI_ROOT, 'test-results', 'dsh-in-process-settings.yaml');

let cli: ReturnType<typeof spawn> | null = null;

async function waitUntil(fn: () => boolean, timeoutMs: number, everyMs = 1000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return fn();
}

function listens(port: number): boolean {
  const p = spawnSync('lsof', ['-ti', 'tcp:' + port, '-sTCP:LISTEN'], { stdio: 'pipe' });
  return p.status === 0 && (p.stdout.toString().trim().length > 0);
}

function viteCount(): number {
  // Count only DEV servers: the Playwright webServer runs `vite preview`
  // (same vite.js binary) and must not be counted — the in-process floor's
  // shape claim is about `vite dev` processes.
  const p = spawnSync('pgrep', ['-f', 'vite/bin/vite.js dev'], { stdio: 'pipe' });
  if (p.status !== 0) return 0;
  return p.stdout.toString().split('\n').filter(Boolean).length;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  rmSync(CONFIG, { force: true });
  cli = spawn(process.execPath, [CLI, 'dsh', '--sync', '--dev', 'in-process'], {
    stdio: 'ignore',
    cwd: DSI_ROOT,
    env: {
      ...process.env,
      DSI_CONFIG_PATH: CONFIG,
      DSH_HOST_PORT: String(HOST_PORT),
      PORT: String(UI_PORT)
    },
    detached: true // own process group — the afterAll kill takes the whole floor
  });
  // The boot is real: vite transpiles, the npx-cached host loads, the
  // plugin intercepts the token — give it the smoke-proven ~60s window.
  const up = await waitUntil(() => listens(UI_PORT) && listens(HOST_PORT) && existsSync(CONFIG), 120_000);
  if (!up) throw new Error('in-process floor did not come up within 120s — check test-results artifacts');
});

test.afterAll(async () => {
  if (cli?.pid) {
    try { process.kill(-cli.pid, 'SIGTERM'); } catch { cli.kill('SIGTERM'); }
    await waitUntil(() => !listens(UI_PORT) && !listens(HOST_PORT), 15_000);
  }
  rmSync(CONFIG, { force: true });
});

test('floor shape: exactly ONE vite process serves UI + embedded host', async () => {
  expect(viteCount()).toBe(1);
  expect(listens(UI_PORT)).toBe(true);
  expect(listens(HOST_PORT)).toBe(true);
});

test('embedded host answers with its auth wall (401 = serving, token required)', async ({ request }) => {
  const r = await request.get('http://127.0.0.1:' + HOST_PORT + '/');
  expect(r.status()).toBe(401);
});

test('token landed in the isolated settings.yaml (D2 intercept → sink)', () => {
  const yaml = readFileSync(CONFIG, 'utf-8');
  expect(yaml).toMatch(/authToken: \S+/);
});

test('the PAGE dials the host it can see — the Failed-to-fetch regression pin', async ({ page }) => {
  await page.goto('http://127.0.0.1:' + UI_PORT + '/', { waitUntil: 'domcontentloaded' });
  // The server-side RPC the page's first paint depends on: plugins snapshot
  // dials the host through DSI's server. If dshBase is wrong this 500s/
  // errors exactly like the operator-reported failure.
  const res = await page.request.get('http://127.0.0.1:' + UI_PORT + '/api/plugins/snapshot', { timeout: 15_000 });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  // and the page itself renders the floor header, not an error shell
  await expect(page.locator('body')).toContainText('DeepSeek', { ignoreCase: true });
});

test('SIGTERM teardown: zero listeners, zero orphans', async () => {
  expect(cli?.pid).toBeTruthy();
  try { process.kill(-(cli as { pid: number }).pid, 'SIGTERM'); } catch { cli?.kill('SIGTERM'); }
  const gone = await waitUntil(() => !listens(UI_PORT) && !listens(HOST_PORT), 15_000);
  expect(gone).toBe(true);
  expect(viteCount()).toBe(0);
  cli = null;
});

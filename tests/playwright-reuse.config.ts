/*
 * Sibling Playwright config (Turn End Stamp Wave 2, task 2.3) — documented
 * deviation from playwright.config.ts, changed in exactly two ways:
 *   1. APP_PORT 5176 → 5199: the operator's live dev server occupies 5176
 *      and killing it is not ours to do (port flows through baseURL, the
 *      preview command, and the DSH stub wiring below).
 *   2. Command skips `pnpm run build` (the wave already built; preview
 *      serves the same dist).
 * Everything else — disposable tmp DBs (BC-10), stub fence, auth token —
 * matches the base config's contract.
 */
import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STUB_LAUNCH_TOKEN } from './e2e/dsh-stub';

const APP_PORT = 5199;
const STUB_PORT = 4590; // specs bind the stub here (tests/e2e/*.spec.ts hardcode 4590)
const baseURL = `http://127.0.0.1:${APP_PORT}`;

const runTmp = mkdtempSync(join(tmpdir(), 'dsi-e2e-'));
process.env.DSI_PROMPTS_DB = process.env.DSI_PROMPTS_DB ?? join(runTmp, 'prompts.sqlite');
process.env.DSI_A2A_DB = process.env.DSI_A2A_DB ?? join(runTmp, 'a2a.sqlite');
process.env.DSI_CONFIG_PATH = process.env.DSI_CONFIG_PATH ?? join(runTmp, 'settings.yaml');
process.env.DSH_SETTINGS_PATH = process.env.DSH_SETTINGS_PATH ?? join(runTmp, 'dsh-settings.yaml');
process.env.DSI_SESSIONS_ROOT = process.env.DSI_SESSIONS_ROOT ?? join(runTmp, 'sessions-root');

export default defineConfig({
	testDir: join(process.cwd(), 'tests/e2e'),
	timeout: 30_000,
	expect: { timeout: 5_000 },
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: [['list']],
	use: {
		baseURL,
		trace: 'retain-on-failure'
	},
	webServer: [
		{
			// adapter-node output is build/ (node build), NOT vite-preview's dist/ —
			// the base config's `vite preview` command is stale for this stack.
			command: `PORT=5199 HOST=127.0.0.1 node ${join(process.cwd(), 'build')}`,
			url: baseURL + '/',
			reuseExistingServer: false,
			timeout: 120_000,
			env: {
				DSH_BASE_URL: `http://127.0.0.1:${STUB_PORT}`,
				DSI_PROMPTS_DB: process.env.DSI_PROMPTS_DB,
				DSI_A2A_DB: process.env.DSI_A2A_DB,
				DSI_CONFIG_PATH: process.env.DSI_CONFIG_PATH,
				DSH_SETTINGS_PATH: process.env.DSH_SETTINGS_PATH,
				DSI_SESSIONS_ROOT: process.env.DSI_SESSIONS_ROOT,
				DSI_AUTH_TOKEN: STUB_LAUNCH_TOKEN
			}
		}
	]
});

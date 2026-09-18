/**
 * Playwright config companion for the a2a e2e journeys (W5 task 5.1).
 *
 * Spreads the base config (same app, same stub seam) and re-pins ONLY the
 * pieces this runner needs: app port 5177 (never collides with a live dev
 * server), a2a-only testMatch, and the /tmp/a2a-e2e isolation env (config
 * file + ledger DB — the operator's ~/.dsi is never touched).
 * The base config carries NO static grep (probe-verified), so no sibling
 * grep-cleared config is needed (skill 3.9 discipline: prove selection).
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const APP_PORT = 5177;
const STUB_PORT = 4590;

// Worker-process env (webServer.env only reaches the SERVER process): set
// at config load so the spec's isolation guard sees it in every worker.
process.env.DSI_CONFIG_PATH = '/tmp/a2a-e2e/settings.yaml';
process.env.DSI_A2A_DB = '/tmp/a2a-e2e/ledger.sqlite';

export default defineConfig({
	...base,
	testMatch: 'a2a.spec.ts',
	use: { ...base.use, baseURL: `http://127.0.0.1:${APP_PORT}` },
	webServer: [
		{
			command: 'pnpm run build && vite preview --port 5177 --strictPort --host 127.0.0.1',
			url: `http://127.0.0.1:${APP_PORT}/`,
			reuseExistingServer: false,
			timeout: 120_000,
			env: {
				DSH_BASE_URL: `http://127.0.0.1:${STUB_PORT}`,
				DSI_CONFIG_PATH: '/tmp/a2a-e2e/settings.yaml',
				DSI_A2A_DB: '/tmp/a2a-e2e/ledger.sqlite'
			}
		}
	]
});

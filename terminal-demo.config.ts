import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STUB_LAUNCH_TOKEN } from './tests/e2e/dsh-stub';

const runTmp = mkdtempSync(join(tmpdir(), 'dsi-term-demo-'));
process.env.DSI_CONFIG_PATH = '/tmp/dsi-terminal-demo-settings.yaml';
process.env.DSH_SETTINGS_PATH = join(runTmp, 'dsh-settings.yaml');
process.env.DSI_PROMPTS_DB = join(runTmp, 'prompts.sqlite');
process.env.DSI_A2A_DB = join(runTmp, 'a2a.sqlite');
process.env.DSI_SESSIONS_ROOT = join(runTmp, 'sessions-root');

export default defineConfig({
	testDir: 'tests/e2e',
	timeout: 120_000,
	fullyParallel: false,
	workers: 1,
	reporter: [['list']],
	use: { baseURL: 'http://127.0.0.1:5199', trace: 'off', viewport: { width: 1400, height: 900 } },
	webServer: {
		command: 'npx vite dev --port 5199 --strictPort --host 127.0.0.1',
		url: 'http://127.0.0.1:5199/',
		reuseExistingServer: false,
		timeout: 120_000,
		env: {
			DSH_BASE_URL: 'http://127.0.0.1:4590',
			DSI_CONFIG_PATH: process.env.DSI_CONFIG_PATH,
			DSH_SETTINGS_PATH: process.env.DSH_SETTINGS_PATH,
			DSI_PROMPTS_DB: process.env.DSI_PROMPTS_DB,
			DSI_A2A_DB: process.env.DSI_A2A_DB,
			DSI_SESSIONS_ROOT: process.env.DSI_SESSIONS_ROOT,
			DSI_AUTH_TOKEN: STUB_LAUNCH_TOKEN
		}
	}
});

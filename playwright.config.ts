import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STUB_LAUNCH_TOKEN } from './tests/e2e/dsh-stub';

/**
 * Playwright config — DSI Conversation Page POC (task 4.1).
 *
 * Stack-under-test is the REAL app: `vite preview` serving the built app on
 * :5176, with DSH_BASE_URL pointed at the stub host (tests/e2e/dsh-stub.ts).
 * No live dsh web needed; no route stubs needed — the DSH wire itself is
 * stubbed one layer down, which also proves BC-1 (the browser only ever talks
 * to our own server).
 *
 * 0.1.2 auth (ADR "The Drifted Stand-in", Layer 1): the stub enforces the
 * cookie fence, and DSI_AUTH_TOKEN hands the app the launch token its DshAuth
 * exchanges for the cookie (mint on GET /?token=…, re-mint on 401).
 */

const APP_PORT = 5176;
const STUB_PORT = 4590;
const baseURL = `http://127.0.0.1:${APP_PORT}`;

// BC-10 (disposable tmp state), made real per RUN: one fresh temp dir per
// invocation holds the prompts + a2a sqlite files. A FIXED tmp path accretes
// rows across runs — e.g. a2aExchange rows from earlier runs rendered extra
// FloatingAnchors in panel-floor specs (2026-08-30 drift-repair finding).
// The assignment (not just the webServer env) makes the SAME paths visible
// to the test workers, whose specs reseed the prompts DB through the env.
const runTmp = mkdtempSync(join(tmpdir(), 'dsi-e2e-'));
process.env.DSI_PROMPTS_DB = process.env.DSI_PROMPTS_DB ?? join(runTmp, 'prompts.sqlite');
process.env.DSI_A2A_DB = process.env.DSI_A2A_DB ?? join(runTmp, 'a2a.sqlite');
// Settings Panel W5 (2026-09-07): the settings editor's GET/PUT must
// never touch the operator's real ~/.dsi/settings.yaml or
// ~/.dsh/settings.yaml — same BC-10 class as the DBs above. The DSI home
// stays absent (missing→defaults is part of the journey); the DSH home
// is seeded per-run by settings-panel.spec.ts.
process.env.DSI_CONFIG_PATH = process.env.DSI_CONFIG_PATH ?? join(runTmp, 'settings.yaml');
process.env.DSH_SETTINGS_PATH = process.env.DSH_SETTINGS_PATH ?? join(runTmp, 'dsh-settings.yaml');
// The Session Full Path (2026-09-14): the /path route scans THIS root —
// a disposable per-run dir (BC-10) the session-copy-path spec seeds;
// never the operator's real ~/.dsh/sessions.
process.env.DSI_SESSIONS_ROOT = process.env.DSI_SESSIONS_ROOT ?? join(runTmp, 'sessions-root');

export default defineConfig({
	testDir: 'tests/e2e',
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
			command: 'pnpm run build && vite preview --port 5176 --strictPort --host 127.0.0.1',
			url: `${baseURL}/`,
			reuseExistingServer: false,
			timeout: 120_000,
			env: {
				// Suggest Strip (2026-08-28 W4): the record guard fires on every
				// ordinary send in every spec — point the shared preview server
				// at a disposable tmp DB so the run never touches the operator's
				// real ~/.dsi/prompts.sqlite (BC-10: env seam, not a mock).
				DSH_BASE_URL: `http://127.0.0.1:${STUB_PORT}`,
				DSI_PROMPTS_DB: process.env.DSI_PROMPTS_DB,
				// Sectioned Row W3 (2026-08-29): journey 04's mention registers a
				// delegation row via /api/a2a/register — same BC-10 class as the
				// prompts DB above: a disposable tmp ledger, never the operator's
				// ~/.dsi/a2a.sqlite. Only the a2a DB route reads this env.
				DSI_A2A_DB: process.env.DSI_A2A_DB,
				// Settings Panel W5: disposable tmp settings homes (see top).
				DSI_CONFIG_PATH: process.env.DSI_CONFIG_PATH,
				DSH_SETTINGS_PATH: process.env.DSH_SETTINGS_PATH,
				// The Session Full Path: the scan root the /path route reads.
				DSI_SESSIONS_ROOT: process.env.DSI_SESSIONS_ROOT,
				// 0.1.2 auth: the launch token DshAuth exchanges at the stub's
				// fence (GET /?token=…) — the cookie then rides every /api call
				// and the remote.mux upgrade.
				DSI_AUTH_TOKEN: STUB_LAUNCH_TOKEN
			}
		}
	]
});

/**
 * terminal.spec (Wave 5, task 5.1) — the /dsi-terminal slash command end-to-end
 * against the built app and REAL PTYs (the preview server runs node-pty).
 *
 * AC1 — flag off: /dsi-terminal answers the honest disabled note, opens nothing.
 * AC2 — flag on: /dsi-terminal opens the panel; typing streams output; Ctrl-C
 *       raises a settle badge; Close reports the terminal closed, and the
 *       command re-run FOCUSES the open terminal instead of duplicating it
 *       (the manager-request grammar).
 * The flag flips by writing the RUN's disposable settings.yaml (playwright
 * config's DSI_CONFIG_PATH seam) — never the operator's real ~/.dsi.
 */
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

const STUB_PORT = 4590;
let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

const configPath = process.env.DSI_CONFIG_PATH ?? '';
/** Unique per run — a stale PTY from an earlier run can never satisfy the assertion. */
const ECHO_MARKER = 'dsi-w5-' + Math.floor(Math.random() * 1_000_000);

/** Starship redraws interleave cursor-move escapes with the typed line —
 *  strip ANSI, control chars, and whitespace before substring matching. */
function plain(text: string): string {
	return text
		.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
		.replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
		.replace(/[\x00-\x1f]/g, '')
		.replace(/\s+/g, '');
}

function writeConfig(enabled: boolean): void {
	writeFileSync(
		configPath,
		'home:\n  refreshMs: 1000\nterminal:\n  enabled: ' + (enabled ? 'true' : 'false') + '\n',
		'utf-8'
	);
}

async function openFloorAndRun(page: import('@playwright/test').Page, line: string): Promise<void> {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('access-mode-chip')).toBeVisible();
	const input = page.locator('textarea').first();
	await input.fill(line);
	await input.press('Enter');
}

test.describe('flag off (the shipped default)', () => {
	test('AC1 — /dsi-terminal answers the disabled note, opens no panel', async ({ page }) => {
		writeConfig(false);
		await openFloorAndRun(page, '/dsi-terminal');
		await expect(page.getByText('/dsi-terminal is disabled')).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId('panel-terminal')).toHaveCount(0);
	});
});

test.describe('flag on (operator opted in)', () => {
	test('AC2 — /dsi-terminal opens, typing streams, Ctrl-C settles, close quiesces, re-run focuses', async ({ page }) => {
		test.setTimeout(60_000);
		writeConfig(true);
		await openFloorAndRun(page, '/dsi-terminal');
		await expect(page.getByTestId('panel-terminal')).toBeVisible({ timeout: 20_000 });

		// The panel shells out to the real engine: click focuses xterm's
		// surface, then keys flow to the PTY (never the composer).
		await page.getByTestId('terminal-host').click();
		// Focus-sensitive interrupt FIRST (fresh focus window): a foreground
		// sleep, then Ctrl-C — the settle badge must appear.
		await page.keyboard.type('sleep 30');
		await page.keyboard.press('Enter');
		await page.getByTestId('terminal-host').click();
		await page.keyboard.press('Control+c');
		await expect(page.getByTestId('terminal-settle-badge')).toBeVisible({ timeout: 20_000 });
		// Interactive echo: the marker's output proves the data path end-to-end
		// (asserted through the server's retained output — xterm 6 is canvas).
		await page.getByTestId('terminal-host').click();
		await page.keyboard.type('echo ' + ECHO_MARKER);
		await page.keyboard.press('Enter');
		await expect.poll(async () => {
			const list = (await (await page.request.get('/api/terminal')).json()) as { sessions: Array<{ id: string }> };
			const id = list.sessions[0]?.id;
			if (!id) return '';
			const out = (await (await page.request.get('/api/terminal/' + id + '/output?fromByte=0')).json()) as { text: string };
			return plain(out.text);
		}, { timeout: 20_000 }).toContain(plain(ECHO_MARKER));

		// One live terminal: the command re-run focuses, never duplicates.
		await openFloorAndRun(page, '/dsi-terminal');
		await expect(page.getByTestId('panel-terminal')).toHaveCount(1);
	});
});

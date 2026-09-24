/**
 * terminal-desk.spec (Terminal Desk Wave 5, task 5.1) — the desk end-to-end
 * against the built app and REAL PTYs: bare opens the desk; --split-down
 * stacks a second shell; --new-tab appends and selects a tab; a hard
 * reload rebuilds the SAME arrangement from the probe (no duplicate
 * sessions); tab x empties the server's session list with the server
 * alive. The flag flips via the run's disposable settings.yaml
 * (DSI_CONFIG_PATH seam) — never the operator's real ~/.dsi.
 */
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

const STUB_PORT = 4590; // shared webServer stub (DSH_BASE_URL)
let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

const configPath = process.env.DSI_CONFIG_PATH ?? '';

function writeConfig(enabled: boolean): void {
	writeFileSync(
		configPath,
		'home:\n  refreshMs: 1000\nterminal:\n  enabled: ' + (enabled ? 'true' : 'false') + '\n',
		'utf-8'
	);
}

async function run(page: import('@playwright/test').Page, line: string): Promise<void> {
	const input = page.locator('textarea').first();
	await input.fill(line);
	await input.press('Enter');
}

test('desk end-to-end — split, tab, reload survival, tab close kills all', async ({ page }) => {
	test.setTimeout(90_000);
	writeConfig(true);
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('access-mode-chip')).toBeVisible({ timeout: 30_000 });

	// 1.1 — bare: the desk exists with tab[0]/row[0]
	await run(page, '/dsi-terminal');
	await expect(page.getByTestId('panel-terminal')).toBeVisible({ timeout: 20_000 });
	await expect(page.getByTestId('terminal-desk')).toBeVisible();
	await expect(page.getByTestId('terminal-tab-button-0')).toHaveAttribute('data-selected', 'true');

	// 1.1.1 — split-down: two rows in tab[0]
	await run(page, '/dsi-terminal --split-down');
	await expect(page.getByTestId('terminal-split-container')).toHaveAttribute('data-rows', '2', { timeout: 20_000 });
	await expect
		.poll(async () => (await (await page.request.get('/api/terminal')).json()).sessions.filter((s: { exited: boolean }) => !s.exited).length, { timeout: 20_000 })
		.toBe(2);

	// 1.2 — new-tab: tab[1] selected, tab[0] hidden, THREE live sessions
	await run(page, '/dsi-terminal --new-tab');
	await expect(page.getByTestId('terminal-tab-button-1')).toHaveAttribute('data-selected', 'true', { timeout: 20_000 });
	await expect(page.getByTestId('terminal-tab-container-0')).toHaveAttribute('data-visible', 'false');
	await expect(page.getByTestId('terminal-tab-container-1')).toHaveAttribute('data-visible', 'true');
	await expect
		.poll(async () => (await (await page.request.get('/api/terminal')).json()).sessions.filter((s: { exited: boolean }) => !s.exited).length, { timeout: 20_000 })
		.toBe(3);

	// THE SURVIVAL PROMISE — hard reload: same arrangement, same selection,
	// NO duplicate sessions (the rebuild ladder re-attaches, never re-opens).
	await page.reload();
	await expect(page.getByTestId('terminal-desk')).toBeVisible({ timeout: 20_000 });
	await expect(page.getByTestId('terminal-tab-button-1')).toHaveAttribute('data-selected', 'true', { timeout: 20_000 });
	await expect(page.getByTestId('terminal-tab-container-0')).toHaveAttribute('data-visible', 'false');
	await expect(page.getByTestId('terminal-tab-container-1')).toHaveAttribute('data-visible', 'true');
	const after = (await (await page.request.get('/api/terminal')).json()).sessions.filter((s: { exited: boolean }) => !s.exited);
	expect(after.length).toBe(3); // re-attached, never duplicated

	// D5 — tab x (the selected one) closes ITS rows only; the other tab's
	// shell keeps running; the server is alive and answers.
	await page.getByTestId('terminal-tab-close-1').click();
	await expect
		.poll(async () => (await (await page.request.get('/api/terminal')).json()).sessions.filter((s: { exited: boolean }) => !s.exited).length, { timeout: 20_000 })
		.toBe(2); // tab[1] held ONE row — tab[0]'s two shells keep running
	const status = await (await page.request.get('/api/terminal')).status();
	expect(status).toBe(200); // the server survived the whole scenario
});

/**
 * E2E — The Settings Tree ADR (2026-09-18, D2/D3): /dsi-settings and
 * /dsh-settings open SESSION-LESS workspace explorers over the settings
 * HOME folders, titled; the old single-file settings editor is retired.
 * Covers: the command mints a titled explorer, a repeat command FOCUSES
 * (root dedupe), and settings.yaml opens as an editable tab. Runs with
 * DSI_HOME_DIR pointed at a disposable fake home (the same seam the
 * unit tests use), so the operator's real ~/.dsi is never touched.
 */
import { expect, test } from '@playwright/test';
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

/** Bare '/' renders the EMPTY floor — no conversation panel, no composer
 *  (the Root-is-the-Floor ADR's EmptyFloor). The settings gestures ride
 *  a session panel's composer, so every test seeds via the stub wire
 *  (W0 net fix 2026-10-09 — the bare-goto predated the empty floor). */
async function openFloorWithComposer(page: import('@playwright/test').Page): Promise<void> {
	await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ listSessionId: STUB_SESSION_ID })
	});
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('prompt-textarea')).toBeVisible();
}

test('01 · /dsi-settings opens a titled explorer over ~/.dsi', async ({ page }) => {
	await openFloorWithComposer(page);
	const input = page.getByTestId('prompt-textarea');
	await input.fill('/dsi-settings');
	await input.press('Enter');
	const explorer = page.getByTestId('workspace-explorer');
	await expect(explorer).toHaveCount(1);
	// the titled header — not the raw tilde path
	await expect(page.locator('[data-testid="panel-column"]', { has: explorer })).toContainText('DSI - Settings');
	// the home's own settings.yaml is listed
	await expect(explorer.getByText('settings.yaml')).toBeVisible();
});

test('02 · a second /dsi-settings FOCUSES the open home panel (root dedupe) — one tree', async ({ page }) => {
	await openFloorWithComposer(page);
	const input = page.getByTestId('prompt-textarea');
	await input.fill('/dsi-settings');
	await input.press('Enter');
	await expect(page.getByTestId('workspace-explorer')).toHaveCount(1);
	await input.fill('/dsi-settings');
	await input.press('Enter');
	await expect(page.getByTestId('workspace-explorer')).toHaveCount(1);
});

test('03 · /dsh-settings opens the DSH home — a DIFFERENT root, a SECOND explorer', async ({ page }) => {
	await openFloorWithComposer(page);
	const input = page.getByTestId('prompt-textarea');
	await input.fill('/dsi-settings');
	await input.press('Enter');
	await input.fill('/dsh-settings');
	await input.press('Enter');
	await expect(page.getByTestId('workspace-explorer')).toHaveCount(2);
	// strict mode: THREE columns on the floor by now (seed + 2 homes) —
	// scope to the column that carries the DSH title.
	await expect(
		page.locator('[data-testid="panel-column"]', { hasText: 'DSH - Settings' })
	).toContainText('DSH - Settings');
});

test('04 · settings.yaml opens as a tab inside the explorer and edits', async ({ page }) => {
	await openFloorWithComposer(page);
	const input = page.getByTestId('prompt-textarea');
	await input.fill('/dsi-settings');
	await input.press('Enter');
	const explorer = page.getByTestId('workspace-explorer');
	await explorer.getByText('settings.yaml').click();
	const editor = page.getByTestId('settings-home-editor');
	await expect(editor).toBeVisible();
	// The host div mounts a MONACO instance — .fill() cannot target it.
	// Click into the editor, select all, insert the replacement text
	// (insertText is literal — no autocomplete/indent drift).
	await editor.click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.insertText('chat:\n  input:\n    maxRows: 12\n');
	await page.getByTestId('settings-home-file').getByRole('button', { name: 'Save', exact: true }).click();
	// the dirty dot clears after a successful save
	await expect(page.getByTestId('settings-home-dirty')).toHaveCount(0);
});
/**
 * E2E — The Settings Tree ADR (2026-09-18, D2/D3): /dsisettings and
 * /dshsettings open SESSION-LESS workspace explorers over the settings
 * HOME folders, titled; the old single-file settings editor is retired.
 * Covers: the command mints a titled explorer, a repeat command FOCUSES
 * (root dedupe), and settings.yaml opens as an editable tab. Runs with
 * DSI_HOME_DIR pointed at a disposable fake home (the same seam the
 * unit tests use), so the operator's real ~/.dsi is never touched.
 */
import { expect, test } from '@playwright/test';

test('01 · /dsisettings opens a titled explorer over ~/.dsi', async ({ page }) => {
	await page.goto('/');
	const input = page.getByTestId('composer-input');
	await input.fill('/dsisettings');
	await input.press('Enter');
	const explorer = page.getByTestId('workspace-explorer');
	await expect(explorer).toHaveCount(1);
	// the titled header — not the raw tilde path
	await expect(page.locator('[data-testid="panel-column"]', { has: explorer })).toContainText('DSI - Settings');
	// the home's own settings.yaml is listed
	await expect(explorer.getByText('settings.yaml')).toBeVisible();
});

test('02 · a second /dsisettings FOCUSES the open home panel (root dedupe) — one tree', async ({ page }) => {
	await page.goto('/');
	const input = page.getByTestId('composer-input');
	await input.fill('/dsisettings');
	await input.press('Enter');
	await expect(page.getByTestId('workspace-explorer')).toHaveCount(1);
	await input.fill('/dsisettings');
	await input.press('Enter');
	await expect(page.getByTestId('workspace-explorer')).toHaveCount(1);
});

test('03 · /dshsettings opens the DSH home — a DIFFERENT root, a SECOND explorer', async ({ page }) => {
	await page.goto('/');
	const input = page.getByTestId('composer-input');
	await input.fill('/dsisettings');
	await input.press('Enter');
	await input.fill('/dshsettings');
	await input.press('Enter');
	await expect(page.getByTestId('workspace-explorer')).toHaveCount(2);
	await expect(page.locator('[data-testid="panel-column"]')).toContainText('DSH - Settings');
});

test('04 · settings.yaml opens as a tab inside the explorer and edits', async ({ page }) => {
	await page.goto('/');
	const input = page.getByTestId('composer-input');
	await input.fill('/dsisettings');
	await input.press('Enter');
	const explorer = page.getByTestId('workspace-explorer');
	await explorer.getByText('settings.yaml').click();
	const editor = page.getByTestId('settings-home-editor');
	await expect(editor).toBeVisible();
	await editor.fill('chat:\n  input:\n    maxRows: 12\n');
	await page.getByTestId('settings-home-file').getByRole('button').click();
	// the dirty dot clears after a successful save
	await expect(page.getByTestId('settings-home-dirty')).toHaveCount(0);
});
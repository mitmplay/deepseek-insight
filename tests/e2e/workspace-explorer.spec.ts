/**
 * E2E: DSI Workspace Explorer — Wave 3 task 3.3 (2026-09-09, ADR "The
 * Workspace Explorer" D2/D4): chip → tree against the stub DSH host.
 *
 *   Plain click on the header workspace chip opens ONE explorer panel
 *   at the session cwd (/tmp — the stub listRow cwd) → the root level
 *   fetches via /api/dsh/directory and renders (dsi-e2e-ws dir row) →
 *   expanding two folders (dsi-e2e-ws, then docs) fetches one level
 *   each and reveals the nested rows → a repeat chip click FOCUSES the
 *   existing panel and adds NOTHING (D4: a duplicate is a bug).
 *
 * Selectors verified in component source (Step 3.8): session-workspace
 * (WorkspaceChip via DisplayWorkspace) / workspace-explorer +
 * explorer-title (PanelColumn's PanelHeader) + tree-dir + tree-file +
 * panel-header-copy-id (copies the workspace fullpath)
 * (WorkspaceExplorerPanel) / panel-column (PanelColumn) /
 * sidebar-panel-row (SidebarOpenPanels).
 */
import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

// The config pins DSH_BASE_URL at 4590 — every spec's stub binds THAT port.
const STUB_PORT = 4590;

let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

test.describe(() => {
	test.use({ viewport: { width: 1680, height: 950 } });

	test.beforeEach(async ({ page }) => {
		await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
		await expect(page.getByTestId('session-workspace').first()).toBeVisible();
	});

	test('chip click opens the explorer at the session cwd; the root level renders', async ({ page }) => {
		await page.getByTestId('session-workspace').first().click();
		const explorer = page.getByTestId('workspace-explorer');
		await expect(explorer).toBeVisible();
		await expect(page.getByTestId('explorer-title')).toHaveText('tmp');
		// The root level fetched: README.md (file row) + the notes dir row.
		await expect(page.getByTestId('tree-file').filter({ hasText: 'README.md' })).toBeVisible();
		await expect(page.getByTestId('tree-dir').filter({ hasText: 'notes' })).toBeVisible();
	});

	test('expanding a folder fetches its level and reveals the nested file row', async ({ page }) => {
		await page.getByTestId('session-workspace').first().click();
		await expect(explorerVisible(page)).toBeVisible();
		// Root level: README.md (file row) + notes (dir row).
		await expect(page.getByTestId('tree-file').filter({ hasText: 'README.md' })).toBeVisible();
		await page.getByTestId('tree-dir').filter({ hasText: 'notes' }).click();
		// Level 2: plain.txt under notes.
		await expect(
			page.getByTestId('tree-file').filter({ hasText: 'plain.txt' })
		).toBeVisible();
	});

	test('a repeat chip click FOCUSES the existing explorer — no duplicate (D4)', async ({ page }) => {
		await page.getByTestId('session-workspace').first().click();
		await expect(explorerVisible(page)).toBeVisible();
		await page.getByTestId('tree-dir').filter({ hasText: 'notes' }).click();
		await expect(page.getByTestId("tree-file").filter({ hasText: "plain.txt" })).toBeVisible();
		// Repeat click — the explorer count stays ONE; the panel stays up.
		await page.getByTestId('session-workspace').first().click();
		await expect(page.getByTestId('workspace-explorer')).toHaveCount(1);
		await expect(explorerVisible(page)).toBeVisible();
		// The expanded state survived the focus cycle (expanded persisted in
		// the panel entry, the fetched levels cached in the component).
		await expect(
			page.getByTestId('tree-file').filter({ hasText: 'plain.txt' })
		).toBeVisible();
	});

	test('opening a markdown file mounts the file panel with preview/edit tabs (W4)', async ({ page }) => {
		await page.getByTestId('session-workspace').first().click();
		await expect(explorerVisible(page)).toBeVisible();
		await page.getByTestId('tree-file').filter({ hasText: 'README.md' }).click();
		// The file panel mounts BELOW its explorer with BOTH tabs (md).
		const filePanel = page.getByTestId('workspace-file-panel');
		await expect(filePanel).toBeVisible();
		await expect(page.getByTestId('tab-preview')).toBeVisible();
		await expect(page.getByTestId('tab-edit')).toBeVisible();
		// No dirty indicator before any edit.
		await expect(page.getByTestId('file-dirty')).toHaveCount(0);
		// Repeat file click FOCUSES — still ONE file panel for the pair (D4).
		await page.getByTestId('tree-file').filter({ hasText: 'README.md' }).click();
		await expect(page.getByTestId('workspace-file-panel')).toHaveCount(1);
	});

	test('F5 restores both panels with the tree re-expanded; content re-fetches fresh (W5)', async ({ page }) => {
		await page.getByTestId('session-workspace').first().click();
		await expect(explorerVisible(page)).toBeVisible();
		await page.getByTestId('tree-dir').filter({ hasText: 'notes' }).click();
		await page.getByTestId('tree-file').filter({ hasText: 'README.md' }).click();
		await expect(page.getByTestId('workspace-file-panel')).toBeVisible();
		// F5 — the blob restores both kinds; the levels re-fetch (never persisted).
		await page.reload();
		await expect(explorerVisible(page)).toBeVisible();
		// The tree REOPENS notes BY ITSELF — expanded persisted, the level
		// re-fetches through the mount effect. plain.txt is back with no click.
		await expect(
			page.getByTestId('tree-file').filter({ hasText: 'plain.txt' })
		).toBeVisible();
		// The file panel restores with its tabs; the content re-fetches
		// fresh — NO dirty indicator survives the reload.
		const filePanel = page.getByTestId('workspace-file-panel');
		await expect(filePanel).toBeVisible();
		await expect(page.getByTestId('tab-preview')).toBeVisible();
		await expect(page.getByTestId('file-dirty')).toHaveCount(0);
	});
});function explorerVisible(page: import("@playwright/test").Page) {
	return page.getByTestId('workspace-explorer');
}
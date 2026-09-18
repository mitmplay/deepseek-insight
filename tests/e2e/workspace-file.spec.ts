/**
 * E2E: The File Eye (2026-09-13, ADR "The File Eye" D2/D3/D4/D6) — the
 * workspace file panel against the stub DSH host, with the DSI workspace
 * routes (git-map / git-status / git-file-head / file-write) pinned by
 * page.route so the desk mode and the changed-flag are deterministic.
 *
 *   Gate-on + changed file: the segmented toggle renders (Edit default),
 *   clicking Diff swaps the body to the read-only diff view and DISABLES
 *   Save; the choice survives a hard reload (D6, no flash); clicking
 *   Edit restores the editor and re-arms Save. Gate-off: no toggle and
 *   no Save verb at all (D4 — the delegate is retired).
 *
 * Selectors verified in component source (Step 3.8): file-view-toggle /
 * file-view-edit / file-view-diff (WorkspaceFileToolbar) /
 * file-save / file-dirty / file-diff-view / file-diff-new-file
 * (WorkspaceFilePanel) / workspace-file-panel + workspace-explorer +
 * tree-file (explorer chain).
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

async function routeFileEye(
	page: import('@playwright/test').Page,
	opts: { enabled: boolean; changed: boolean; head: string | null }
) {
	await page.route('**/api/workspace/git-map**', (route) =>
		route.fulfill({
			json: { ok: true, enabled: opts.enabled, rootIsRepo: true, repos: {} }
		})
	);
	await page.route('**/api/workspace/git-status**', (route) =>
		route.fulfill({
			json: {
				ok: true,
				enabled: opts.enabled,
				truncated: false,
				files: opts.changed ? [{ code: 'M', path: 'README.md' }] : []
			}
		})
	);
	await page.route('**/api/workspace/git-file-head**', (route) =>
		route.fulfill({ json: { ok: true, enabled: true, head: opts.head } })
	);
	await page.route('**/api/workspace/file-write**', (route) =>
		route.fulfill({ json: { ok: true, written: true } })
	);
}

async function openFilePanel(page: import('@playwright/test').Page) {
	await page.getByTestId('session-workspace').first().click();
	await expect(page.getByTestId('workspace-explorer')).toBeVisible();
	await page.getByTestId('tree-file').filter({ hasText: 'README.md' }).click();
	await expect(page.getByTestId('workspace-file-panel')).toBeVisible();
}

test.describe(() => {
	test.use({ viewport: { width: 1680, height: 950 } });

	test.beforeEach(async ({ page }) => {
		await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
		await expect(page.getByTestId('session-workspace').first()).toBeVisible();
	});

	test('gate-off desk: the file panel is READ-ONLY — no toggle, no Save (D4)', async ({ page }) => {
		await routeFileEye(page, { enabled: false, changed: false, head: null });
		await openFilePanel(page);
		await expect(page.getByTestId('file-view-toggle')).toHaveCount(0);
		await expect(page.getByTestId('file-save')).toHaveCount(0);
	});

	test('gate-on changed file: toggle renders, Diff disables Save, view survives reload (D3/D6)', async ({ page }) => {
		await routeFileEye(page, { enabled: true, changed: true, head: '# before\n' });
		await openFilePanel(page);
		const toggle = page.getByTestId('file-view-toggle');
		await expect(toggle).toBeVisible();
		await expect(page.getByTestId('file-view-edit')).toHaveAttribute('aria-pressed', 'true');
		// Diff: the body becomes the read-only diff view; Save locks.
		await page.getByTestId('file-view-diff').click();
		await expect(page.getByTestId('file-diff-view')).toBeVisible();
		await expect(page.getByTestId('file-save')).toBeDisabled();
		// Hard reload — the persisted view restores as Diff (D6).
		await page.reload();
		await openFilePanel(page);
		await expect(page.getByTestId('file-view-diff')).toHaveAttribute('aria-pressed', 'true');
		await expect(page.getByTestId('file-diff-view')).toBeVisible();
		// Back to Edit: the diff view leaves; Save returns (disabled only by
		// the clean-buffer rule, never by the view).
		await page.getByTestId('file-view-edit').click();
		await expect(page.getByTestId('file-diff-view')).toHaveCount(0);
		await expect(page.getByTestId('file-save')).toBeVisible();
		await expect(page.getByTestId('file-save')).not.toHaveAttribute('data-diff-locked');
	});

	test('unchanged file on an open gate: no toggle, Save available after an edit (D1)', async ({ page }) => {
		await routeFileEye(page, { enabled: true, changed: false, head: null });
		await openFilePanel(page);
		await expect(page.getByTestId('file-view-toggle')).toHaveCount(0);
		await expect(page.getByTestId('file-save')).toBeVisible();
		await expect(page.getByTestId('file-save')).toBeDisabled(); // clean buffer
	});
});

// ── The Explorer Layout (ADR 2026-09-17 D1/D3, Task 3.2): one click
// path per layout. The run's disposable DSI_CONFIG_PATH is the knob —
// the section readers never cache, so a rewrite + reload re-seeds the
// layout. workers:1 keeps the flip local to this spec's tail.
import { writeFileSync } from 'node:fs';

function setLayoutWorkspace(layout: 'panels' | 'explorer'): void {
	writeFileSync(process.env.DSI_CONFIG_PATH!, 'workspace:\n  layout: ' + layout + '\n', 'utf-8');
}

test.describe('workspace file click per layout (Explorer Layout ADR)', () => {
	test.use({ viewport: { width: 1680, height: 950 } });

	test('panels layout (explicit): the click still slots a floor panel', async ({ page }) => {
		setLayoutWorkspace('panels');
		await page.goto('/?sessionKey=' + STUB_SESSION_ID);
		await expect(page.getByTestId('session-workspace').first()).toBeVisible();
		await page.getByTestId('session-workspace').first().click();
		await expect(page.getByTestId('workspace-explorer')).toBeVisible();
		const columnsBefore = await page.getByTestId('panel-column').count();
		await page.getByTestId('tree-file').filter({ hasText: 'README.md' }).click();
		await expect(page.getByTestId('workspace-file-panel')).toBeVisible();
		expect(await page.getByTestId('panel-column').count()).toBe(columnsBefore + 1);
	});

	test('explorer layout: the click opens a TAB — the floor gains no column', async ({ page }) => {
		setLayoutWorkspace('explorer');
		await page.goto('/?sessionKey=' + STUB_SESSION_ID);
		await expect(page.getByTestId('session-workspace').first()).toBeVisible();
		await page.getByTestId('session-workspace').first().click();
		await expect(page.getByTestId('workspace-explorer')).toBeVisible();
		const columnsBefore = await page.getByTestId('panel-column').count();
		await page.getByTestId('tree-file').filter({ hasText: 'README.md' }).click();
		await expect(page.getByTestId('workspace-file-tab-README.md')).toBeVisible();
		expect(await page.getByTestId('panel-column').count()).toBe(columnsBefore);
		// restore the honest default for any later spec
		setLayoutWorkspace('panels');
	});
});

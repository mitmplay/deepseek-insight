/**
 * E2E: DSI Manager in the Panel — W4 task 4.2-T (2026-09-06, ADR "The
 * Manager in the Panel" D3/D7/D8). The embedded mount against the stub
 * DSH host, prompts routes REAL over the shared tmp DSI_PROMPTS_DB
 * (BC-10), one journey:
 *
 *   /dsi-prompts at zoom 0.75 → manager panel right of the
 *   conversation, newcomer selected → edit a prompt through the
 *   PORTALED dialog (unscaled under document.body — no transformed
 *   ancestor, BC-7) → Save round-trips through /api/prompts → a second
 *   manager joins (two live managers are legal, D3) → Escape closes
 *   exactly the focused one → the abandoned conversation keeps its
 *   composer.
 *
 * Selectors verified in component source (Step 3.8): prompt-textarea /
 * panel-manager (the route's embedded host box) / .mgr-panel-root /
 * .mgr-btn-edit / .mgr-edit-dialog / .mgr-edit-label / .mgr-btn-save /
 * .mgr-dialog-close / controlbar-trigger / controlbar-slider-zoom-input
 * (the embedded panel's close verb is root-scoped Escape since 1ff0af0).
 */
import { expect, test } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

const STUB_PORT = 4590;
const PROMPTS_DB = process.env.DSI_PROMPTS_DB ?? join(tmpdir(), 'dsi-e2e-prompts.sqlite');

const EDIT_TEXT = 'manager e2e prompt text';
const EDIT_LABEL = 'manager e2e label';

let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

/** Reseed the shared tmp prompts DB in place (BC-10 — same live file the
 *  preview server holds open; idempotent DDL, see suggest-strip.spec). */
function seedPromptsDb(rows: Array<{ label: string | null; text: string; use_count: number }>): void {
	const db = new DatabaseSync(PROMPTS_DB);
	db.exec(`
		CREATE TABLE IF NOT EXISTS prompts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			label TEXT,
			text TEXT NOT NULL,
			use_count INTEGER NOT NULL DEFAULT 1,
			last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			UNIQUE(text)
		);
		CREATE INDEX IF NOT EXISTS idx_prompts_text ON prompts(text);
		CREATE INDEX IF NOT EXISTS idx_prompts_prune ON prompts(use_count, last_used_at);
		CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(
			label, text, content='prompts', content_rowid='id', tokenize='trigram'
		);
		CREATE TRIGGER IF NOT EXISTS prompts_ai AFTER INSERT ON prompts BEGIN
			INSERT INTO prompts_fts(rowid, label, text) VALUES (new.id, new.label, new.text);
		END;
		CREATE TRIGGER IF NOT EXISTS prompts_ad AFTER DELETE ON prompts BEGIN
			INSERT INTO prompts_fts(prompts_fts, rowid, label, text)
			VALUES ('delete', old.id, old.label, old.text);
		END;
		CREATE TRIGGER IF NOT EXISTS prompts_au AFTER UPDATE OF label, text ON prompts BEGIN
			INSERT INTO prompts_fts(prompts_fts, rowid, label, text)
			VALUES ('delete', old.id, old.label, old.text);
			INSERT INTO prompts_fts(rowid, label, text) VALUES (new.id, new.label, new.text);
		END;
		CREATE UNIQUE INDEX IF NOT EXISTS idx_prompts_label ON prompts(label) WHERE label IS NOT NULL;
		PRAGMA user_version = 2;
	`);
	db.exec('DELETE FROM prompts');
	for (const r of rows) {
		db.prepare(
			"INSERT INTO prompts (label, text, use_count, last_used_at, created_at) VALUES (?, ?, ?, datetime('now', '-1 day'), datetime('now', '-1 day'))"
		).run(r.label, r.text, r.use_count);
	}
	db.close();
}

async function openTray(page: import('@playwright/test').Page): Promise<void> {
	await page.getByTestId('controlbar-trigger').click();
	await page.getByTestId('controlbar-tray').waitFor({ state: 'visible' });
}

test('W4 4.2-T · /dsi-prompts at zoom 0.75 — embedded mount, portaled edit, scoped Escape', async ({ page }) => {
	seedPromptsDb([{ label: null, text: EDIT_TEXT, use_count: 3 }]);
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('panel-column')).toHaveCount(1);

	// Zoom the floor to 0.75 — the trap condition (BC-7): fixed layers
	// inside the scaled canvas would render scaled + miscentered.
	await openTray(page);
	await page.getByTestId('controlbar-slider-zoom-input').fill('0.75');
	await page.keyboard.press('Escape'); // close the tray

	// The command, from the conversation's composer.
	const composer = page.getByTestId('prompt-textarea').first();
	await composer.fill('/dsi-prompts');
	await composer.press('Enter');

	// The manager lands right of the conversation and renders its table.
	const manager = page.getByTestId('panel-manager');
	await expect(manager).toBeVisible();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);
	await expect(manager.locator('.mgr-body-table')).toBeVisible();

	// Edit through the portaled pair: the dialog lives under document.body
	// with NO transformed ancestor (unscaled at zoom 0.75 — the BC-7
	// assertion the RCA pattern demands: reference-relative, not viewport).
	// The Prompt Tags D9: the ROW is the edit affordance — the per-row
	// Edit button is gone; a body-row click opens the portaled pair.
	await manager.locator('.mgr-body-table tbody tr').first().click();
	const dialog = page.locator('.mgr-edit-dialog');
	await expect(dialog).toBeVisible();
	const portalFacts = await dialog.evaluate((el: Element) => {
		let node: Element | null = el;
		let transformedAncestor = false;
		while (node !== null && node !== document.body) {
			if (node.parentElement === null) break;
			const t = getComputedStyle(node.parentElement).transform;
			if (t !== '' && t !== 'none') transformedAncestor = true;
			node = node.parentElement;
		}
		return { reachesBody: node === document.body, transformedAncestor };
	});
	expect(portalFacts.reachesBody).toBe(true);
	expect(portalFacts.transformedAncestor).toBe(false);
	// And the table itself stays in-column.
	expect(await manager.locator('.mgr-body-table').count()).toBe(1);

	// Save a rename — the round-trip lands in the real prompts DB.
	await dialog.locator('.mgr-edit-label').fill(EDIT_LABEL);
	await dialog.locator('.mgr-btn-save').click();
	await expect(dialog).toBeHidden();
	const api = await page.evaluate(async () => {
		const res = await fetch('/api/prompts?q=manager%20e2e');
		// The q-search branch answers { results } (the list branch is
		// { rows, total } — one route, two shapes).
		return (await res.json()) as { results: Array<{ label: string | null }> };
	});
	expect(api.results.map((r) => r.label)).toContain(EDIT_LABEL);

	// A SECOND manager joins (two live managers are legal, D3).
	await composer.fill('/dsi-prompts');
	await composer.press('Enter');
	await expect(page.getByTestId('panel-manager')).toHaveCount(2);

	// Root-scoped Escape closes exactly the focused manager: focus the
	// FIRST manager's search box, Escape, the other survives.
	const firstRoot = page.locator('.mgr-panel-root').first();
	await firstRoot.locator('.mgr-search').click();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('panel-manager')).toHaveCount(1);

	// Close the survivor through its close verb — commit 1ff0af0 removed
	// the panel's own × (.mgr-close); the embedded panel closes via
	// root-scoped Escape (escapeScope='root', ADR D3) — then the
	// abandoned conversation keeps its composer.
	await page.locator('.mgr-panel-root .mgr-search').click();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('panel-manager')).toHaveCount(0);
	await expect(page.getByTestId('panel-column')).toHaveCount(1);
	await expect(page.getByTestId('prompt-textarea')).toHaveCount(1);
});

test('W6 6.2-T widened · Alt+Click opens the manager lens; the conversation lens unchanged', async ({ page }) => {
	seedPromptsDb([{ label: null, text: EDIT_TEXT, use_count: 3 }]);
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('panel-column')).toHaveCount(1);

	// A manager joins via the command.
	const composer = page.getByTestId('prompt-textarea').first();
	await composer.fill('/dsi-prompts');
	await composer.press('Enter');
	const manager = page.getByTestId('panel-manager');
	await expect(manager).toBeVisible();

	// Alt+Click on the MANAGER body: the lens opens ON the manager now
	// (The Loupe for Every Panel, 2026-09-08 — the D9 no-op is lifted;
	// the ladder kind-switches before the session path). The dialog
	// carries the manager content and the label-variant header.
	await manager.locator('.mgr-title').click({ modifiers: ['Alt'] });
	const lens = page.getByTestId('panel-loupe');
	await expect(lens).toHaveCount(1);
	await expect(lens.getByTestId('panel-manager')).toBeVisible();
	await expect(lens.getByTestId('panel-header-label')).toContainText('Prompt Manager');
	await expect(lens.getByTestId('panel-header-copy-id')).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('panel-loupe')).toHaveCount(0);

	// Alt+Click on the CONVERSATION body: the loupe opens exactly as
	// before (regression leg — the widening must not touch conversation).
	const conv = page.getByTestId('panel-column').first();
	await conv.locator('.panel-header').click({ modifiers: ['Alt'] }).catch(async () => {
		// The header strip may sit under buttons at this viewport — the
		// D1 trigger fires on the column BODY; click the body div.
		await conv.locator('.body').first().click({ modifiers: ['Alt'] });
	});
	await expect(page.getByTestId('panel-loupe')).toHaveCount(1);
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('panel-loupe')).toHaveCount(0);
});

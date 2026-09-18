/**
 * E2E: DSI Suggest Strip (2026-08-28, Wave 4 task 4.1) — the prompt
 * library's two operator journeys against the stub DSH host, with the
 * prompts routes running REAL (they are DSI-local — no DSH involvement,
 * D10) over a disposable `DSI_PROMPTS_DB` tmp file (BC-10: test seams are
 * env vars, not mocks — the real sqlite module runs).
 *
 * The env is set once on the shared preview webServer (playwright.config
 * points every worker at one tmp path). Spec files run serialized
 * (workers: 1), so each test reseeds the SAME file — per-test isolation
 * without re-pointing the already-running server.
 *
 * Journey 1 (PRD §6 a / Layer 2 user test): type `?load` → strip rows
 * → Enter accepts (press 1: box holds full text, strip gone) → Enter
 * sends (press 2) → stub session.prompt received the FULL text →
 * GET /api/prompts shows use_count +1 for that row (the send recorded).
 *
 * Journey 2 (PRD §6 b): save a prompt bubble's text via the action row's
 * save button (prompt-side only since 2026-08-30 — the assistant turn's
 * row carries no save button, pinned here as a regression leg) → manager
 * opens from the strip's gear row → rename the label → `?` search shows
 * the new label — library CRUD round-trips.
 *
 * Regression leg: a slash command still executes host-side AFTER a strip
 * was previously open (Enter interception must never own command lines —
 * the strip is closed by then; parseCommand stays the first gate).
 *
 * Selectors verified in component source (Step 3.8): prompt-textarea /
 * suggest-strip (listbox) / option rows with title / .strip-manage
 * ("Manage prompts") / .mgr-modal (dialog) / .mgr-edit-* fields /
 * prompt-action-row + save-prompt-button / assistant-turn /
 * access-mode-chip / command-note.
 */

import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DshStubHost, STUB_SESSION_ID, STUB_USER_HELLO } from './dsh-stub';

// All spec files share the webServer's DSH_BASE_URL port (4590); workers:1
// serializes files, so each beforeAll owns the port for its file.
const STUB_PORT = 4590;
const stubCtl = `http://127.0.0.1:${STUB_PORT}/__e2e/state`;

/** The tmp DB path the preview server was pointed at (config). */
const PROMPTS_DB =
	process.env.DSI_PROMPTS_DB ?? join(tmpdir(), 'dsi-e2e-prompts.sqlite');

/** Journey 1 fixture: a three-row library where two rows match `?load`
 *  (the top row wins by use_count) and one never matches. */
const TOP_TEXT = 'load project AIP, OCI';
const TOP_LABEL = 'load AIP';
const TOP_USES = 7;
const LOAD_B_TEXT = 'load project B side';
const LOAD_B_USES = 2;
const OTHER_TEXT = 'commit all and push';

/** Journey 2 fixtures: the seeded user prompt (saved to the library) +
 *  the label it gets; the assistant reply only asserts the hidden save
 *  button (prompt-side only, 2026-08-30). */
const SAVED_TEXT = STUB_USER_HELLO;
const ASSISTANT_REPLY = 'Hi! How can I help?';
const RENAMED_LABEL = 'fox note renamed';

let stub: DshStubHost | undefined;
let tmpDir: string;

/**
 * Reseed the tmp prompts.sqlite THROUGH the same file the preview server
 * holds open (BC-10): the app memoizes one sqlite handle per process, so
 * swapping the file (rm + recreate) would strand the server on the dead
 * inode — queries silently see an empty DB. Instead: idempotent DDL
 * (creates the file on first use; the server-side open is IF NOT
 * EXISTS, so the two DDLs agree), then DELETE FROM prompts + INSERT —
 * the FTS triggers keep the trigram shadow in step on both statements,
 * and both handles read the same live file.
 */
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

/** GET /api/prompts against the app under test (real route, real DB). */
async function fetchPromptRow(text: string): Promise<{ id: number; use_count: number } | null> {
	const res = await fetch(
		`http://127.0.0.1:5176/api/prompts?q=${encodeURIComponent(text)}&limit=10`
	);
	if (!res.ok) return null;
	const data = (await res.json()) as { results: Array<{ id: number; text: string; use_count: number }> };
	return data.results.find((r) => r.text === text) ?? null;
}

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
	tmpDir = mkdtempSync(join(tmpdir(), 'suggest-strip-e2e-'));
});

test.afterAll(async () => {
	await stub?.stop();
	rmSync(tmpDir, { recursive: true, force: true });
});

async function resetState(): Promise<void> {
	await fetch(stubCtl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ promptCalls: [], permissionCalls: [], lastSeq: 1_000_000 })
	});
}

async function stubState(): Promise<{ promptCalls: Array<{ text: string }>; permissionCalls: string[] }> {
	const res = await fetch(stubCtl);
	return (await res.json()) as { promptCalls: Array<{ text: string }>; permissionCalls: string[] };
}

async function stubPromptCalls(): Promise<Array<{ text: string }>> {
	return (await stubState()).promptCalls;
}

test('01 · journey — ?find, two-press accept+send, use_count +1 (PRD §6 a)', async ({ page }) => {
	await resetState();
	seedPromptsDb([
		{ label: TOP_LABEL, text: TOP_TEXT, use_count: TOP_USES },
		{ label: null, text: LOAD_B_TEXT, use_count: LOAD_B_USES },
		{ label: null, text: OTHER_TEXT, use_count: 3 }
	]);
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const box = page.getByTestId('prompt-textarea');
	await expect(box).toBeVisible();
	await expect(page.getByTestId('suggest-strip')).toHaveCount(0);

	// Type the trigger (fill + keypresses so the input event fires and the
	// caret sits at the end) → 120ms debounce → rows.
	await box.fill('?');
	await box.pressSequentially('load');
	await expect(page.getByTestId('suggest-strip')).toBeVisible();
	const row = page.getByTestId('suggest-strip').locator('[role="option"]');
	// Two rows contain "load" (contains semantics — the commit row does
	// not match and stays out, which is the point of mode=contains).
	await expect(row).toHaveCount(2);
	// Ranked by use_count DESC — the seeded top row is first and active.
	await expect(row.first()).toHaveAttribute('aria-selected', 'true');
	await expect(row.first()).toContainText('load');
	await expect(row.first()).toHaveAttribute('title', TOP_TEXT);
	await expect(row.nth(1)).toHaveAttribute('title', LOAD_B_TEXT);

	// BC-2 two presses: Enter press 1 ACCEPTS — full text replaces the
	// query span, strip closes, box holds the row's full text.
	await box.press('Enter');
	await expect(page.getByTestId('suggest-strip')).toHaveCount(0);
	await expect(box).toHaveValue(TOP_TEXT);

	// Enter press 2 SENDS the full text to the stub host.
	await box.press('Enter');
	await expect
		.poll(async () => (await stubPromptCalls()).map((p) => p.text))
		.toContain(TOP_TEXT);
	await expect(box).toHaveValue('');

	// The admitted send recorded: use_count +1 on the same row (GET is the
	// PRD's asserted check, not just the sqlite file).
	await expect.poll(async () => (await fetchPromptRow(TOP_TEXT))?.use_count ?? 0).toBe(TOP_USES + 1);
	// The sibling and unrelated rows never moved — the send recorded its
	// own text only.
	expect((await fetchPromptRow(LOAD_B_TEXT))?.use_count).toBe(LOAD_B_USES);
	expect((await fetchPromptRow(OTHER_TEXT))?.use_count).toBe(3);
});

test('02 · journey — save a bubble, rename in the manager, ?find shows the new label (PRD §6 b)', async ({ page }) => {
	await resetState();
	seedPromptsDb([
		{ label: TOP_LABEL, text: TOP_TEXT, use_count: TOP_USES },
		{ label: null, text: OTHER_TEXT, use_count: 3 }
	]);
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);

	// The assistant turn's action row has NO save button (prompt-side
	// only, 2026-08-30) — its other buttons are still on the row.
	const assistant = page.getByTestId('assistant-turn').filter({ hasText: ASSISTANT_REPLY });
	await expect(assistant).toHaveCount(1);
	await assistant.hover();
	await expect(assistant.getByTestId('save-prompt-button')).toHaveCount(0);
	await expect(assistant.getByTestId('copy-text-button')).toBeVisible();

	// Save the USER bubble instead — hover its action row, click save.
	const bubble = page.getByTestId('message-bubble').filter({ hasText: SAVED_TEXT });
	await expect(bubble).toHaveCount(1);
	await bubble.hover();
	const saveBtn = bubble.getByTestId('save-prompt-button');
	await expect(saveBtn).toBeVisible();
	await saveBtn.click();
	// The Prompt Tags D6: the click OPENS the popup — Save (zero picked
	// tags) runs the original check-then-POST machine.
	const popup = page.getByTestId('save-prompt-popup');
	await expect(popup).toBeVisible();
	await page.getByTestId('save-prompt-confirm').click();
	// Check-then-POST → 201 → the tooltip note flips to the saved copy.
	await expect(saveBtn).toHaveAttribute('title', 'prompt saved');
	await expect.poll(async () => (await fetchPromptRow(SAVED_TEXT)) !== null).toBe(true);

	// Open the manager from the strip's gear row — `?load` matches a
	// seeded row, so the strip (and its gear row) is visible.
	const box = page.getByTestId('prompt-textarea');
	await box.fill('?');
	await box.pressSequentially('load');
	await expect(page.getByTestId('suggest-strip')).toBeVisible();
	await page.getByTestId('suggest-strip').getByText('Manage prompts').click();
	const modal = page.locator('.mgr-modal');
	await expect(modal).toBeVisible();

	// The manager table shows the saved row — give it the new label.
	const savedRow = modal.locator('tbody tr', { hasText: SAVED_TEXT });
	await expect(savedRow).toHaveCount(1);
	// The Prompt Tags D9: the ROW is the edit affordance (the per-row
	// Edit button is gone).
	await savedRow.click();
	// The edit dialog is a SIBLING of .mgr-modal inside the portaled host
	// (component markup), not a child — scope to the dialog itself.
	const editDialog = page.locator('.mgr-edit-dialog');
	await expect(editDialog).toBeVisible();
	const labelField = editDialog.locator('.mgr-edit-label');
	await labelField.fill(RENAMED_LABEL);
	await editDialog.locator('.mgr-edit-actions .mgr-btn-save').click();
	await expect(editDialog).toHaveCount(0);
	await modal.getByRole('button', { name: 'Close' }).click();
	await expect(modal).toHaveCount(0);

	// `?` search reflects the rename (label first-line matching).
	await box.fill('?');
	await box.pressSequentially('renamed');
	await expect(page.getByTestId('suggest-strip')).toBeVisible();
	const opt = page.getByTestId('suggest-strip').locator('[role="option"]').first();
	await expect(opt).toHaveAttribute('title', SAVED_TEXT);
	await expect(opt).toContainText(RENAMED_LABEL);
});

test('03 · regression — a slash command still sends host-side after a strip was previously open', async ({ page }) => {
	await resetState();
	seedPromptsDb([
		{ label: TOP_LABEL, text: TOP_TEXT, use_count: TOP_USES },
		{ label: null, text: OTHER_TEXT, use_count: 3 }
	]);
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const box = page.getByTestId('prompt-textarea');
	await expect(page.getByTestId('access-mode-chip')).toBeVisible();

	// Open the strip once, then accept it away (press 1) — the composer
	// has JUST had an active strip (the interception guard's home turf).
	await box.fill('?');
	await box.pressSequentially('load');
	await expect(page.getByTestId('suggest-strip')).toBeVisible();
	await box.press('Enter');
	await expect(page.getByTestId('suggest-strip')).toHaveCount(0);

	// Replace the accepted text with a slash command and send it: the
	// command executes host-side (permission flip recorded, banner
	// answers) and NEVER reaches the model as a prompt.
	await box.fill('/permission read-only');
	await box.press('Enter');
	await expect
		.poll(async () => (await stubState()).permissionCalls)
		.toEqual(['/permission read-only']);
	await expect(page.getByTestId('command-note')).toContainText('preset read-only');
	// The command never reached the model (and the strip never re-opened).
	const prompts = (await stubState()).promptCalls;
	expect(prompts.filter((p) => p.text.startsWith('/permission'))).toEqual([]);
	await expect(page.getByTestId('suggest-strip')).toHaveCount(0);
});

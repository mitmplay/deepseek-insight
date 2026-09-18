/**
 * E2E: the Workspace Command (2026-09-15, The Workspace Command ADR) —
 * the typed fresh-desk recipe against the stub DSH host:
 *
 *   /workspace ~/recipe-ws            → adopted (tilde expanded HOST-side
 *                                       against the stub's STUB_HOME),
 *                                       note names the /new follow-up
 *   /new @ptc recipe-ws               → create lands IN the registered
 *                                       workspace (cwd displacement, D5)
 *   /workspace ~/recipe-ws2 MyWS      → created=true chains the rename (D2)
 *   /new ghost                        → the honest no-match note (D5)
 *   /workspace ?                      → the help card (D6), never delivered
 *   bare /new with a NO-workspace session → the F11 ungrouped note
 *
 * AC8 rides test 03: the two-line macro runs through the UNCHANGED macro
 * runner — zero macro-layer changes (ADR F8).
 */
import { expect, test } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { DshStubHost, STUB_HOME, STUB_SESSION_ID } from './dsh-stub';

/** The suggest-strip W4 seam (playwright.config assigns the same path to
 *  the webServer): macros are SAVED PROMPT rows — the fresh-desk recipe
 *  rides one (ADR F8: zero macro-layer changes). */
const PROMPTS_DB = process.env.DSI_PROMPTS_DB ?? '';
const MACRO_TEXT = '/workspace ~/recipe-ws\n/new recipe-ws\n?list the files';

function seedPromptsDb(rows: Array<{ label: string | null; text: string; use_count: number }>): void {
	const db = new DatabaseSync(PROMPTS_DB);
	db.exec(`
		CREATE TABLE IF NOT EXISTS prompts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			label TEXT,
			text TEXT NOT NULL,
			use_count INTEGER NOT NULL DEFAULT 1,
			macro INTEGER NOT NULL DEFAULT 0,
			tags TEXT NOT NULL DEFAULT '',
			last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			UNIQUE(text)
		);
		CREATE INDEX IF NOT EXISTS idx_prompts_text ON prompts(text);
		CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(
			label, text, content='prompts', content_rowid='id', tokenize='trigram'
		);
		CREATE TRIGGER IF NOT EXISTS prompts_ai AFTER INSERT ON prompts BEGIN
			INSERT INTO prompts_fts(rowid, label, text) VALUES (new.rowid, new.label, new.text);
		END;
		CREATE TRIGGER IF NOT EXISTS prompts_au AFTER UPDATE OF label, text ON prompts BEGIN
			INSERT INTO prompts_fts(prompts_fts, rowid, label, text) VALUES (new.rowid, new.label, new.text);
		END;
		PRAGMA user_version = 2;
		DELETE FROM prompts;
		DELETE FROM prompts_fts;
	`);
	for (const r of rows) {
		db.prepare(
			"INSERT INTO prompts (label, text, use_count, macro, last_used_at, created_at) VALUES (?, ?, ?, 1, datetime('now', '-1 day'), datetime('now', '-1 day'))"
		).run(r.label, r.text, r.use_count);
	}
	db.close();
}

const STUB_PORT = 4590;
const stubCtl = `http://127.0.0.1:${STUB_PORT}/__e2e/state`;

let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

interface StubStateView {
	promptCalls: Array<{ text: string; mode: string }>;
	createCalls: Array<{ cwd: string | null; agentPreset: string | null }>;
	workspaceCreateCalls: string[];
	workspaceRenameCalls: Array<{ workspaceId: string; title: string }>;
}

async function stubState(): Promise<StubStateView> {
	const res = await fetch(stubCtl);
	return (await res.json()) as StubStateView;
}

async function resetState(): Promise<void> {
	await fetch(stubCtl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			permissionPreset: 'workspace-write',
			permissionCalls: [],
			promptCalls: [],
			createCalls: [],
			workspaceCreateCalls: [],
			workspaceRenameCalls: [],
			workspaces: [],
			// focus back on the seed session — earlier tests' /new moves the
			// stub's list point to the created id, which changes WHICH row the
			// focusedCwd knob applies to.
			listSessionId: STUB_SESSION_ID,
			// focusedCwd '/tmp' is the knob's DEFAULT — explicit, so a prior
			// test's null (the F11 fresh-install analog) never leaks forward.
			focusedCwd: '/tmp',
			lastSeq: 1_000_000
		})
	});
}

test('01 · /workspace adopts the ~ path; the note names the /new follow-up', async ({ page }) => {
	await resetState();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('access-mode-chip')).toBeVisible();

	const input = page.locator('textarea').first();
	await input.fill('/workspace ~/recipe-ws');
	await input.press('Enter');

	await expect(page.getByTestId('command-note')).toContainText('adopted ' + STUB_HOME + '/recipe-ws');
	await expect(page.getByTestId('command-note')).toContainText('/new recipe-ws');

	// The tilde expanded BEFORE the wire (D3): the host saw the absolute path.
	await expect.poll(async () => (await stubState()).workspaceCreateCalls).toEqual([
		STUB_HOME + '/recipe-ws'
	]);
	// A command line never reaches the model.
	expect((await stubState()).promptCalls).toEqual([]);
});

test('02 · /workspace <path> <name> chains the rename (created=true, D2)', async ({ page }) => {
	await resetState();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('access-mode-chip')).toBeVisible();

	const input = page.locator('textarea').first();
	await input.fill('/workspace ~/recipe-ws2 MyWS');
	await input.press('Enter');

	await expect(page.getByTestId('command-note')).toContainText('as "MyWS"');
	await expect
		.poll(async () => (await stubState()).workspaceRenameCalls.map((r) => r.title))
		.toEqual(['MyWS']);
});

test('03 · the recipe as ONE saved macro: /workspace then /new lands a session in it (AC8, F8)', async ({ page }) => {
	// The D5 resolution rides GET /api/dsh/sessions (~9s against the stub's
	// stream baselines) — the default 30s test budget is too tight.
	test.setTimeout(90_000);
	await resetState();
	seedPromptsDb([{ label: 'recipe-routine', text: MACRO_TEXT, use_count: 5 }]);
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('access-mode-chip')).toBeVisible();

	// The macro journey (prompt-macro house pattern): a saved prompt row
	// whose lines are the ADR recipe — found through the `!` run-mode
	// strip, taken STEP-wise so each section's wire truth is asserted in
	// isolation. The runner re-derives every section through parseCommand
	// with ZERO macro-layer changes (ADR F8).
	const box = page.getByTestId('prompt-textarea');
	await box.fill('!');
	await box.pressSequentially('recipe');
	const strip = page.getByTestId('suggest-strip');
	await expect(strip).toBeVisible();
	const row = strip.locator('[role="option"]');
	await expect(row).toHaveCount(1);
	await expect(row.first()).toHaveAttribute('aria-selected', 'true');
	await expect(row.first()).toHaveAttribute('title', MACRO_TEXT);
	await strip.locator('.strip-step-btn').click();
	await expect(strip).toHaveCount(0);

	// Section 1 — /workspace: the folder is adopted (tilde expanded host-side).
	// The held controls live in the sheet — expand it via the chip first.
	const chip = page.getByTestId('macro-chip');
	await expect(chip).toBeVisible();
	await chip.getByRole('button', { name: /macro/ }).click();
	const feed = page.getByTestId('macro-feednext');
	await expect(feed).toBeVisible();
	await feed.click();
	await expect
		.poll(async () => (await stubState()).workspaceCreateCalls, { timeout: 15_000 })
		.toEqual([STUB_HOME + '/recipe-ws']);

	// Section 2 — /new recipe-ws: the create carries the REGISTERED path,
	// not the inherited /tmp (D5 cwd displacement) — the two command
	// sections met at the registry.
	const feed2 = page.getByTestId('macro-feednext');
	await expect(feed2).toBeVisible();
	await feed2.click();
	await expect
		.poll(async () => (await stubState()).createCalls, { timeout: 30_000 })
		.toEqual([{ cwd: STUB_HOME + '/recipe-ws', agentPreset: 'main' }]);

	// Section 3 (the ? prompt) is the RUNNER's own territory — its
	// feed-after-swap lifecycle is owned by prompt-macro.spec and this
	// feature changes nothing there (ADR F8: zero macro-layer changes,
	// proven by sections 1–2 executing through the untouched runner).
	// The recipe's typed tail was demonstrated LIVE on the real host
	// (2026-09-15): adoption → pill → /new lands a session whose
	// workspace chip reads recipe-ws-demo.
	await expect(page.getByTestId('macro-chip')).toContainText('2/3');
});

test('04 · /workspace ? opens the help card; the ? line is never delivered (D6)', async ({ page }) => {
	await resetState();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('access-mode-chip')).toBeVisible();

	const input = page.locator('textarea').first();
	await input.fill('/workspace ?');
	const card = page.getByTestId('command-help');
	await expect(card).toBeVisible();
	await expect(card).toContainText('/workspace <full-path> [name]');
	// The new /new usage rides the same card surface when asked.
	await input.fill('/new ?');
	await expect(page.getByTestId('command-help')).toContainText('/new [@agent] [workspace] [--add]');

	await input.press('Enter');
	await page.waitForTimeout(400);
	expect((await stubState()).promptCalls).toEqual([]);
});

test('05 · /new with an unknown workspace names the registry, never guesses (D5)', async ({ page }) => {
	await resetState();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('access-mode-chip')).toBeVisible();

	const input = page.locator('textarea').first();
	await input.fill('/new ghost');
	await input.press('Enter');

	// The D5 resolution rides GET /api/dsh/sessions, whose stream-baseline
	// waits measure ~9s against the stub in this environment — the note
	// lands well after the default 5s window.
	await expect(page.getByTestId('command-note')).toContainText('no workspace "ghost"', { timeout: 20_000 });
	await expect(page.getByTestId('command-note')).toContainText('/workspace');
	// No create was spent on a guess.
	expect((await stubState()).createCalls).toEqual([]);
});

test('06 · fresh install: bare /new on a workspaceless session notes the ungrouped landing (F11)', async ({ page }) => {
	// The fresh-install analog: the focused session row carries NO cwd
	// (the stub's focusedCwd=null knob — the empty-registry empty-cwd desk).
	await resetState();
	await fetch(stubCtl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ focusedCwd: null })
	});
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('access-mode-chip')).toBeVisible();

	const input = page.locator('textarea').first();
	// --add: the note lives on THIS panel (a bare /new swaps it away
	// mid-note — the successor panel remounts and the banner dies with it).
	await input.fill('/new --add');
	await input.press('Enter');

	// The create SUCCEEDED (the host default cwd) and the note is the map:
	// the session lands ungrouped; /workspace is the way out.
	await expect(page.getByTestId('command-note')).toContainText('UNGROUPED', { timeout: 15_000 });
	await expect(page.getByTestId('command-note')).toContainText('/workspace');
	await expect
		.poll(async () => (await stubState()).createCalls)
		// cwd null = the create carried NO cwd key — nothing was inherited
		.toEqual([{ cwd: null, agentPreset: 'main' }]);
});

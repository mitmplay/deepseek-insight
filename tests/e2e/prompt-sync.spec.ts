/**
 * E2E: Prompt Sync — the sidebar broadcast box (ADR "The Prompt Sync",
 * 2026-09-04), two panels against the stub DSH host:
 *   01 check → the box reveals → typing mirrors into BOTH composers →
 *      submit dispatches BOTH sessions on the wire → box clears
 *   01b backspacing the box empty clears BOTH composers (D4 as amended
 *      2026-09-04 — the box empty is a mirrored empty)
 *   01c a mirrored ?query wakes BOTH panels' suggest strips (a mirrored
 *      draft drives the panel's own surfaces like a typed one)
 *   01d the box drives the strips: the strip is a view on the box too,
 *      ArrowDown moves all three highlights, Tab writes the row through
 *      the mirror (box + panels in-sync), Enter sends both on the wire
 *   01e the box Enter on a live RUN-mode view executes the highlighted
 *      macro in the first live panel, never ships the raw `!query` to
 *      any session, and ends the broadcast (amended 2026-09-04)
 *   01f the box drives the SLASH menu (the third surface): the menu
 *      rises over the box, arrows replay, Enter on an insert pick
 *      writes the seed through, Enter on an execute pick runs each
 *      panel's own host-command rung — a live `/` draft never ships
 *   02 cancel restores each panel's pre-broadcast draft
 *
 * Membership journey mirrors panel-floor spec 02 (seed + spine-row add
 * for the second panel). The wire assertion reads the stub's promptCalls
 * (the a2a.spec pattern) — BC-1 holds: the browser only talks to DSI.
 */

import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

const STUB_PORT = 4590;
const stubCtl = `http://127.0.0.1:${STUB_PORT}/__e2e/state`;

/** Per-TEST session ids — the DSI server's follow-buffer cursor for a
 *  session id SURVIVES the test that streamed a turn into it (the preview
 *  server is one process for the whole run), so re-adding the same id with
 *  a fresh tiny ledger pages past-cursor (stale buffer throughSeq > stub
 *  cursor) and the panel honestly renders the reaped card. */
const SECOND_SESSION_ID = 'e2e-sync-session-0102';
const THIRD_SESSION_ID = 'e2e-sync-session-0203';
const FOURTH_SESSION_ID = 'e2e-sync-session-0304';
const FIFTH_SESSION_ID = 'e2e-sync-session-0405';
const SIXTH_SESSION_ID = 'e2e-sync-session-0506';
const SEVENTH_SESSION_ID = 'e2e-sync-session-0607';
const EIGHTH_SESSION_ID = 'e2e-sync-session-0708';
const SECOND_TITLE = 'Sync second panel conversation';
const THIRD_TITLE = 'Sync third panel conversation';
const FOURTH_TITLE = 'Sync fourth panel conversation';
const FIFTH_TITLE = 'Sync fifth panel conversation';
const SIXTH_TITLE = 'Sync sixth panel conversation';
const SEVENTH_TITLE = 'Sync seventh panel conversation';
const EIGHTH_TITLE = 'Sync eighth panel conversation';

/** The tmp prompts DB the preview server holds open (suggest-strip.spec
 *  pattern — reseed THROUGH the live file, never swap the inode). */
const PROMPTS_DB = process.env.DSI_PROMPTS_DB ?? join(tmpdir(), 'dsi-e2e-prompts.sqlite');

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

interface StubStateView {
	promptCalls: Array<{ sessionId?: string; text: string; mode: string }>;
	commandExecuteCalls: string[];
	extraSessions: Array<{ sessionId: string; title: string; agentPreset: string | null; cwd: string; ledger: unknown[] }>;
}

let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

/** Stub state write (POST /__e2e/state merges). */
async function stubSet(patch: Record<string, unknown>): Promise<void> {
	const res = await fetch(stubCtl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(patch)
	});
	if (!res.ok) throw new Error(`stub state POST failed: ${res.status}`);
}

async function stubState(): Promise<StubStateView> {
	const res = await fetch(stubCtl);
	return (await res.json()) as StubStateView;
}

/** One extra session row (own ledger) — the SECOND panel. */
async function addSecondSession(sessionId: string, title: string): Promise<void> {
	await stubSet({
		extraSessions: [
			{
				sessionId,
				title,
				agentPreset: 'research',
				cwd: '/tmp',
				ledger: [
					{
						event: {
							type: 'user/message',
							seq: 2,
							time: Date.now(),
							data: { content: [{ type: 'text', text: title }], id: 'u2', role: 'user' }
						}
					}
				]
			}
		]
	});
}

/** Two live panels: the seed session + one spine-added session. */
async function openTwoPanels(page: import('@playwright/test').Page, sessionId: string, title: string): Promise<void> {
	await addSecondSession(sessionId, title);
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('panel-column')).toHaveCount(1);
	const row = page.locator(`[data-testid="sidebar-session-card"][href*="${sessionId}"]`);
	await expect(row).toBeVisible({ timeout: 10_000 });
	await row.click();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);
	// The added panel's cold load landed (a failed one swaps the body for
	// the reaped-error card — no composer, no checkmark to click).
	await expect(composerFor(page, title)).toBeVisible({ timeout: 10_000 });
}

/** A floor composer addressed by SESSION (the added panel's slot is
 *  floor-order-dependent — nth indexes lie), scoped to its panel column
 *  by the header's title text. */
function composerFor(page: import('@playwright/test').Page, title: string) {
	return page
		.locator('[data-testid="panel-column"]')
		.filter({ hasText: title })
		.getByTestId('prompt-textarea');
}

function checkFor(page: import('@playwright/test').Page, title: string) {
	return page
		.locator('[data-testid="panel-column"]')
		.filter({ hasText: title })
		.getByTestId('prompt-sync-check');
}

function stripFor(page: import('@playwright/test').Page, title: string) {
	return page
		.locator('[data-testid="panel-column"]')
		.filter({ hasText: title })
		.getByTestId('suggest-strip');
}

test.beforeEach(async () => {
	// Fresh workspace + wire record per spec (stub state persists across
	// tests within one stub instance — the POST merges arbitrary keys).
	await stubSet({ extraSessions: [], promptCalls: [] });
});

test('01 · check → broadcast → submit dispatches both sessions', async ({ page }) => {
	await openTwoPanels(page, SECOND_SESSION_ID, SECOND_TITLE);
	const second = composerFor(page, SECOND_TITLE);

	// Check both composers — the checkmarks reveal the sidebar box.
	await checkFor(page, SECOND_TITLE).click();
	await page.getByTestId('sidebar-prompt-sync').waitFor();
	await checkFor(page, 'E2E stub conversation').click();
	await expect(page.getByTestId('prompt-sync-count')).toHaveText('Broadcast · 2 panels');

	// The checkmark dresses each checked footer in the pastel broadcast
	// gradient (2026-09-04) — a background-image, not a flat tint.
	const footerFor = (title: string) =>
		page
			.locator('[data-testid="panel-column"]')
			.filter({ hasText: title })
			.getByTestId('conversation-footer');
	await expect
		.poll(async () => footerFor(SECOND_TITLE).evaluate((el) => getComputedStyle(el).backgroundImage))
		.toContain('linear-gradient');
	await expect
		.poll(async () =>
			footerFor('E2E stub conversation').evaluate((el) => getComputedStyle(el).backgroundImage)
		)
		.toContain('linear-gradient');

	// Typing in the box mirrors into BOTH composers.
	const box = page.getByTestId('sidebar-prompt-sync').getByTestId('prompt-textarea');
	await box.fill('broadcast me to both');
	await expect(second).toHaveValue('broadcast me to both');
	await expect(composerFor(page, 'E2E stub conversation')).toHaveValue('broadcast me to both');

	// Submit — each panel's own ladder fires; the stub sees both sends.
	await page.getByTestId('prompt-sync-submit').click();
	await expect
		.poll(async () => (await stubState()).promptCalls.filter((c) => c.text === 'broadcast me to both').length)
		.toBe(2);
	const calls = (await stubState()).promptCalls.filter((c) => c.text === 'broadcast me to both');
	expect(new Set(calls.map((c) => c.sessionId))).toEqual(new Set([STUB_SESSION_ID, SECOND_SESSION_ID]));

	// The box and both composers clear; the checked group survives.
	await expect(box).toHaveValue('');
	await expect(second).toHaveValue('');
	await expect(composerFor(page, 'E2E stub conversation')).toHaveValue('');
	await expect(page.getByTestId('prompt-sync-check')).toHaveCount(2);
	await expect(page.getByTestId('prompt-sync-note')).toHaveCount(0);
});

test('01b · backspacing the box empty clears both composers (D4 amended)', async ({ page }) => {
	await openTwoPanels(page, FOURTH_SESSION_ID, FOURTH_TITLE);
	const fourth = composerFor(page, FOURTH_TITLE);

	await checkFor(page, FOURTH_TITLE).click();
	await page.getByTestId('sidebar-prompt-sync').waitFor();
	await checkFor(page, 'E2E stub conversation').click();

	// Typing claims both panels; deleting down through the LAST character
	// must clear them — the box empty is a mirrored empty, not silence.
	const box = page.getByTestId('sidebar-prompt-sync').getByTestId('prompt-textarea');
	await box.fill('ab');
	await expect(fourth).toHaveValue('ab');
	await box.press('Backspace');
	await expect(fourth).toHaveValue('a');
	await box.press('Backspace');
	await expect(fourth).toHaveValue('');
	await expect(composerFor(page, 'E2E stub conversation')).toHaveValue('');

	// No send happened.
	expect((await stubState()).promptCalls).toEqual([]);
});

test('01c · a mirrored ?query wakes the suggest strip in every checked panel', async ({ page }) => {
	seedPromptsDb([{ label: 'commit', text: 'commit all and push', use_count: 3 }]);
	await openTwoPanels(page, FIFTH_SESSION_ID, FIFTH_TITLE);
	const fifth = composerFor(page, FIFTH_TITLE);
	const seed = composerFor(page, 'E2E stub conversation');

	await checkFor(page, FIFTH_TITLE).click();
	await page.getByTestId('sidebar-prompt-sync').waitFor();
	await checkFor(page, 'E2E stub conversation').click();

	const box = page.getByTestId('sidebar-prompt-sync').getByTestId('prompt-textarea');
	await expect(stripFor(page, FIFTH_TITLE)).toHaveCount(0);
	await expect(stripFor(page, 'E2E stub conversation')).toHaveCount(0);

	// Typing the ?query in the BOX (not in the panels) mirrors it — the
	// panels' own strips wake with the library rows (D4 amended: a
	// mirrored draft wakes the panel's surfaces like a typed one).
	await box.fill('?com');
	await expect(fifth).toHaveValue('?com');
	await expect(seed).toHaveValue('?com');
	await expect(stripFor(page, FIFTH_TITLE)).toBeVisible();
	await expect(stripFor(page, 'E2E stub conversation')).toBeVisible();
	// The chip shows the label + uses; the full text is the row's title.
	await expect(
		stripFor(page, FIFTH_TITLE).locator('[role="option"]')
	).toHaveAttribute('title', 'commit all and push');
	// No send happened.
	expect((await stubState()).promptCalls).toEqual([]);
});

test('01d · the box drives the strips: arrows, Tab accept, Enter sends both', async ({ page }) => {
	seedPromptsDb([
		{ label: 'commit', text: 'commit all and push', use_count: 7 },
		{ label: null, text: 'commit the rest quietly', use_count: 2 }
	]);
	await openTwoPanels(page, SIXTH_SESSION_ID, SIXTH_TITLE);
	const sixth = composerFor(page, SIXTH_TITLE);
	const seed = composerFor(page, 'E2E stub conversation');

	await checkFor(page, SIXTH_TITLE).click();
	await page.getByTestId('sidebar-prompt-sync').waitFor();
	await checkFor(page, 'E2E stub conversation').click();

	const box = page.getByTestId('sidebar-prompt-sync').getByTestId('prompt-textarea');
	await box.fill('?com');
	await expect(sixth).toHaveValue('?com');
	const selectedRow = (title: string) =>
		stripFor(page, title).locator('[role="option"][aria-selected="true"]');

	// The strip is a view on the BOX too — same rows, borrowed highlight.
	const boxStrip = page.getByTestId('sidebar-prompt-sync').getByTestId('suggest-strip');
	await expect(boxStrip).toBeVisible();
	await expect(selectedRow(SIXTH_TITLE)).toHaveAttribute('title', 'commit all and push');
	await expect(selectedRow('E2E stub conversation')).toHaveAttribute(
		'title',
		'commit all and push'
	);
	await expect(boxStrip.locator('[role="option"][aria-selected="true"]')).toHaveAttribute(
		'title',
		'commit all and push'
	);

	// ArrowDown in the BOX moves ALL THREE highlights in lockstep.
	await box.press('ArrowDown');
	await expect(selectedRow(SIXTH_TITLE)).toHaveAttribute('title', 'commit the rest quietly');
	await expect(selectedRow('E2E stub conversation')).toHaveAttribute(
		'title',
		'commit the rest quietly'
	);
	await expect(boxStrip.locator('[role="option"][aria-selected="true"]')).toHaveAttribute(
		'title',
		'commit the rest quietly'
	);

	// Tab accepts press 1 by WRITING THROUGH the mirror — the box's own
	// draft holds the picked row too (the journey stays in-sync), and the
	// strips close everywhere.
	await box.press('Tab');
	await expect(box).toHaveValue('commit the rest quietly');
	await expect(sixth).toHaveValue('commit the rest quietly');
	await expect(seed).toHaveValue('commit the rest quietly');
	await expect(stripFor(page, SIXTH_TITLE)).toHaveCount(0);
	await expect(stripFor(page, 'E2E stub conversation')).toHaveCount(0);
	await expect(boxStrip).toHaveCount(0);

	// Enter press 2 — submitAll runs each ladder; the wire sees both sends.
	await box.press('Enter');
	await expect
		.poll(async () => (await stubState()).promptCalls.filter((c) => c.text === 'commit the rest quietly').length)
		.toBe(2);
	const calls = (await stubState()).promptCalls.filter((c) => c.text === 'commit the rest quietly');
	expect(new Set(calls.map((c) => c.sessionId))).toEqual(new Set([STUB_SESSION_ID, SIXTH_SESSION_ID]));
});

test('01e · the box Enter on a run-mode view runs the macro — the raw line never ships', async ({ page }) => {
	seedPromptsDb([{ label: 'deploy', text: 'macro says deploy now', use_count: 5 }]);
	await openTwoPanels(page, SEVENTH_SESSION_ID, SEVENTH_TITLE);
	const seventh = composerFor(page, SEVENTH_TITLE);
	const seed = composerFor(page, 'E2E stub conversation');

	await checkFor(page, SEVENTH_TITLE).click();
	await page.getByTestId('sidebar-prompt-sync').waitFor();
	await checkFor(page, 'E2E stub conversation').click();

	const box = page.getByTestId('sidebar-prompt-sync').getByTestId('prompt-textarea');
	await box.fill('!dep');
	// The mirrored run query wakes BOTH panels' strips and the box's view
	// (the `!` grammar rides the same finder as `?`, journey 01c).
	await expect(stripFor(page, SEVENTH_TITLE)).toBeVisible();
	await expect(stripFor(page, 'E2E stub conversation')).toBeVisible();
	const boxStrip = page.getByTestId('sidebar-prompt-sync').getByTestId('suggest-strip');
	await expect(boxStrip).toBeVisible();

	// Enter EXECUTES the highlighted row: the macro text is what reaches
	// the wire, in the first live member (check order). The runner is a
	// module singleton — the second live member's start refuses with the
	// visible banner (fail-loud, one run at a time), and NEITHER session
	// ever receives the literal `!dep` line.
	await box.press('Enter');
	await expect
		.poll(async () => (await stubState()).promptCalls.filter((c) => c.text === 'macro says deploy now').length)
		.toBe(1);
	const calls = (await stubState()).promptCalls;
	expect(calls[0]?.sessionId).toBe(SEVENTH_SESSION_ID);
	expect(calls.some((c) => c.text.startsWith('!'))).toBe(false);
	await expect(
		page
			.locator('[data-testid="panel-column"]')
			.filter({ hasText: 'E2E stub conversation' })
			.getByTestId('command-note')
	).toContainText('already running');

	// The run consumed the broadcast — box and drafts cleared, strips down.
	await expect(box).toHaveValue('');
	await expect(seventh).toHaveValue('');
	await expect(seed).toHaveValue('');
	await expect(boxStrip).toHaveCount(0);
	await expect(stripFor(page, SEVENTH_TITLE)).toHaveCount(0);
});

test('01f · the box drives the slash menu — the view rises, arrows replay, Enter never ships', async ({ page }) => {
	await openTwoPanels(page, EIGHTH_SESSION_ID, EIGHTH_TITLE);
	const eighth = composerFor(page, EIGHTH_TITLE);
	const seed = composerFor(page, 'E2E stub conversation');

	await checkFor(page, EIGHTH_TITLE).click();
	await page.getByTestId('sidebar-prompt-sync').waitFor();
	await checkFor(page, 'E2E stub conversation').click();

	const box = page.getByTestId('sidebar-prompt-sync').getByTestId('prompt-textarea');
	const boxMenu = page.getByTestId('sidebar-prompt-sync').getByTestId('slash-menu');
	const boxActive = () => boxMenu.locator('.slash-row.active');

	// LEG 1 — the view rises AT THE BOX (the verified defect had the menu
	// only over the far composer): '/' opens the members' whole vocabulary
	// over the box, and arrows replay into the members' highlights.
	await box.fill('/');
	await expect(boxMenu.getByTestId('slash-gesture-row')).toHaveCount(2); // /new + @mention
	await expect(boxActive()).toContainText('/new'); // index 0 over the full vocabulary
	await box.press('ArrowDown');
	await expect(boxActive()).toContainText('@mention'); // the replay moved every highlight

	// Enter on an INSERT pick (the @mention seed): the seeded draft writes
	// through the mirror — box and BOTH panels hold it, and NO wire call
	// rides (press 2 is the operator's own judgment).
	await box.press('Enter');
	await expect(box).toHaveValue('@session-');
	await expect(eighth).toHaveValue('@session-');
	await expect(seed).toHaveValue('@session-');
	await expect(boxMenu).toHaveCount(0); // the picks memo-closed every member's menu
	expect((await stubState()).promptCalls).toEqual([]);

	// LEG 2 — an EXECUTE pick: '/compact' has a hint-less row; Enter runs
	// each panel's OWN host-command rung (two executes) and ends the
	// broadcast — the literal line never reaches the model wire.
	await box.fill('/compact');
	await expect(boxMenu.getByTestId('slash-command-row')).toBeVisible();
	await box.press('Enter');
	await expect
		.poll(async () => (await stubState()).commandExecuteCalls.length, { timeout: 10_000 })
		.toBe(2);
	expect((await stubState()).promptCalls).toEqual([]); // still nothing shipped
	await expect(box).toHaveValue('');
	await expect(eighth).toHaveValue('');
	await expect(seed).toHaveValue('');
	await expect(boxMenu).toHaveCount(0);
});

test('02 · cancel restores each panel pre-broadcast draft', async ({ page }) => {
	await openTwoPanels(page, THIRD_SESSION_ID, THIRD_TITLE);
	const third = composerFor(page, THIRD_TITLE);
	const seed = composerFor(page, 'E2E stub conversation');

	// The added panel holds its own draft before joining the broadcast.
	await third.fill('solo draft');

	await checkFor(page, THIRD_TITLE).click();
	await page.getByTestId('sidebar-prompt-sync').waitFor();
	await checkFor(page, 'E2E stub conversation').click();

	// Checking wipes nothing (D4); the broadcast overwrites both.
	await expect(third).toHaveValue('solo draft');
	const box = page.getByTestId('sidebar-prompt-sync').getByTestId('prompt-textarea');
	await box.fill('overwritten');
	await expect(third).toHaveValue('overwritten');
	await expect(seed).toHaveValue('overwritten');

	// Cancel — every panel goes back to exactly its pre-check draft.
	await page.getByTestId('prompt-sync-cancel').click();
	await expect(third).toHaveValue('solo draft');
	await expect(seed).toHaveValue('');
	await expect(box).toHaveValue('');
	// No send happened.
	expect((await stubState()).promptCalls).toEqual([]);
});

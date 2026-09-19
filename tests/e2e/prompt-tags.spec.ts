/**
 * E2E: The Prompt Tags (ADR 2026-09-14, Wave 6 task 6.2) — the tagged
 * library journeys against the stub DSH host with the prompts routes
 * running REAL over the disposable DSI_PROMPTS_DB tmp file (BC-10, the
 * suggest-strip.spec pattern).
 *
 * Journeys (PRD §6 / Layer 2 user test):
 *  01 · save-popup flow: click opens the popup, chips toggle, Save POSTs
 *       {text, tags} — the row lands in the library WITH its tags (read
 *       back through the real GET wire).
 *  02 · manager interactions: +word search parse (ONE request with
 *       tags+q), row-click edit, checkbox sweep opens zero dialogs.
 *  03 · manager chip filter + HARD-RELOAD restore (the dsi-prompt-tags-filter
 *       desk slot) and chip/plus-token sync.
 *  04 · strip chips: recTags from the arrived rows, local AND filtering,
 *       desk-slot restore after reload.
 *
 * Seeding goes through the REAL POST /api/prompts wire (the routes are
 * DSI-local — no DSH involvement) so tags flow through the actual server
 * path; use_count bumps ride the real PATCH for ranking determinism.
 *
 * Selectors verified in component source (Step 3.8): save-prompt-button /
 * save-prompt-popup / save-prompt-confirm / .save-prompt-chip /
 * mgr-tag-filter-chip / mgr-search / mgr-check / mgr-edit-dialog /
 * mgr-tag-chip / mgr-tag-more / suggest-strip / strip-tag-chip.
 */

import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

// The webServer pins DSH_BASE_URL to 4590 (playwright.config) — the stub
// MUST own that port. workers:1 serializes spec files, so each file's
// beforeAll owns the port for its duration.
const STUB_PORT = 4590;
const stubCtl = `http://127.0.0.1:${STUB_PORT}/__e2e/state`;
const APP = 'http://127.0.0.1:5176';

/** Tagged fixtures — the vocabulary defaults (session git plan rca kb)
 *  come from the absent-settings fallback, so chips pick from those. */
const ROWS = [
	{ text: 'commit all and push', label: 'commitmsg', tags: ['git', 'rca'] },
	{ text: 'study the github flow', tags: ['git', 'session'] },
	{ text: 'write the postmortem', label: 'postmortem', tags: ['rca', 'kb'] }
];

let stub: DshStubHost | undefined;
let tmpDir: string;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
	tmpDir = mkdtempSync(join(tmpdir(), 'prompt-tags-e2e-'));
});

test.afterAll(async () => {
	await stub?.stop();
	rmSync(tmpDir, { recursive: true, force: true });
});

/** Wipe the library through the wire (DELETE per row), then seed tagged
 *  rows through POST /api/prompts (real server path for tags). */
async function reseed(): Promise<void> {
	const list = await fetch(`${APP}/api/prompts?sort=created&limit=500`);
	const body = (await list.json()) as { rows: Array<{ id: number }> };
	for (const r of body.rows) {
		await fetch(`${APP}/api/prompts/${r.id}`, { method: 'DELETE' });
	}
	for (const r of ROWS) {
		const res = await fetch(`${APP}/api/prompts`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text: r.text, ...(r.label ? { label: r.label } : {}), tags: r.tags })
		});
		if (!res.ok) throw new Error(`seed failed: ${r.text} → ${res.status}`);
	}
}

async function resetState(): Promise<void> {
	await fetch(stubCtl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ promptCalls: [], permissionCalls: [], lastSeq: 1_000_000 })
	});
}

async function libraryTexts(): Promise<string[]> {
	const res = await fetch(`${APP}/api/prompts?sort=created&limit=500`);
	const body = (await res.json()) as { rows: Array<{ text: string }> };
	return body.rows.map((r) => r.text);
}

test.describe.configure({ mode: 'serial' });

test('01 · save-popup — click opens, chips toggle, the row lands TAGGED', async ({ page }) => {
	await resetState();
	await reseed();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const box = page.getByTestId('prompt-textarea');
	await expect(box).toBeVisible();

	// Send a bubble whose text is NOT in the library yet.
	const draft = 'a brand new tagged prompt';
	await box.fill(draft);
	await box.press('Enter');

	const bubble = page.getByTestId('message-bubble').filter({ hasText: draft });
	await expect(bubble).toHaveCount(1);
	await bubble.hover();
	const saveBtn = bubble.getByTestId('save-prompt-button');
	await expect(saveBtn).toBeVisible();

	// Click OPENS the popup (no save yet) — preview + vocabulary chips.
	await saveBtn.click();
	const popup = page.getByTestId('save-prompt-popup');
	await expect(popup).toBeVisible();
	await expect(popup).toContainText(draft);
	await expect(popup.locator('.save-prompt-chip')).toHaveCount(5); // default vocabulary

	// Toggle git + rca, then Save.
	await popup.locator('.save-prompt-chip', { hasText: 'git' }).click();
	await popup.locator('.save-prompt-chip', { hasText: 'rca' }).click();
	await page.getByTestId('save-prompt-confirm').click();
	await expect(saveBtn).toHaveAttribute('title', 'prompt saved');
	await expect(popup).toHaveCount(0);

	// The row landed WITH its tags — read back through the real GET wire.
	const texts = await libraryTexts();
	expect(texts).toContain(draft);
	const list = await fetch(`${APP}/api/prompts?sort=created&limit=500`);
	const body = (await list.json()) as { rows: Array<{ text: string; tags: string }> };
	const saved = body.rows.find((r) => r.text === draft)!;
	expect(saved.tags).toBe('git rca');
});

test('02 · manager — +word parse, row-click edit, checkbox sweep opens zero dialogs', async ({ page }) => {
	await resetState();
	await reseed();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await page.getByTestId('prompt-textarea').fill('');
	await page.getByTestId('prompt-textarea').press('Escape');

	// Open the manager (the ⚙ manage control needs a visible strip —
	// type a ? query that matches a seeded row).
	const box = page.getByTestId('prompt-textarea');
	await box.fill('?');
	await box.pressSequentially('commit');
	await expect(page.getByTestId('suggest-strip')).toBeVisible();
	await page.getByTestId('suggest-strip').getByText('Manage prompts').click();
	const modal = page.locator('.mgr-modal');
	await expect(modal).toBeVisible();

	// D11: +git +session study → ONE request with tags=git,session&q=study
	const search = modal.locator('.mgr-search');
	// q is the contains text search — 'study' matches row 2's text.
	await search.fill('+git +session study');
	await page.waitForTimeout(500); // the 300ms debounce
	const tagsRow = modal.locator('tbody tr');
	await expect(tagsRow).toHaveCount(1); // only 'study the github flow' carries git AND session
	await expect(tagsRow.first()).toContainText('study the github flow');

	// D9: row click opens the edit dialog (no Edit button exists).
	await expect(modal.getByRole('button', { name: 'Edit' })).toHaveCount(0);
	await tagsRow.first().click();
	const dialog = page.locator('.mgr-edit-dialog');
	await expect(dialog).toBeVisible();
	await modal.locator('.mgr-btn-cancel').click();
	await expect(dialog).toHaveCount(0);

	// Checkbox sweep of all three rows opens ZERO dialogs.
	await search.fill('');
	await page.waitForTimeout(500);
	const checks = modal.locator('.mgr-check');
	await expect(checks).toHaveCount(3);
	for (let i = 0; i < 3; i++) await checks.nth(i).click();
	await expect(page.locator('.mgr-edit-dialog')).toHaveCount(0);

	await modal.getByRole('button', { name: 'Close' }).click();
	await expect(modal).toHaveCount(0);
});

test('03 · manager — chip filter composes with +words; reload restores the filter', async ({ page }) => {
	await resetState();
	await reseed();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);

	const box = page.getByTestId('prompt-textarea');
	await box.fill('?');
	await box.pressSequentially('commit');
	await expect(page.getByTestId('suggest-strip')).toBeVisible();
	await page.getByTestId('suggest-strip').getByText('Manage prompts').click();
	const modal = page.locator('.mgr-modal');
	await expect(modal).toBeVisible();

	// Toggle the rca chip → only tagged rows survive.
	await modal.locator('.mgr-tag-filter-chip', { hasText: 'rca' }).click();
	await page.waitForTimeout(500);
	await expect(modal.locator('tbody tr')).toHaveCount(2); // commitmsg + postmortem carry rca

	// Chip ↔ box sync: the box now shows the +rca token (same state).
	await expect(modal.locator('.mgr-search')).toHaveValue('+rca');

	// HARD RELOAD — the modal itself is view state, so reopen it: the
	// filter must restore from the desk slot (the chip checked, the box's
	// +token reconstructed, the rows still filtered).
	await page.reload();
	await box.fill('?');
	await box.pressSequentially('commit');
	await expect(page.getByTestId('suggest-strip')).toBeVisible();
	await page.getByTestId('suggest-strip').getByText('Manage prompts').click();
	const modal2 = page.locator('.mgr-modal');
	await expect(modal2).toBeVisible();
	await expect(modal2.locator('.mgr-tag-filter-chip.on', { hasText: 'rca' })).toHaveCount(1);
	await expect(modal2.locator('.mgr-search')).toHaveValue('+rca');
	await page.waitForTimeout(500);
	await expect(modal2.locator('tbody tr')).toHaveCount(2);

	await modal2.getByRole('button', { name: 'Close' }).click();
});

test('04 · strip — recTags chips filter the ARRIVED rows locally and survive a reload', async ({ page }) => {
	await resetState();
	await reseed();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);

	const box = page.getByTestId('prompt-textarea');
	// '?commit' matches row 1 only → recTags = git, rca (from THAT row set).
	await box.fill('?');
	await box.pressSequentially('commit');
	await expect(page.getByTestId('suggest-strip')).toBeVisible();
	const strip = page.getByTestId('suggest-strip');
	await expect(strip.locator('.strip-chip')).toHaveCount(1);
	await expect(strip.locator('.strip-tag-chip')).toHaveCount(2); // git, rca — from the ARRIVED rows

	// Uncheck → all rows of the current query result stay; check 'git' keeps row 1.
	await strip.locator('.strip-tag-chip', { hasText: 'git' }).locator('input').check();
	await expect(strip.locator('.strip-chip')).toHaveCount(1);

	// The desk slot holds the checked word.
	const stored = await page.evaluate(() => localStorage.getItem('dsi-strip-tags-filter'));
	expect(JSON.parse(stored!)).toEqual(['git']);

	// Broaden the query (?o contains-matches ALL three rows) — the checked
	// chip still filters locally: only the git-carrying rows survive.
	await box.fill('?');
	await box.pressSequentially('o');
	await expect(strip.locator('.strip-chip')).toHaveCount(2);

	// RELOAD — the checked chip restores from the desk slot.
	await page.reload();
	await page.getByTestId('prompt-textarea').fill('?');
	await page.getByTestId('prompt-textarea').pressSequentially('o');
	const strip2 = page.getByTestId('suggest-strip');
	await expect(strip2).toBeVisible();
	await expect(strip2.locator('.strip-tag-chip.on', { hasText: 'git' })).toHaveCount(1);
	await expect(strip2.locator('.strip-chip')).toHaveCount(2);
});

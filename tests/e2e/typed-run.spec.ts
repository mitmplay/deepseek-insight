/**
 * E2E: DSI Typed Run (2026-09-16, The Typed Run spec Wave 3 task 3.1) —
 * a multi-line draft that is uniformly directive enters the EXISTING
 * macro runner as the TYPED_DRAFT_ID synthetic row (ADR D1/D3); mixed
 * and prose drafts keep today's whole-draft send; a second Enter during
 * a live run is REFUSED, never queued (D4).
 *
 * Journeys against the stub DSH host (prompt-macro pattern, specs run
 * serialized — each file owns the stub port for its lifetime):
 *   01 typed run      — a two-slash-line draft + Enter → the sheet shows
 *                       TWO send rows, the stub records TWO prompt POSTs
 *                       (one per line, in order), the chip ends fed.
 *   02 mixed draft    — prose + slash stays ONE whole-draft send (D1
 *                       rejection 2); no chip, no sheet.
 *   03 refusal (D4)   — the FIRST prompt POST is held browser-side
 *                       (page.route gate — test seam, BC-1 intact: the
 *                       browser still only talks to our own server) so
 *                       the run stays feeding; the second Enter banners
 *                       "a macro is already running" and the live run is
 *                       NOT replaced; release → fed.
 *
 * Selectors verified in component source (skill Step 3.8):
 * prompt-textarea / macro-chip / macro-sheet / macro-line[data-state] /
 * command-note (ConversationPanel banner). The unknown-token slash menu
 * falls through on Enter (slash-menu spec journey 05 precedent).
 */

import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID, stubAnswerer } from './dsh-stub';

const STUB_PORT = 4590;
const stubCtl = `http://127.0.0.1:${STUB_PORT}/__e2e/state`;

interface StubStateView {
	promptCalls: Array<{ sessionId: string; text: string; mode: string }>;
}

async function resetState(): Promise<void> {
	await fetch(stubCtl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			promptCalls: [],
			permissionCalls: [],
			createCalls: [],
			createdSessions: [],
			listSessionId: STUB_SESSION_ID
		})
	});
	stubAnswerer!.resetAnswerRegistry();
}

async function stubState(): Promise<StubStateView> {
	const res = await fetch(stubCtl);
	return (await res.json()) as StubStateView;
}

let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

test.describe.configure({ mode: 'serial' });

const DRAFT = '/dsi-spec based on recent ADR\n/dsi-task execute it';

test('01 · typed run — a two-slash-line draft feeds ONE line per receipt and ends fed', async ({ page }) => {
	await resetState();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const box = page.getByTestId('prompt-textarea');
	await expect(box).toBeVisible();

	await box.fill(DRAFT);
	await box.press('Enter');

	// The sheet (collapsed by default — the chip toggles it): TWO one-line
	// send rows (the D2 flag's granularity).
	const chipLabel = page.getByTestId('macro-chip').locator('.macro-chip-label');
	await expect(chipLabel).toBeVisible();
	await chipLabel.click();
	const sheet = page.getByTestId('macro-sheet');
	await expect(sheet).toBeVisible();
	const lines = sheet.getByTestId('macro-line');
	await expect(lines).toHaveCount(2);
	await expect(lines.first()).toContainText('/dsi-spec based on recent ADR');
	await expect(lines.nth(1)).toContainText('/dsi-task execute it');

	// The wire: exactly TWO prompt POSTs, line 1 before line 2, each
	// carrying ONE line's text (never the merged blob).
	await expect
		.poll(async () => (await stubState()).promptCalls.length, { timeout: 10_000 })
		.toBe(2);
	const calls = (await stubState()).promptCalls;
	expect(calls[0].text).toBe('/dsi-spec based on recent ADR');
	expect(calls[1].text).toBe('/dsi-task execute it');

	// The chip ends fed.
	await expect(page.getByTestId('macro-chip')).toContainText('fed', { timeout: 10_000 });
});

test('02 · mixed draft — prose plus slash stays ONE whole-draft send (D1 rejection 2)', async ({ page }) => {
	await resetState();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const box = page.getByTestId('prompt-textarea');
	await expect(box).toBeVisible();

	await box.fill('first run this\n/dsi-task execute it');
	await box.press('Enter');

	await expect
		.poll(async () => (await stubState()).promptCalls.length, { timeout: 10_000 })
		.toBe(1);
	expect((await stubState()).promptCalls[0].text).toBe('first run this\n/dsi-task execute it');
	// No runner surface — the draft never entered the machine.
	await expect(page.getByTestId('macro-chip')).toHaveCount(0);
	await expect(page.getByTestId('macro-sheet')).toHaveCount(0);
});

test('03 · refusal — a second Enter during a live run banners the note, never queues (D4)', async ({ page }) => {
	await resetState();
	// Test seam: hold the FIRST prompt POST's RESPONSE open so the run
	// stays feeding while the operator presses Enter again.
	let release: () => void = () => {};
	const gated = new Promise<void>((r) => {
		release = r;
	});
	let held = false;
	await page.route('**/api/dsh/session/*/prompt', async (route) => {
		if (!held) {
			held = true;
			await gated;
		}
		await route.continue();
	});

	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const box = page.getByTestId('prompt-textarea');
	await expect(box).toBeVisible();

	await box.fill(DRAFT);
	await box.press('Enter');
	await expect(page.getByTestId('macro-chip')).toBeVisible();

	// The live run refuses the second draft — the note is the receipt.
	await box.fill('/dsi-spec again\n/dsi-task more');
	await box.press('Enter');
	const note = page.getByTestId('command-note');
	await expect(note).toBeVisible();
	await expect(note).toContainText('a macro is already running');

	// The live run was NOT replaced: the sheet still shows the ORIGINAL
	// draft's in-flight first line (section 2 stays pending behind the
	// gated receipt — the second draft never entered the queue).
	await page.getByTestId('macro-chip').locator('.macro-chip-label').click();
	const sheet = page.getByTestId('macro-sheet');
	await expect(sheet.getByTestId('macro-line').first()).toContainText(
		'/dsi-spec based on recent ADR'
	);

	release();
	await expect(page.getByTestId('macro-chip')).toContainText('fed', { timeout: 10_000 });
	await page.unroute('**/api/dsh/session/*/prompt');
});

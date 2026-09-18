/**
 * E2E: DSI Slash Menu (Slash Menu ADR, 2026-08-30; task 3.1) — the full
 * journey against the stub DSH host, real build, real routes:
 *
 *   01 open            — `/` renders the three labeled sections (DSI gestures,
 *                        Commands, Skills — ADR §1.1's layers); filter narrows; Esc dismisses
 *   01b gesture picks  — the DSI rows seed the draft (/new , @session-) and never send
 *   01c host help      — "/plan ?" / "/dsh-doc ?" answer from the catalog row's
 *                        own copy; the collision resolves to the command; nothing sends
 *   02 command pick    — the no-hint row executes host-side (verbatim line → receipt banner)
 *   03 hint pick       — the hint row lands `/name `; the operator's Enter (press 2) sends
 *   04 skill pick      — the skill lands `/name `; Enter ships the prompt VERBATIM;
 *                        the shelf records nothing (`/`-lines are control traffic)
 *   05 passthrough     — `/nope` + Enter falls through the open (zero-match) menu as chat
 *   06 collision       — a name in BOTH catalogs resolves to the COMMAND (native adjudication)
 *
 * The stub serves commands/list (compact, plan{hint}), skills/list (dsh-doc,
 * a compact skill twin) and receipts /compact·/plan through the NATIVE
 * commands/execute wire — everything else is an admission miss.
 */

import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

// All spec files share the webServer's DSH_BASE_URL port (4590); workers:1
// serializes files, so each beforeAll owns the port for its file.
const STUB_PORT = 4590;
const stubCtl = `http://127.0.0.1:${STUB_PORT}/__e2e/state`;
// The app under test (preview build) serves its own prompts shelf — the
// record-guard assertion reads it directly (suggest-strip.spec pattern).
const APP = 'http://127.0.0.1:5176';

let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

interface StubStateView {
	permissionCalls: string[];
	commandExecuteCalls: string[];
	promptCalls: Array<{ text: string; mode: string }>;
}

async function stubState(): Promise<StubStateView> {
	const res = await fetch(stubCtl);
	const body = (await res.json()) as StubStateView;
	return body;
}

async function resetState(): Promise<void> {
	// lastSeq jumps above any seq the SHARED DSI preview server's ring
	// buffer still holds from previous spec files (slash-commands.spec
	// pattern — the gap triggers DSI's ledger resync; the stub is truth).
	await fetch(stubCtl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			permissionPreset: 'workspace-write',
			permissionCalls: [],
			commandExecuteCalls: [],
			promptCalls: [],
			lastSeq: 1_000_000
		})
	});
}

/** Open the page with a clean stub and return the composer locator. */
async function openComposer(page: import('@playwright/test').Page) {
	await resetState();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const input = page.locator('[data-testid="prompt-textarea"]');
	await input.click();
	return input;
}

test('01 · open — "/" renders the three labeled sections; filter narrows; Esc dismisses', async ({ page }) => {
	const input = await openComposer(page);
	await input.fill('/');
	await expect(page.getByTestId('slash-menu')).toBeVisible();
	await expect(page.getByTestId('slash-gestures-label')).toContainText('DSI gestures');
	await expect(page.getByTestId('slash-commands-label')).toContainText('Commands');
	await expect(page.getByTestId('slash-skills-label')).toContainText('Skills');
	// Layer A (ADR §1.1): the DSI gesture section lists first — /new +
	// /promptmanager + @mention (the manager row joined 2026-09-06, D7).
	// Five client gestures: /new + /promptmanager (2026-09-06) + the two
	// settings editors + @mention (Settings Panel ADR D3, 2026-09-07).
	await expect(page.getByTestId('slash-gesture-row')).toHaveCount(5);
	// The stub vocabulary: 2 commands (one with a hint) + 2 skills (one twin).
	await expect(page.getByTestId('slash-command-row')).toHaveCount(2);
	await expect(page.getByTestId('slash-skill-row')).toHaveCount(2);
	// The hint renders as the plan row's SECONDARY line (no ghost overlay).
	const planRow = page.getByTestId('slash-command-row').filter({ hasText: 'plan' });
	await expect(planRow).toContainText('<goal>');
	// Filter narrows both sections (the skill twin 'compact' also matches /comp).
	await input.fill('/comp');
	await expect(page.getByTestId('slash-command-row')).toHaveCount(1);
	await expect(page.getByTestId('slash-skill-row')).toHaveCount(1);
	await input.fill('/plan');
	await expect(page.getByTestId('slash-command-row')).toHaveCount(1);
	await expect(page.getByTestId('slash-skill-row')).toHaveCount(0);
	// (The gesture section filters with the same matcher: nothing matches
	// '/plan' — zero gesture rows is the correct narrowed answer.)
	await expect(page.getByTestId('slash-gesture-row')).toHaveCount(0);
	// Esc dismisses; the menu is gone from the DOM (draft kept).
	await input.press('Escape');
	await expect(page.getByTestId('slash-menu')).toHaveCount(0);
	await expect(input).toHaveValue('/plan');
});

test('01b · gesture picks — the DSI rows seed the draft and never send (two-press rule)', async ({ page }) => {
	const input = await openComposer(page);
	await input.fill('/');
	// Tab accepts the highlighted row: index 0 = /new fills the draft and
	// nothing rides the wire (Tab ≡ Enter — the strip's accept parity).
	await page.getByTestId('slash-gesture-row').filter({ hasText: 'Creates a fresh session' }).waitFor();
	await input.press('Tab');
	await expect(input).toHaveValue('/new ');
	await expect(page.getByTestId('command-note')).toHaveCount(0);
	await expect((await stubState()).commandExecuteCalls).toEqual([]);

	// The mention row seeds the grammar the parser actually accepts — a
	// fresh composer, because the pick's memo holds for the same-length
	// draft '/' (the strip's dismiss grammar, verbatim).
	await openComposer(page);
	await input.fill('/');
	await page.getByTestId('slash-gesture-row').filter({ hasText: '@mention' }).click();
	await expect(input).toHaveValue('@session-');
	await expect((await stubState()).promptCalls).toEqual([]);
});

test('01c · host help — "/plan ?" and "/dsh-doc ?" answer from the wire and never send', async ({ page }) => {
	const input = await openComposer(page);
	await input.fill('/plan ?');
	// The menu stands down for a ? draft; the card answers from the
	// catalog row's own copy (usage = name + the wire's input.hint).
	await expect(page.getByTestId('slash-menu')).toHaveCount(0);
	const card = page.getByTestId('command-help');
	await expect(card).toBeVisible();
	await expect(card).toContainText('/plan <goal>');
	await expect(card).toContainText('command');
	// Enter never sends — nothing rides either wire.
	await input.press('Enter');
	await expect.poll(async () => (await stubState()).promptCalls).toEqual([]);
	await expect((await stubState()).commandExecuteCalls).toEqual([]);
	// The skill card: same card, the wire's own copy, the skill tag.
	await input.fill('/dsh-doc ?');
	await expect(card).toContainText('/dsh-doc');
	await expect(card).toContainText('skill');
	// The collision: compact lives in BOTH catalogs — the command card wins.
	await input.fill('/compact ?');
	await expect(card).toContainText('Compact the session context');
	await expect(card).toContainText('command');
});

test('02 · command pick — the no-hint row executes host-side; the banner is the receipt', async ({ page }) => {
	const input = await openComposer(page);
	await input.fill('/');
	await expect(page.getByTestId('slash-command-row').filter({ hasText: 'compact' })).toBeVisible();
	await page
		.getByTestId('slash-command-row')
		.filter({ hasText: 'compact' })
		.first()
		.click();

	// The NATIVE wire saw the verbatim line; the banner answers with the
	// host's own receipt text; the draft cleared.
	await expect.poll(async () => (await stubState()).commandExecuteCalls).toEqual(['/compact']);
	await expect(page.getByTestId('command-note')).toContainText('context compacted');
	await expect(input).toHaveValue('');

	// The command never reached the model.
	const prompts = (await stubState()).promptCalls;
	expect(prompts.filter((p) => p.text.startsWith('/compact'))).toEqual([]);
});

test('03 · hint pick — "/plan " lands; the operator\'s Enter (press 2) executes with the args', async ({ page }) => {
	const input = await openComposer(page);
	await input.fill('/');
	await expect(page.getByTestId('slash-command-row').filter({ hasText: 'plan' })).toBeVisible();
	await page
		.getByTestId('slash-command-row')
		.filter({ hasText: 'plan' })
		.first()
		.click();

	// The pick landed the token plain (no ghost overlay) and did NOT send.
	await expect(input).toHaveValue('/plan ');
	await expect(page.getByTestId('command-note')).toHaveCount(0);
	await expect((await stubState()).commandExecuteCalls).toEqual([]);

	// Press 2 — the operator's own Enter executes the WHOLE line (the host
	// parses the arguments; the client never re-parsed them).
	await input.fill('/plan the layout');
	await input.press('Enter');
	await expect(page.getByTestId('command-note')).toContainText('plan armed');
	await expect.poll(async () => (await stubState()).commandExecuteCalls).toEqual(['/plan the layout']);
	const prompts = (await stubState()).promptCalls;
	expect(prompts.filter((p) => p.text.startsWith('/plan'))).toEqual([]);
});

test('04 · skill pick — "/dsh-doc " lands; Enter ships the prompt verbatim; the shelf records nothing', async ({ page }) => {
	const input = await openComposer(page);
	await input.fill('/');
	await expect(page.getByTestId('slash-skill-row').filter({ hasText: 'dsh-doc' })).toBeVisible();
	await page
		.getByTestId('slash-skill-row')
		.filter({ hasText: 'dsh-doc' })
		.first()
		.click();
	await expect(input).toHaveValue('/dsh-doc ');
	await expect(page.getByTestId('command-note')).toHaveCount(0); // never auto-sent

	// Press 2 — the ordinary prompt route (the host pre-step injects the body).
	await input.fill('/dsh-doc explain the mux');
	await input.press('Enter');
	await expect
		.poll(async () => (await stubState()).promptCalls.map((p) => p.text))
		.toContain('/dsh-doc explain the mux');
	// No command wire for a skill — the prompt pipe IS the skill path.
	await expect((await stubState()).commandExecuteCalls).toEqual([]);

	// `/`-lines are control traffic: the shelf recorded nothing (the
	// record guard's shouldRecordPrompt never fired for this send).
	const shelf = await fetch(`${APP}/api/prompts?q=dsh-doc&limit=10`);
	const shelfBody = (await shelf.json()) as { results?: Array<{ text: string }> };
	expect(shelfBody.results ?? []).toEqual([]);
});

test('05 · passthrough — "/nope" + Enter falls through the open zero-match menu as chat', async ({ page }) => {
	const input = await openComposer(page);
	await input.fill('/');
	await expect(page.getByTestId('slash-menu')).toBeVisible();
	await input.fill('/nope');
	// The menu stays open with its honest no-match row — and intercepts
	// nothing: zero matching rows means Enter falls through (the strip's
	// row-gated guard).
	await expect(page.getByTestId('slash-menu-nomatch')).toBeVisible();
	await input.press('Enter');

	await expect
		.poll(async () => (await stubState()).promptCalls.map((p) => p.text))
		.toContain('/nope');
	await expect((await stubState()).commandExecuteCalls).toEqual([]);
	// The cleared draft closed the menu behind the send.
	await expect(page.getByTestId('slash-menu')).toHaveCount(0);
});

test('06 · collision — a name in BOTH catalogs resolves to the COMMAND', async ({ page }) => {
	const input = await openComposer(page);
	await input.fill('/compact');
	// The menu lists the twin honestly (one row per section)…
	await expect(page.getByTestId('slash-command-row')).toHaveCount(1);
	await expect(page.getByTestId('slash-skill-row')).toHaveCount(1);
	// …but the ladder's structural order adjudicates: Enter on the ambiguous
	// draft executes the COMMAND (the native rule — the skill never rode the
	// prompt pipe and the line never reached the model).
	await input.press('Enter');
	await expect(page.getByTestId('command-note')).toContainText('context compacted');
	await expect.poll(async () => (await stubState()).commandExecuteCalls).toEqual(['/compact']);
	const prompts = (await stubState()).promptCalls;
	expect(prompts.filter((p) => p.text.startsWith('/compact'))).toEqual([]);
});

/**
 * E2E: DSI slash commands (2026-08-25) — the composer's OCI-style intercept
 * against the stub DSH host: /permission executes through the NATIVE
 * commands/execute wire (never a model prompt) and answers in the banner;
 * /new creates a successor session in the same workspace and swaps THIS
 * panel onto it; unknown slash lines pass through as ordinary chat.
 */

import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

// All spec files share the webServer's DSH_BASE_URL port (4590); workers:1
// serializes files, so each beforeAll owns the port for its file.
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
	permissionPreset: string;
	permissionCalls: string[];
	promptCalls: Array<{ text: string; mode: string }>;
	createCalls: Array<{ cwd?: string; agentPreset?: string }>;
}

async function stubState(): Promise<StubStateView> {
	const res = await fetch(stubCtl);
	return (await res.json()) as StubStateView;
}

async function resetState(): Promise<void> {
	// lastSeq jumps above any seq the SHARED DSI dev server's ring buffer
	// still holds from previous spec files (its per-session buffer survives
	// across files; a fresh stub restarts seqs from low numbers and stale
	// knob events would outrank ours in the poll's fold). The gap this
	// creates triggers DSI's ledger resync (BC-4) — the stub's ledger is
	// the truth, so the buffer heals from it.
	await fetch(stubCtl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			permissionPreset: 'workspace-write',
			permissionCalls: [],
			promptCalls: [],
			createCalls: [],
			lastSeq: 1_000_000
		})
	});
}

test('01 · /permission read-only executes host-side; the banner answers; the chip follows', async ({ page }) => {
	await resetState();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const chip = page.getByTestId('access-mode-chip');
	await expect(chip).toBeVisible();

	const input = page.locator('textarea').first();
	await input.fill('/permission read-only');
	await input.press('Enter');

	// The line ran through commands/execute (the native wire) — the stub
	// recorded the verbatim line and flipped its state.
	await expect
		.poll(async () => (await stubState()).permissionCalls)
		.toEqual(['/permission read-only']);

	// The banner surfaces the host's own reply text.
	await expect(page.getByTestId('command-note')).toContainText('preset read-only');

	// The knob events ride the poll → the chip's fold confirms.
	await expect(chip).toBeEnabled({ timeout: 10_000 });
	await expect(chip).toHaveAttribute('aria-label', 'Access mode, current: Read Only');

	// The command never reached the model.
	const prompts = (await stubState()).promptCalls;
	expect(prompts.filter((p) => p.text.startsWith('/permission'))).toEqual([]);
});

test('02 · bare /permission prints the current preset; unknown presets answer verbatim', async ({ page }) => {
	await resetState();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('access-mode-chip')).toBeVisible();

	const input = page.locator('textarea').first();
	await input.fill('/permission');
	await input.press('Enter');
	await expect(page.getByTestId('command-note')).toContainText('current preset workspace-write');

	await input.fill('/permission yolo');
	await input.press('Enter');
	await expect(page.getByTestId('command-note')).toContainText('unknown preset "yolo"');
});

test('03 · /new swaps THIS panel onto a fresh session in the same workspace', async ({ page }) => {
	await resetState();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('access-mode-chip')).toBeVisible();
	// The seed panel mounts for the stub session (one column on the floor).
	await expect(page.getByTestId('access-mode-chip')).toHaveCount(1);

	const input = page.locator('textarea').first();
	await input.fill('/new');
	await input.press('Enter');

	// The create call inherited the stub session's workspace (/tmp) and
	// preset (main — the stub row's agentPreset).
	await expect
		.poll(async () => (await stubState()).createCalls)
		.toEqual([{ cwd: '/tmp', agentPreset: 'main' }]);

	// The panel swapped onto the new session: a fresh cold load clears the
	// transcript the old session had (the stub's seeded entries vanish),
	// and no error banner appears.
	await expect(page.getByTestId('command-note')).toHaveCount(0);
	await expect(page.locator('[data-testid="transcript"]')).toBeVisible();

	// Swap-focus (2026-08-29): the fresh panel's composer takes the caret —
	// the operator typed /new and is about to type into the successor.
	const swapped = page.locator('[data-testid="prompt-textarea"]');
	await expect(swapped).toBeFocused();
	// The caret is ready for real typing (stub-safe: never sends).
	await swapped.fill('next conversation starts here');
	await expect(swapped).toHaveValue('next conversation starts here');
});

test('03b · a page reload never steals focus (the swap-focus is one-shot)', async ({ page }) => {
	await resetState();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('access-mode-chip')).toBeVisible();

	// Run one /new so the desk holds the swapped panel, then reload — the
	// restored desk mounts every panel WITHOUT the focus marker (a plain
	// page load never sets it).
	const input = page.locator('textarea').first();
	await input.fill('/new');
	await input.press('Enter');
	await expect(page.locator('[data-testid="prompt-textarea"]')).toBeFocused();

	await page.reload();
	await expect(page.locator('[data-testid="prompt-textarea"]')).toBeVisible();
	await expect(page.locator('[data-testid="prompt-textarea"]')).not.toBeFocused();
});

test('04 · unknown slash lines pass through as ordinary chat (never intercepted)', async ({ page }) => {
	await resetState();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('access-mode-chip')).toBeVisible();

	const before = (await stubState()).promptCalls.length;
	const input = page.locator('textarea').first();
	await input.fill('/usr/bin/python is not a command');
	await input.press('Enter');

	// It reached the host as an ordinary prompt (the OCI passthrough rule).
	await expect
		.poll(async () => (await stubState()).promptCalls.length)
		.toBeGreaterThan(before);
	await expect(page.getByTestId('command-note')).toHaveCount(0);
});

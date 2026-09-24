/**
 * E2E: DSI command help (command-help, 2026-08-30) — the composer's `?`
 * help intent against the stub DSH host: a known command with `?` as its
 * entire first argument (`/new ?`, `/permission ?`, `@abc ?`) opens the
 * help card above the composer; Enter NEVER delivers the line (nothing
 * reaches the stub's prompt wire); Esc hides the card and the draft
 * survives for editing; Enter on a dismissed card re-opens it.
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
	promptCalls: Array<{ text: string; mode: string }>;
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
			lastSeq: 1_000_000
		})
	});
}

test('01 · "/new ?" opens the help card; Enter never delivers the ? line', async ({ page }) => {
	await resetState();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('access-mode-chip')).toBeVisible();

	const input = page.getByTestId('prompt-textarea');
	await input.fill('/new ?');
	const card = page.getByTestId('command-help');
	await expect(card).toBeVisible();
	await expect(card).toContainText('/new [@agent]');

	await input.press('Enter');
	await page.waitForTimeout(400); // a send would have landed by now
	expect((await stubState()).promptCalls).toEqual([]);
	await expect(input).toHaveValue('/new ?'); // the draft survives for editing
	await expect(card).toBeVisible();
});

test('02 · each command answers with its own topic; ordinary text never opens it', async ({ page }) => {
	await resetState();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('access-mode-chip')).toBeVisible();

	const input = page.getByTestId('prompt-textarea');
	await input.fill('/permission ?');
	await expect(page.getByTestId('command-help')).toContainText('/permission [preset]');
	await input.fill('@abc ?');
	await expect(page.getByTestId('command-help')).toContainText('@<session-id> <message>');
	// The finder trigger and ordinary text never open the card.
	await input.fill('?load');
	await expect(page.getByTestId('command-help')).toHaveCount(0);
	await input.fill('hello world');
	await expect(page.getByTestId('command-help')).toHaveCount(0);
});

test('03 · Esc hides the card; a dismissed ? line still never sends (Enter re-opens)', async ({ page }) => {
	await resetState();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('access-mode-chip')).toBeVisible();

	const input = page.getByTestId('prompt-textarea');
	await input.fill('/permission ?');
	await expect(page.getByTestId('command-help')).toBeVisible();
	await input.press('Escape');
	await expect(page.getByTestId('command-help')).toHaveCount(0);
	await expect(input).toHaveValue('/permission ?');

	await input.press('Enter');
	await expect(page.getByTestId('command-help')).toBeVisible(); // re-opened, not sent
	await page.waitForTimeout(400);
	expect((await stubState()).promptCalls).toEqual([]);
});

test('04 · the settings commands answer with their own topics (Settings Panel W5)', async ({ page }) => {
	await resetState();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('access-mode-chip')).toBeVisible();

	const input = page.getByTestId('prompt-textarea');
	await input.fill('/dsi-settings ?');
	await expect(page.getByTestId('command-help')).toBeVisible();
	await expect(page.getByTestId('command-help')).toContainText('/dsi-settings');
	await expect(page.getByTestId('command-help')).toContainText('settings.yaml');

	await input.fill('/dsh-settings ?');
	await expect(page.getByTestId('command-help')).toBeVisible();
	await expect(page.getByTestId('command-help')).toContainText('/dsh-settings');

	// Help is never a send (the ? line never reaches the stub's prompt wire).
	await input.press('Escape');
	await input.press('Enter');
	await page.waitForTimeout(400);
	expect((await stubState()).promptCalls).toEqual([]);
});

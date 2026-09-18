/**
 * E2E: The Session Full Path (Wave 3 task 3.1, ADR D1/D2/D4) — the joined
 * surface: DSI boots against the stub host with DSI_SESSIONS_ROOT pointed
 * at a per-run disposable root (playwright.config.ts BC-10 seam). The spec
 * seeds `session-<id>` for the stub session and proves the operator
 * journey end to end:
 *   1. directory on disk  → button visible → click → the CLIPBOARD carries
 *      the ABSOLUTE session DIRECTORY path (never an id, never a file).
 *   2. empty root         → button honestly absent (404, no guess state).
 *
 * The unit layer pins the wiring; Playwright only proves the joined seam —
 * the real server route reading real disk through the real fetch.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const STUB_PORT = 4590;
const SESSIONS_ROOT = process.env.DSI_SESSIONS_ROOT ?? '';
// Real disk layout (RCA 2026-09-14, DSH format.ts:266): current generation
// names the dir by the BARE id; session-<id> is the legacy generation.
const EXPECTED_PATH = join(SESSIONS_ROOT, '--e2e-proj--', STUB_SESSION_ID);

let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
	rmSync(SESSIONS_ROOT, { recursive: true, force: true });
});

test.afterAll(async () => {
	await stub?.stop();
});

test('seeded directory → click copies the absolute session directory path', async ({ page }) => {
	mkdirSync(EXPECTED_PATH, { recursive: true });

	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const header = page.getByTestId('session-id-and-name');
	await expect(header).toBeVisible();

	const button = header.locator('[data-testid="conversation-header-copy-path"]');
	await expect(button).toBeVisible();

	await button.click();

	const clipboard = await page.evaluate(() => navigator.clipboard.readText());
	expect(clipboard).toBe(EXPECTED_PATH);
});

test('empty root → the button is honestly absent (no guess state)', async ({ page }) => {
	rmSync(SESSIONS_ROOT, { recursive: true, force: true });

	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const header = page.getByTestId('session-id-and-name');
	await expect(header).toBeVisible();

	// Give the /path fetch a moment to answer 404 — then the button must
	// NOT exist in the DOM at all (hidden, not visible-disabled).
	await expect(
		header.locator('[data-testid="conversation-header-copy-path"]')
	).toHaveCount(0);
});

/**
 * E2E: the profile param convention (2026-08-24) — one browser, many desks.
 *
 *   /?sessionKey=X                → seed, strip ALL → dsi-panels
 *   /?sessionKey=X&profile=widi   → seed, strip sessionKey ONLY
 *                                              (profile retained in the bar)
 *                                             → dsi-panels_widi
 *   /?profile=widi (refresh)      → restore from dsi-panels_widi
 *
 * Specs:
 *   01 profile seed strips sessionKey only; the widi desk is seeded; the
 *      default desk is untouched (isolation)
 *   02 refresh on /?profile=widi restores the widi desk
 *   03 the spine rows' hrefs carry the active profile (middle-click stays
 *      on the same desk)
 */

import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

const STUB_PORT = 4590;
const stubCtl = `http://127.0.0.1:${STUB_PORT}/__e2e/state`;

/** Second session for the spine — the paneled session is excluded from it. */
const SPINE_SESSION_ID = 'e2e-profile-spine-0001';

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

/** Give the spine a row the floor does not panel. */
async function addSpineSession(): Promise<void> {
	await stubSet({
		extraSessions: [
			{
				sessionId: SPINE_SESSION_ID,
				title: 'Profile spine row',
				agentPreset: 'research',
				cwd: '/tmp',
				ledger: [
					{
						event: {
							type: 'user/message',
							seq: 2,
							time: Date.now(),
							data: {
								content: [{ type: 'text', text: 'spine row for profile href' }],
								id: 'u2',
								role: 'user'
							}
						}
					}
				]
			}
		]
	});
}

test('01 · profile seed → URL keeps ?profile=widi, dsi-panels_widi seeded, default desk untouched', async ({
	page
}) => {
	// Seed the DEFAULT desk first with a sentinel panel.
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page).toHaveURL(/\/$/);
	const defaultBefore = await page.evaluate(() => ({
		panels: localStorage.getItem('dsi-panels'),
		sidebar: localStorage.getItem('dsi-sidebar'),
		filter: localStorage.getItem('dsi-session-filter')
	}));

	// Now arrive with a profile — a DIFFERENT session seeds the widi desk.
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}&profile=widi`);
	await expect(page).toHaveURL(/\/?profile=widi$/);

	const widi = await page.evaluate(() => localStorage.getItem('dsi-panels_widi'));
	expect(widi).toContain(STUB_SESSION_ID);

	// The profile suffixes EVERY dsi-* key — sidebar layout + session
	// filter moved to the widi desk as well (storage-profile convention).
	const deskKeys = await page.evaluate(() => ({
		panels: localStorage.getItem('dsi-panels_widi'),
		sidebar: localStorage.getItem('dsi-sidebar_widi'),
		filter: localStorage.getItem('dsi-session-filter_widi')
	}));
	expect(deskKeys.panels).toContain(STUB_SESSION_ID);
	expect(deskKeys.sidebar).not.toBeNull();
	expect(deskKeys.filter).not.toBeNull();

	// Isolation: every default-desk key is byte-identical to before.
	const defaultAfter = await page.evaluate(() => ({
		panels: localStorage.getItem('dsi-panels'),
		sidebar: localStorage.getItem('dsi-sidebar'),
		filter: localStorage.getItem('dsi-session-filter')
	}));
	expect(defaultAfter).toEqual(defaultBefore);

	// The seeded panel rendered on the widi desk (scoped to the floor —
	// the sidebar's panel row carries the same data-session-id).
	await expect(
		page.locator(`[data-testid="panel-column"][data-session-id="${STUB_SESSION_ID}"]`)
	).toBeVisible();
});

test('02 · refresh on /?profile=widi restores the widi desk (profile is sticky)', async ({
	page
}) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}&profile=widi`);
	await expect(page).toHaveURL(/\/?profile=widi$/);
	await expect(
		page.locator(`[data-testid="panel-column"][data-session-id="${STUB_SESSION_ID}"]`)
	).toBeVisible();

	// Refresh: the URL still carries profile → same desk, no re-seed.
	await page.reload();
	await expect(page).toHaveURL(/\/?profile=widi$/);
	await expect(
		page.locator(`[data-testid="panel-column"][data-session-id="${STUB_SESSION_ID}"]`)
	).toBeVisible();
});

test('03 · spine row hrefs carry the active profile (same desk on middle-click)', async ({ page }) => {
	await addSpineSession();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}&profile=widi`);
	await expect(page).toHaveURL(/\/?profile=widi$/);

	// The spine row for OUR session (matched by its title — rows carry no
	// session id attribute) carries the profile in its raw href.
	const href = await page
		.locator('[data-testid="sidebar-session-card"]', { hasText: 'Profile spine row' })
		.getAttribute('href');
	expect(href).toContain(`sessionKey=${SPINE_SESSION_ID}`);
	expect(href).toContain('profile=widi');
});

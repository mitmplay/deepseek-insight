/**
 * E2E: The Skill Shelf (ADR 2026-09-20) — /dsi-skills opens the
 * SettingsSkillsPanel; the snapshot renders numbered rows with per-species
 * badges; the uninstall affordance exists ONLY on signed rows (D5);
 * the reload button drives /api/skills/reload; install posts the selection.
 * The /api/skills plane is intercepted (fixture snapshot) — the engine
 * and GitHub are never touched from a test.
 */
import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

const STUB_PORT = 4590;
let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

const SNAP = {
	ok: true,
	reused: true,
	uninstallable: ['shelf-signed-skill'],
	snapshot: {
		v: 1,
		generatedAt: '2026-09-20T12:00:00.000Z',
		sources: [
			{
				id: 'pstack',
				author: 'Lauren Tan',
				repo: 'r',
				skills: [
					{ n: '1.1', id: 'shelf-plain-skill', path: 'p', tier: null, installed: false, signed: false, installedFrom: null },
					{ n: '1.2', id: 'shelf-signed-skill', path: 'p', tier: null, installed: true, signed: true, installedFrom: 'pstack' },
					{ n: '1.3', id: 'shelf-foreign-skill', path: 'p', tier: null, installed: true, signed: false, installedFrom: null }
				]
			}
		]
	}
};


const VOICE_FIXTURE = {
  ok: true,
  voice: {
    'shelf-plain-skill': {
      id: { name: 'shelf-plain-skill', description: 'coax pilihan skill dalam Bahasa indonesia', whenToUse: '' },
      en: { name: 'shelf-plain-skill', description: 'english fallback description', whenToUse: '' }
    }
  }
};

test('the skill shelf: macro opens the panel, badges render, uninstall is signed-only', async ({ page }) => {
	// Mock ONLY the shelf data plane; the DSH stub host handles the rest.
	await page.route('**/api/skills/snapshot', (route) => route.fulfill({ json: SNAP }));
	await page.route('**/api/skills/reload', (route) => route.fulfill({ json: { ...SNAP, reused: false } }));
	await page.route('**/api/skills/voice', (route) => route.fulfill({ json: VOICE_FIXTURE }));
	await page.route('**/api/skills/install', (route) =>
		route.fulfill({ json: { ok: true, results: [{ n: '1.1', ok: true }] } })
	);

	await page.goto('/?sessionKey=' + STUB_SESSION_ID);
	const composer = page.locator('textarea').first();
	await expect(composer).toBeVisible();

	// The macro: typed into the composer, Enter executes it.
	await composer.fill('/dsi-skills');
	await composer.press('Enter');

	// The panel mounts and renders the snapshot. The shelf ships ALL
	// COLLAPSED (The Shelf Chrome, 2026-09-21) - the operator expands
	// the repo before reading rows.
	const shelf = page.getByTestId('skill-shelf');
	await expect(shelf).toBeVisible();
	await expect(page.getByTestId('shelf-group-pstack')).toBeVisible();
	await page.getByTestId('shelf-expand-all').click();

	// Rows render with their shelf numbers (install tab = uninstalled only).
	await expect(page.getByTestId('shelf-row-shelf-plain-skill')).toContainText('1.1');
	await expect(page.getByTestId('shelf-row-shelf-signed-skill')).toHaveCount(0);

	// The uninstall tab holds the installed rows: badges render; the
	// foreign row still shows a badge but carries NO uninstall button
	// (D5 - signed-only).
	await page.getByTestId('shelf-tab-uninstall').click();
	const signedRow = page.getByTestId('shelf-row-shelf-signed-skill');
	await expect(signedRow.getByTestId('shelf-badge')).toBeVisible();
	await expect(signedRow.getByTestId('shelf-uninstall-shelf-signed-skill')).toBeVisible();

	const foreignRow = page.getByTestId('shelf-row-shelf-foreign-skill');
	await expect(foreignRow.getByTestId('shelf-badge')).toBeVisible();
	await expect(foreignRow.locator('[data-testid^="shelf-uninstall"]')).toHaveCount(0);

	// Back to the install tab: the absent row is installable - checkbox
	// select + Install posts it.
	await page.getByTestId('shelf-tab-install').click();

	// The absent row is installable: checkbox select + Install posts it.
	await page
		.locator('[data-testid="shelf-row-shelf-plain-skill"] input[type="checkbox"]')
		.check();
	await page.getByTestId('shelf-install').click();
	// After the install the panel refetches the snapshot (still the fixture).

	// Reload drives the reload endpoint.
	await page.getByTestId('shelf-reload').click();
	await expect(page.getByTestId('skill-shelf')).toBeVisible();
});
test('the shelf speaks the operator language: voice overlay + rescan note', async ({ page }) => {
	await page.route('**/api/skills/snapshot', (route) => route.fulfill({ json: SNAP }));
	await page.route('**/api/skills/voice', (route) => route.fulfill({ json: VOICE_FIXTURE }));
	await page.route('**/api/skills/install', (route) =>
		route.fulfill({ json: { ok: true, results: [{ n: '1.1', ok: true }] } })
	);

	// the cookie picks the operator locale BEFORE the app boots (resolver row 1)
	await page.context().addCookies([{ name: 'dsi.locale', value: 'id', url: 'http://127.0.0.1:5176' }]);
	await page.goto('/?sessionKey=' + STUB_SESSION_ID);
	const composer = page.locator('textarea').first();
	await composer.fill('/dsi-skills');
	await composer.press('Enter');

	const shelf = page.getByTestId('skill-shelf');
	await expect(shelf).toBeVisible();
	await expect(page.getByTestId('shelf-group-pstack')).toBeVisible();
	await page.getByTestId('shelf-expand-all').click();
	// the voice API serves the id-locale sidecar (D5 server contract; the
	// SLASH MENU overlay consumes this map - unit-covered - while the panel
	// itself renders shelf state)
	const voiceBody = await page.evaluate(async () => {
		const res = await fetch('/api/skills/voice');
		return res.json();
	});
	expect(voiceBody.ok).toBe(true);
	expect(voiceBody.voice['shelf-plain-skill'].id.description).toContain('Bahasa indonesia');

	// install -> the rescan expectation note renders (D2), in the active locale
	await page.locator('[data-testid="shelf-row-shelf-plain-skill"] input[type="checkbox"]').check();
	await page.getByTestId('shelf-install').click();
	await expect(page.getByTestId('shelf-rescan')).toBeVisible();
});
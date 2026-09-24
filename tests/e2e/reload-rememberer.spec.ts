/**
 * E2E: The Reload Rememberer (ADR 2026-09-22, D4/D5) — reload feedback
 * survives a browser hard reload. The /api/skills plane is intercepted
 * (fixture snapshot) — the engine is NEVER touched from a test (D5: one
 * headed run, no live engine reload).
 *
 * Cache-bypass rule (ADR fact 6: page.reload() reuses the HTTP cache):
 * freshness here rests on TWO layers — the config's webServer builds a
 * fresh bundle per RUN, and Playwright gives each TEST a fresh browser
 * context, so no module graph can leak across iterations.
 */
import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

const STUB_PORT = 4590; // MUST equal the config's DSH_BASE_URL stub port
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
	uninstallable: [],
	snapshot: {
		v: 1,
		generatedAt: '2026-09-23T12:00:00.000Z',
		sources: [
			{
				id: 'pstack',
				author: 'Lauren Tan',
				repo: 'r',
				skills: [
					{ n: '1.1', id: 'rr-skill', path: 'p', tier: null, installed: false, signed: false, installedFrom: null }
				]
			}
		]
	}
};

/** The persisted floor blob with ONE skill-shelf entry carrying `reload`. */
function prefsBlob(reload: unknown): string {
	return JSON.stringify({
		panels: [
			{ id: 'shelf-1', kind: 'skill-shelf', width: 480, tab: 'install', collapsed: [], searchQ: '', reload }
		],
		selectedPanelId: 'shelf-1',
		panelWidth: 730,
		zoom: 1
	});
}

async function openShelf(page: import('@playwright/test').Page): Promise<void> {
	await page.goto('/?sessionKey=' + STUB_SESSION_ID);
	const composer = page.locator('textarea').first();
	await expect(composer).toBeVisible();
	await composer.fill('/dsi-skills');
	await composer.press('Enter');
	await expect(page.getByTestId('skill-shelf')).toBeVisible();
}

test('the reload survives a hard reload mid-flight: spinner persists, the check still lands', async ({ page }) => {
	let reloadCalls = 0;
	await page.route('**/api/skills/snapshot', (route) => route.fulfill({ json: SNAP }));
	await page.route('**/api/skills/reload', async (route) => {
		reloadCalls++;
		// hold EACH reload in flight long enough to interrupt / observe it
		await new Promise((res) => setTimeout(res, reloadCalls === 1 ? 8_000 : 1_200));
		await route.fulfill({ json: { ...SNAP, reused: false } });
	});

	await openShelf(page);
	const reloadBtn = page.getByTestId('shelf-reload');
	await expect(reloadBtn).toBeVisible();

	// USER ACTION 1: click reload (the first reload is now in flight).
	await reloadBtn.click();
	await expect(reloadBtn).toHaveAttribute('data-reload-state', 'loading');
	// the floor writes the loading blob synchronously on emit
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('dsi-panels')))
		.toContain('"phase":"loading"');

	// USER ACTION 2: HARD RELOAD mid-flight (the old document's fetch dies).
	await page.reload();
	const shelf = page.getByTestId('skill-shelf');
	await expect(shelf).toBeVisible();
	const restoredBtn = page.getByTestId('shelf-reload');

	// the restored machine re-issued the reload (the SECOND call fired)
	await expect.poll(() => reloadCalls, { timeout: 10_000 }).toBe(2);
	// the spinner PERSISTS while the re-issued round-trip is in flight
	await expect(restoredBtn).toHaveAttribute('data-reload-state', 'loading');
	// USER ACCEPTANCE: the check still lands after the interruption
	await expect(restoredBtn).toHaveAttribute('data-reload-state', 'done', { timeout: 10_000 });
});

test('a done blob lives out its REMAINING window, never a fresh one', async ({ page }) => {
	await page.route('**/api/skills/snapshot', (route) => route.fulfill({ json: SNAP }));
	await page.route('**/api/skills/reload', (route) => route.fulfill({ json: { ...SNAP, reused: false } }));
	// seed a done blob with ~1.6s LEFT on its absolute deadline, pre-boot
	const blob = prefsBlob({ phase: 'done', startedAt: Date.now() - 3_400, doneAt: Date.now() + 1_600 });
	await page.addInitScript((b) => localStorage.setItem('dsi-panels', b), blob);

	// the shelf restores from the blob WITHOUT the macro (floor seeding).
	// BARE arrival: a ?sessionKey= arrival is a fresh SEED (R1) and would
	// reset the desk instead of restoring the persisted blob.
	await page.goto('/');
	await expect(page.getByTestId('skill-shelf')).toBeVisible();
	const btn = page.getByTestId('shelf-reload');

	// the check resumes for the remainder
	await expect(btn).toHaveAttribute('data-reload-state', 'done');
	const t0 = Date.now();
	await expect(btn).toHaveAttribute('data-reload-state', 'idle', { timeout: 3_500 });
	// it died at the ABSOLUTE deadline (~1.6s), nowhere near a fresh 5s
	expect(Date.now() - t0).toBeLessThan(3_000);
	// the floor heard the expiry — the persisted blob cleared
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('dsi-panels') ?? ''))
		.not.toContain('"phase":"done"');
});

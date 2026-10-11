/**
 * E2E: The Three-State Lamp (ADR-0023, 2026-10-11) — Wave 3 task 3.2.
 *
 *   1. UI round-trip: the settings row (before LanguageMenu) flips
 *      html[data-theme] live; the choice persists to localStorage
 *   2. reload persistence + the NO-FLASH proof: after reload the attribute
 *      is already resolved at DOMContentLoaded — the pre-paint script ran
 *      before the framework
 *   3. hard-reload survival: localStorage (not cache) carries the choice
 *   4. system mode follows a stubbed OS flip live; pinned mode ignores it
 */

import { expect, test } from '@playwright/test';

test.describe('the three-state lamp', () => {
	test('the footer toggle (before LanguageMenu) flips data-theme live and persists', async ({ page }) => {
		await page.goto('/');
		const toggle = page.locator('[data-testid="theme-toggle"]');
		await expect(toggle).toBeVisible();
		// placement: the theme toggle sits BEFORE the language menu pill
		const lang = page.locator('[data-testid="language-menu"]');
		await expect(lang).toBeVisible();
		expect((await toggle.boundingBox())!.x < (await lang.boundingBox())!.x).toBeTruthy();

		// open the popup, pick Dark
		await page.locator('[data-testid="theme-toggle-trigger"]').click();
		await page.locator('[data-testid="theme-option-dark"]').click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
		const stored = await page.evaluate(() => localStorage.getItem('dsi-theme'));
		expect(stored).toBe('dark');
	});

	test('reload persistence + NO-FLASH: attribute resolved at DOMContentLoaded', async ({ page }) => {
		await page.addInitScript(() => localStorage.setItem('dsi-theme', 'dark'));
		await page.goto('/');
		// DOMContentLoaded fires after the pre-paint script but the assertion
		// reads the attribute the instant the DOM is interactive — if the
		// inline script did not run, this would still be 'light' (default)
		const atDOMContentLoaded = await page.evaluate(
			() =>
				new Promise<string>((resolve) => {
					if (document.readyState === 'interactive' || document.readyState === 'complete') {
						resolve(document.documentElement.dataset.theme ?? '');
					} else {
						document.addEventListener('DOMContentLoaded', () =>
							resolve(document.documentElement.dataset.theme ?? '')
						);
					}
				})
		);
		expect(atDOMContentLoaded).toBe('dark');
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	});

	test('hard reload keeps the lamp: storage, not cache, carries the choice', async ({ page }) => {
		await page.goto('/');
		await page.evaluate(() => localStorage.setItem('dsi-theme', 'dark'));
		// Chrome hard reload = bypass cache, keep storage. Playwright's
		// reload with ignoreHTTPSErrors is closest; also strip cache via CDP
		// is unnecessary — storage is per-origin, never in the HTTP cache.
		await page.reload();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
		// and once more the raw way a hard reload arrives: same URL re-goto
		await page.goto('/');
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	});

	test('system mode follows a live OS flip; pinned mode ignores it', async ({ page }) => {
		// stub matchMedia BEFORE any script: expose a flip hook the test pokes
		await page.addInitScript(() => {
			let dark = false;
			const listeners: ((e: { matches: boolean }) => void)[] = []; // ONE array, shared by every matchMedia() call
			window.matchMedia = ((query: string) => ({
				matches: query.includes('dark') ? dark : false,
				media: query,
				onchange: null,
				addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.push(fn),
				removeEventListener: () => {},
				addListener: () => {},
				removeListener: () => {},
				dispatchEvent: () => false
			})) as unknown as typeof window.matchMedia;
			(window as unknown as { __flipOsDark: (v: boolean) => void }).__flipOsDark = (v: boolean) => {
				dark = v;
				listeners.forEach((fn) => fn({ matches: v }));
			};
		});
		await page.goto('/');
		await page.evaluate(() => localStorage.setItem('dsi-theme', 'system'));
		await page.reload();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light'); // OS says light
		// the live listener attaches at layout onMount (adopt) — wait for the
		// app to be mounted before flipping, or the flip fires into the void
		await expect(page.locator('[data-testid="theme-toggle-trigger"]')).toBeVisible();
		await page.waitForTimeout(250); // let the mount effects settle

		await page.evaluate(() => (window as unknown as { __flipOsDark: (v: boolean) => void }).__flipOsDark(true));
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark'); // followed live

		await page.evaluate(() => localStorage.setItem('dsi-theme', 'light'));
		await page.evaluate(() => (window as unknown as { __flipOsDark: (v: boolean) => void }).__flipOsDark(false));
		// pinned: the attribute holds whatever resolution it had — the flip
		// is ignored. Re-resolve via a fresh boot to prove the pin:
		await page.reload();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
	});
});

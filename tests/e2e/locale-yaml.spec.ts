/**
 * E2E: yaml-default first paint — Three Tongues W4 task 4.1 (ADR 2026-09-12
 * D3, AC1). The main lane (locale.spec.ts) covers cookie flows; this file
 * owns the OPERATOR DEFAULT leg: with no dsi.locale cookie, ui.locale in
 * the run's tmp settings.yaml must drive SSR first paint (html lang + the
 * rail trigger), an INVALID cookie must fall through to the yaml default,
 * and a VALID cookie must beat yaml (state-homes row 1 over row 2).
 *
 * BC-10: DSI_CONFIG_PATH is the run's disposable tmp settings.yaml.
 * workers=1 + fullyParallel:false make the write→restore dance safe —
 * no concurrent spec reads the file while it holds the ui section.
 *
 * Selectors verified in component source (Step 3.8): language-menu-trigger
 * (LanguageMenu.svelte), html lang (app.html placeholder).
 */
import { expect, test } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const DSI_SETTINGS = process.env.DSI_CONFIG_PATH ?? '';
let original: string | null = null;

test.beforeAll(() => {
	original = existsSync(DSI_SETTINGS) ? readFileSync(DSI_SETTINGS, 'utf8') : null;
	const YAML_SEED = ['ui:', '  locale: zh', ''].join(String.fromCharCode(10));
	writeFileSync(DSI_SETTINGS, YAML_SEED, 'utf-8');
});

test.afterAll(() => {
	if (original === null) {
		if (existsSync(DSI_SETTINGS)) writeFileSync(DSI_SETTINGS, '', 'utf-8');
	} else {
		writeFileSync(DSI_SETTINGS, original, 'utf-8');
	}
});

test.describe('yaml operator default (AC1)', () => {
	test('fresh visit with no cookie renders zh on first paint', async ({ browser }) => {
		const context = await browser.newContext(); // cookie-less by construction
		const page = await context.newPage();
		await page.goto('/');
		expect(await page.evaluate(() => document.documentElement.lang)).toBe('zh');
		await expect(page.getByTestId('language-menu-trigger')).toContainText('zh');
		await context.close();
	});

	test('invalid cookie falls through to the yaml default (zh)', async ({ browser }) => {
		const context = await browser.newContext();
		await context.addCookies([
			{ name: 'dsi.locale', value: 'xx', url: 'http://127.0.0.1:5176' }
		]);
		const page = await context.newPage();
		await page.goto('/');
		expect(await page.evaluate(() => document.documentElement.lang)).toBe('zh');
		await context.close();
	});

	test('a valid cookie beats the yaml default (state-homes row 1 > row 2)', async ({ browser }) => {
		const context = await browser.newContext();
		await context.addCookies([
			{ name: 'dsi.locale', value: 'id', url: 'http://127.0.0.1:5176' }
		]);
		const page = await context.newPage();
		await page.goto('/');
		expect(await page.evaluate(() => document.documentElement.lang)).toBe('id');
		await context.close();
	});
});

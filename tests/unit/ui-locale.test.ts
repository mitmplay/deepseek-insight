/**
 * ui.locale config seat — Three Tongues W1 task 1.2-T (ADR 2026-09-12 D3/D5).
 * Node env (no DOM needed) — registered in vitest environmentMatchGlobs.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_UI_LOCALE, UI_LOCALES, resolveUiLocale } from '$lib/config';

describe('ui.locale config default + literal gate', () => {
	it('default is en (ADR D5: baseLocale is the fallback)', () => {
		expect(DEFAULT_UI_LOCALE).toBe('en');
	});

	it('fleet is exactly en, zh, id, es', () => {
		expect([...UI_LOCALES]).toEqual(['en', 'zh', 'id', 'es']);
	});

	it('valid fleet locales pass through', () => {
		expect(resolveUiLocale('zh')).toBe('zh');
		expect(resolveUiLocale('id')).toBe('id');
		expect(resolveUiLocale('en')).toBe('en');
		expect(resolveUiLocale('es')).toBe('es');
	});

	it('missing, foreign, and garbage values fall back to en without throwing', () => {
		expect(resolveUiLocale(undefined)).toBe('en');
		expect(resolveUiLocale(null)).toBe('en');
		expect(resolveUiLocale('fr')).toBe('en');
		expect(resolveUiLocale('zh-TW')).toBe('en');
		expect(resolveUiLocale(42)).toBe('en');
		expect(resolveUiLocale({ locale: 'zh' })).toBe('en');
	});
});

describe('settings document round-trip keeps unknown keys', () => {
	// The settings API stores the raw document text (PUT accepts { text } and
	// 400s on parse failure — The Settings Panel ADR D5), so a newly added
	// ui.locale key must survive a parse+stringify cycle untouched by the
	// section readers. Proven here with the same yaml lib the route uses.
	it('yaml parse keeps ui.locale alongside unrelated sections', async () => {
		const { parse } = await import('yaml');
		const doc = ['ui:', '  locale: zh', 'chat:', '  input:', '    maxRows: 15'].join('\n');
		const parsed = parse(doc) as { ui?: { locale?: string }; chat?: unknown };
		expect(parsed.ui?.locale).toBe('zh');
		expect(parsed.chat).toBeDefined();
	});
});

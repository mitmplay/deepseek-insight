/**
 * Locale resolver — Three Tongues W1 task 1.3-T.
 * One test per row of the ADR state-homes table (authority top-down),
 * plus the edge cases the ADR names. Node env via environmentMatchGlobs.
 */
import { describe, it, expect } from 'vitest';
import { resolveLocale, localeFromAcceptLanguage } from '$lib/server/locale';

describe('resolveLocale — ADR state-homes table, one case per row', () => {
	it('cookie wins over settings.yaml and header', () => {
		expect(resolveLocale({ cookieLocale: 'id', yamlLocale: 'zh', acceptLanguage: 'en' })).toBe('id');
	});

	it('settings.yaml wins over header when no cookie', () => {
		expect(resolveLocale({ yamlLocale: 'zh', acceptLanguage: 'id' })).toBe('zh');
	});

	it('Accept-Language hint wins when neither home spoke', () => {
		expect(resolveLocale({ acceptLanguage: 'id-ID,id;q=0.9' })).toBe('id');
	});

	it('en is the last resort — no input at all', () => {
		expect(resolveLocale({})).toBe('en');
	});
});

describe('edge cases the ADR names', () => {
	it('cookie with a locale no longer in the fleet falls through to the lower homes', () => {
		// A stale cookie (fleet shrank under it) is not an explicit choice —
		// the resolver treats an invalid value at ANY layer as silence and
		// continues down the order; en remains the last resort.
		expect(resolveLocale({ cookieLocale: 'xx', yamlLocale: 'zh' })).toBe('zh');
		expect(resolveLocale({ cookieLocale: 'xx' })).toBe('en');
	});

	it('invalid yaml locale defers to the header hint', () => {
		expect(resolveLocale({ yamlLocale: 'fr', acceptLanguage: 'zh' })).toBe('zh');
	});

	it('multi-tag Accept-Language matches primary subtags, q-weights ignored', () => {
		expect(localeFromAcceptLanguage('id-ID,id;q=0.9,en;q=0.5')).toBe('id');
		expect(localeFromAcceptLanguage('fr-FR,de;q=0.7')).toBeNull();
		expect(localeFromAcceptLanguage(undefined)).toBeNull();
		expect(localeFromAcceptLanguage('')).toBeNull();
	});

	it('case-insensitive tags', () => {
		expect(localeFromAcceptLanguage('ZH-cn')).toBe('zh');
	});
});

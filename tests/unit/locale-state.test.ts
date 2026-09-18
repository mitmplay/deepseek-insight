
/**
 * Locale state service — Three Tongues W2 task 2.1-T.
 * Node env: the service needs document.cookie + localStorage (client
 * persistence arms) but happy-dom's cookie header stripping only affects
 * Request/Headers objects — document.cookie works. Node env keeps the
 * runtime's undici-based Request out of the way; happy-dom globals provide
 * document/localStorage. Actually run under happy-dom by removing the
 * docblock? No — service calls runtime code compiled for both; we need
 * document + localStorage, which happy-dom provides. Kept on happy-dom
 * deliberately (see probe note in hooks-locale test).
 */
import { describe, it, expect } from 'vitest';
import { currentLocale, setLocale, localeState } from '$lib/services/locale/locale-state.svelte';
import { localStorageKey } from '$lib/paraglide/runtime';

describe('locale-state service (2.1)', () => {
	it('starts at the runtime-resolved locale, a fleet member', () => {
		expect(['en', 'zh', 'id']).toContain(currentLocale());
	});

	it('setLocale(id) persists the dsi.locale cookie and the localStorage mirror', async () => {
		await setLocale('id');
		expect(document.cookie).toContain('dsi.locale=id');
		expect(localStorage.getItem('dsi.locale')).toBe('id');
		expect(currentLocale()).toBe('id');
	});

	it('setLocale(zh) flips the rune state so mounts re-render', async () => {
		await setLocale('zh');
		expect(localeState().locale).toBe('zh');
	});

	it('invalid locale is a silent no-op (D3 gate)', async () => {
		const before = localeState().locale;
		// @ts-expect-error — deliberately out-of-fleet
		await setLocale('fr');
		// @ts-expect-error — deliberately out-of-fleet
		await setLocale(undefined);
		expect(localeState().locale).toBe(before);
	});
});

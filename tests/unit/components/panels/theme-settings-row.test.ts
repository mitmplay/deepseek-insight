import { readFileSync } from 'node:fs';
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ThemeSettingsRow from '$lib/components/panels/ThemeSettingsRow.svelte';
import { THEME_BASE_KEY, themePrefs } from '$lib/utils/theme-prefs.svelte';

// Wave 3 task 3.1-T (ADR-0023, The Three-State Lamp): the settings row is
// a thin shell over theme-prefs — renders the three states, writes through
// the store, and reflects external store changes.

function render() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ThemeSettingsRow, { target });
	return { target, instance };
}

function cleanup(instance: unknown, target: HTMLElement) {
	try {
		unmount(instance as never);
	} catch {
		/* already unmounted */
	}
	target.remove();
}

afterEach(() => {
	localStorage.clear();
	delete document.documentElement.dataset.theme;
});

describe('ThemeSettingsRow (3.1)', () => {
	it('renders exactly the three states', () => {
		const h = render();
		const select = h.target.querySelector('[data-testid="theme-select"]') as HTMLSelectElement;
		expect(select).not.toBeNull();
		expect(Array.from(select.options).map((o) => o.value)).toEqual(['system', 'light', 'dark']);
		cleanup(h.instance, h.target);
	});

	it('selection writes through theme-prefs: storage + attribute flip', () => {
		const h = render();
		const select = h.target.querySelector('[data-testid="theme-select"]') as HTMLSelectElement;
		select.value = 'dark';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();
		expect(localStorage.getItem(THEME_BASE_KEY)).toBe('dark');
		expect(themePrefs.choice).toBe('dark');
		expect(themePrefs.resolved).toBe('dark');
		expect(document.documentElement.dataset.theme).toBe('dark');
		cleanup(h.instance, h.target);
	});

	it('reflects an external store change (the row is a shell, not the owner)', () => {
		const h = render();
		themePrefs.set('light');
		flushSync();
		const select = h.target.querySelector('[data-testid="theme-select"]') as HTMLSelectElement;
		expect(select.value).toBe('light');
		cleanup(h.instance, h.target);
	});

	it('sits BEFORE the LanguageMenu row on the settings floor (operator decision 2026-10-10)', () => {
		const panel = readFileSync('src/lib/components/panels/SettingsEditorPanel.svelte', 'utf8');
		const theme = panel.indexOf('<ThemeSettingsRow />');
		const locale = panel.indexOf('<LocaleSettingsRow />');
		expect(theme).toBeGreaterThan(-1);
		expect(locale).toBeGreaterThan(theme);
	});
});

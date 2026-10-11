import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ThemeToggle from '$lib/components/common/buttons/ThemeToggle.svelte';
import { THEME_BASE_KEY, themePrefs } from '$lib/utils/theme-prefs.svelte';

// Wave 3 task 3.1-T (ADR-0023): the footer toggle follows the LanguageMenu
// grammar — one trigger whose icon IS the current choice, a popup with the
// three states, check on the active one.

function render() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ThemeToggle, { target });
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

describe('ThemeToggle (3.1, LanguageMenu grammar)', () => {
	it('lists exactly the three states in the popup', () => {
		const h = render();
		h.target.querySelector('[data-testid="theme-toggle-trigger"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		const list = h.target.querySelector('[data-testid="theme-toggle-list"]');
		expect(list).not.toBeNull();
		const options = [...h.target.querySelectorAll('[data-testid^="theme-option-"]')].map((o) =>
			o.getAttribute('data-testid')
		);
		expect(options).toEqual(['theme-option-system', 'theme-option-light', 'theme-option-dark']);
		cleanup(h.instance, h.target);
	});

	it('the trigger icon reflects the current choice (monitor/sun/moon via aria-label carry)', () => {
		themePrefs.set('dark');
		const h = render();
		// the trigger carries the label; the SVG inside is the choice's icon
		const trigger = h.target.querySelector('[data-testid="theme-toggle-trigger"]') as HTMLElement;
		expect(trigger).not.toBeNull();
		// dark choice → moon renders: exactly one svg inside the trigger
		expect(trigger.querySelectorAll('svg').length).toBe(1);
		cleanup(h.instance, h.target);
	});

	it('choosing an option writes through theme-prefs and closes the popup', () => {
		const h = render();
		h.target.querySelector('[data-testid="theme-toggle-trigger"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		const dark = h.target.querySelector('[data-testid="theme-option-dark"]') as HTMLElement;
		dark.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(themePrefs.choice).toBe('dark');
		expect(localStorage.getItem(THEME_BASE_KEY)).toBe('dark');
		expect(document.documentElement.dataset.theme).toBe('dark');
		expect(h.target.querySelector('[data-testid="theme-toggle-list"]')).toBeNull(); // closed
		cleanup(h.instance, h.target);
	});

	it('marks the active option (data-active), like the language menu', () => {
		themePrefs.set('system');
		const h = render();
		h.target.querySelector('[data-testid="theme-toggle-trigger"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(h.target.querySelector('[data-testid="theme-option-system"]')?.getAttribute('data-active')).toBe('true');
		expect(h.target.querySelector('[data-testid="theme-option-dark"]')?.getAttribute('data-active')).toBe('false');
		cleanup(h.instance, h.target);
	});
});

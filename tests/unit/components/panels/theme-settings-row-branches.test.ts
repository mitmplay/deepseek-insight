import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ThemeSettingsRow from '$lib/components/panels/ThemeSettingsRow.svelte';
import { themePrefs } from '$lib/utils/theme-prefs.svelte';

/**
 * ThemeSettingsRow branch mop — the onchange whitelist arms: system,
 * light, and the junk fall-through (an out-of-band value never reaches
 * the store).
 */

function render() {
	const target = document.createElement("div");
	document.body.appendChild(target);
	const instance = mount(ThemeSettingsRow, { target });
	return { target, instance };
}

const change = (select: HTMLSelectElement, value: string) => {
	select.value = value;
	select.dispatchEvent(new Event("change", { bubbles: true }));
	flushSync();
};

afterEach(() => {
	localStorage.clear();
	delete document.documentElement.dataset.theme;
});

describe("ThemeSettingsRow — onchange whitelist arms", () => {
	it("system writes through the store", () => {
		themePrefs.set("dark");
		const h = render();
		change(h.target.querySelector("[data-testid=\"theme-select\"]") as HTMLSelectElement, "system");
		expect(themePrefs.choice).toBe("system");
		expect(themePrefs.resolved).toBe("light");
		unmount(h.instance);
		h.target.remove();
	});

	it("light writes through the store", () => {
		const h = render();
		change(h.target.querySelector("[data-testid=\"theme-select\"]") as HTMLSelectElement, "light");
		expect(themePrefs.choice).toBe("light");
		expect(localStorage.getItem("dsi-theme")).toBe("light");
		unmount(h.instance);
		h.target.remove();
	});

	it("a junk value never reaches the store", () => {
		themePrefs.set("dark");
		const h = render();
		change(h.target.querySelector("[data-testid=\"theme-select\"]") as HTMLSelectElement, "bogus");
		expect(themePrefs.choice).toBe("dark");
		expect(themePrefs.resolved).toBe("dark");
		unmount(h.instance);
		h.target.remove();
	});
});
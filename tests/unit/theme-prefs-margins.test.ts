import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_BASE_KEY, themePrefs } from '$lib/utils/theme-prefs.svelte';

/**
 * theme-prefs branch mop — the SSR arms (typeof window/document/localStorage/
 * location guards), the blocked-storage catch arms, and the matchMedia
 * optionality arms the happy-dom boot suite never enters.
 */

const restore = () => {
	vi.unstubAllGlobals();
	delete document.documentElement.dataset.theme;
	localStorage.clear();
	window.history.replaceState(null, "", "/");
};
afterEach(restore);

describe("theme-prefs — SSR / degenerate-environment arms", () => {
	it("adopt without localStorage falls back to system", () => {
		vi.stubGlobal("localStorage", undefined);
		themePrefs.adopt();
		expect(themePrefs.choice).toBe("system");
	});

	it("set without localStorage skips persistence but still paints", () => {
		vi.stubGlobal("localStorage", undefined);
		themePrefs.set("dark");
		expect(themePrefs.resolved).toBe("dark");
		expect(document.documentElement.dataset.theme).toBe("dark");
	});

	it("a blocked store (throwing setItem) still flips the attribute", () => {
		vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw new Error("blocked"); } });
		themePrefs.set("dark");
		expect(document.documentElement.dataset.theme).toBe("dark");
	});

	it("a throwing getItem reads as system (defensive read)", () => {
		vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => {} });
		themePrefs.adopt();
		expect(themePrefs.choice).toBe("system");
	});

	it("osPrefersDark without window resolves light; listen() is a no-op", () => {
		themePrefs.set("light");
		vi.stubGlobal("window", undefined);
		themePrefs.set("system");
		expect(themePrefs.resolved).toBe("light");
		expect(() => themePrefs.listen()).not.toThrow();
	});

	it("listen() without matchMedia returns early; a repeat call stays one listener", () => {
		const real = window.matchMedia;
		window.matchMedia = undefined as unknown as typeof window.matchMedia;
		expect(() => themePrefs.listen()).not.toThrow();
		window.matchMedia = real;
		themePrefs.listen();
		themePrefs.listen(); // same mq object — the guard arm
		themePrefs.set("system");
		expect(themePrefs.resolved).toBe("light");
	});

	it("currentProfile without location uses the base key", () => {
		themePrefs.set("dark"); // sanity before the stub
		vi.stubGlobal("location", undefined);
		localStorage.setItem(THEME_BASE_KEY, "light");
		themePrefs.adopt();
		expect(themePrefs.choice).toBe("light");
	});

	it("adopt without document re-derives and skips the paint", () => {
		themePrefs.set("light");
		vi.stubGlobal("document", undefined);
		localStorage.setItem(THEME_BASE_KEY, "dark");
		themePrefs.adopt();
		expect(themePrefs.resolved).toBe("dark");
		expect(() => themePrefs.listen()).not.toThrow();
	});
});
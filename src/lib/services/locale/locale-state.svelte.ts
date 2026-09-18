/**
 * Locale state service — Three Tongues W2 task 2.1 (ADR 2026-09-12 D2/D3).
 *
 * THE one client-side seat for "what language are we in": BOTH mounts
 * (header menu, settings row) consume this — neither duplicates
 * resolution or persistence logic. The paraglide runtime does the actual
 * persistence (cookie dsi.locale per strategy + localStorage mirror);
 * this service validates the fleet, forces the no-reload contract (D2 —
 * a reload would tear down the live DSH stream), and exposes a rune
 * so any mount re-renders when the language changes.
 *
 * Communication pattern: shared rune state (Module Communication Map,
 * PRD §3). Modules observe via currentLocale()/subscribe surface, never
 * via the cookie or the runtime directly.
 */

import { setLocale as paraglideSetLocale, getLocale } from '$lib/paraglide/runtime';
import { UI_LOCALES, DEFAULT_UI_LOCALE, type UiLocale } from '$lib/config';

const state = $state({ locale: DEFAULT_UI_LOCALE as UiLocale });

/** The active locale. The RUNTIME's strategy chain (cookie → localStorage
 *  → baseLocale, SSR-aware via AsyncLocalStorage) is the source of truth —
 *  a fresh page load must reflect the cookie, not our en-initialized state
 *  (reload bug found by the AC3 e2e, 2026-09-12). The state read stays in
 *  the tracked path so setLocale's write still re-renders mounts. */
export function currentLocale(): UiLocale {
	const tracked = ($state.snapshot(state) as { locale: UiLocale }).locale;
	try {
		const runtime = getLocale() as unknown;
		if (UI_LOCALES.includes(runtime as UiLocale)) return runtime as UiLocale;
	} catch {
		// runtime not ready (no locale set yet) — fall through to state
	}
	return UI_LOCALES.includes(tracked) ? tracked : DEFAULT_UI_LOCALE;
}

/** Switch language. No navigation (D2) — the paraglide runtime writes
 *  the dsi.locale cookie and the localStorage mirror; runes reactivity
 *  re-renders every mounted label. SSR callers are silently ignored
 *  (the runtime's cookie/localStorage arms skip on the server anyway). */
export async function setLocale(next: UiLocale): Promise<void> {
	if (!UI_LOCALES.includes(next)) return; // invalid → silent no-op (D3 gate)
	await paraglideSetLocale(next, { reload: false });
	// The compiled strategy set has no localStorage arm, so the mirror is
	// ours: a second persistence home for the device's choice (spec 2.1).
	try {
		localStorage.setItem('dsi.locale', next);
	} catch {
		// storage may be unavailable (private mode) — the cookie still holds
	}
	state.locale = next;
}

/** Reactive read for mounts — a function call keeps the rune tracking
 *  alive in the component's effect scope. */
export function localeState(): { locale: UiLocale } {
	return state;
}

/**
 * The translation seat: `t(m.key)` in a template. THE instant-switch
 * mechanism (bug-fix 2026-09-12 — "re-renders instantly" was a lie: a
 * bare `m.key()` reads no reactive state, so Svelte never re-ran it and
 * labels only changed after a reload).
 *
 * - reads `state.locale` FIRST, so the calling template registers a
 *   reactive dependency and re-runs on every setLocale;
 * - then calls the message fn, which resolves the (already switched)
 *   runtime locale — cookie/localStorage on the client, request-scoped
 *   AsyncLocalStorage during SSR.
 */
export function t(fn: () => string): string {
	void $state.snapshot(state).locale; // reactive dependency — do not remove
	try {
		const runtime = getLocale() as unknown;
		if (UI_LOCALES.includes(runtime as UiLocale)) return fn();
	} catch {
		// runtime not ready — fall through, fn resolves via its own default
	}
	return fn();
}

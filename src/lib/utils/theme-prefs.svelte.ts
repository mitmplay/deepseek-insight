// The Three-State Lamp — the switch module (ADR-0023 D2, 2026-10-11).
// Owns the operator's three-state choice (system / light / dark), persists
// it under localStorage['dsi-theme'], resolves it against the OS, and sets
// the html[data-theme] attribute — the single hinge the token layer reads.
// The ONLY other place that derives the storage key is the inline pre-paint
// script in app.html (D3) — it mirrors this derivation inline (it cannot
// import modules); the twin pin lives in tests/unit/theme-prefs.test.ts.
// Key grammar: storage-profile.ts — EVERY dsi-* key is profile-scoped, so
// each desk remembers its own lamp.

import { dsiKey, sanitizeWorkspaceProfile } from './storage-profile';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_BASE_KEY = 'dsi-theme';

/** The active workspace profile — the sticky ?profile= param, sanitized
 * once here (mirror of the pre-paint derivation in app.html). */
const currentProfile = (): string | null =>
	typeof location === 'undefined'
		? null
		: sanitizeWorkspaceProfile(new URLSearchParams(location.search).get('profile') ?? '');

/** The storage key for the active desk: dsi-theme, or dsi-theme_<profile>. */
const storageKey = (): string => dsiKey(THEME_BASE_KEY, currentProfile());

const osPrefersDark = (): boolean =>
	typeof window !== 'undefined' &&
	!!window.matchMedia?.('(prefers-color-scheme: dark)').matches;

/** Defensive read — the panel-prefs grammar (SSR-safe, junk -> system). */
const readStoredChoice = (): ThemeChoice => {
	if (typeof localStorage === 'undefined') return 'system';
	try {
		const raw = localStorage.getItem(storageKey());
		return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
	} catch {
		return 'system';
	}
};

const resolve = (choice: ThemeChoice): ResolvedTheme =>
	choice === 'system' ? (osPrefersDark() ? 'dark' : 'light') : choice;

function createThemePrefs() {
	let choice = $state<ThemeChoice>('system');
	let resolved = $state<ResolvedTheme>('light');
	let listeningMq: MediaQueryList | null = null;

	const apply = () => {
		if (typeof document !== 'undefined') document.documentElement.dataset.theme = resolved;
	};
	const persist = () => {
		if (typeof localStorage === 'undefined') return;
		try {
			localStorage.setItem(storageKey(), choice);
		} catch {
			/* blocked storage — the attribute still flips for this session */
		}
	};

	return {
		get choice(): ThemeChoice {
			return choice;
		},
		get resolved(): ResolvedTheme {
			return resolved;
		},
		/** Mount-time adoption: the pre-paint script (D3) already resolved and
		 * set the attribute before the bundle ran — we ADOPT it (flash-free),
		 * re-deriving the choice from storage. We only paint ourselves when
		 * the attribute was somehow missing. */
		adopt() {
			choice = readStoredChoice();
			const attr = typeof document !== 'undefined' ? document.documentElement.dataset.theme : undefined;
			if (attr === 'dark' || attr === 'light') {
				resolved = attr;
			} else {
				resolved = resolve(choice);
				apply();
			}
			this.listen();
		},
		/** The operator picked a state. Persist the CHOICE (never the resolved
		 * value — system must keep following the OS), then paint. */
		set(next: ThemeChoice) {
			choice = next;
			resolved = resolve(next);
			persist();
			apply();
		},
		/** Live OS following, only while the choice is system (D2). */
		listen() {
			if (typeof window === 'undefined' || !window.matchMedia) return;
			const mq = window.matchMedia('(prefers-color-scheme: dark)');
			if (listeningMq === mq) return; // one listener per media-query object
			listeningMq = mq;
			mq.addEventListener('change', (e) => {
					if (choice !== 'system') return; // pinned ignores the OS
					resolved = e.matches ? 'dark' : 'light';
					apply();
				});
		}
	};
}

export const themePrefs = createThemePrefs();

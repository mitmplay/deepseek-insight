/**
 * Unit: sidebar-prefs — the persisted layout state for the conversation
 * page's app sidebar (OCI ControlRail port, 2026-08-23).
 *
 * Behavior under test: defaults when nothing is stored, round-trip,
 * width sanitizing (bounds + junk), junk-JSON fallback, and best-effort
 * writes. happy-dom provides localStorage.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
	SIDEBAR_DEFAULT_WIDTH,
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_MIN_WIDTH,
	clampSidebarWidth,
	defaultSidebarPrefs,
	loadSidebarPrefs,
	saveSidebarPrefs
} from '$lib/utils/sidebar-prefs';

describe('sidebar-prefs', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('returns defaults when nothing is stored', () => {
		expect(loadSidebarPrefs()).toEqual({ collapsed: false, width: SIDEBAR_DEFAULT_WIDTH });
	});

	it('round-trips a saved pair', () => {
		saveSidebarPrefs({ collapsed: true, width: 350 });
		expect(loadSidebarPrefs()).toEqual({ collapsed: true, width: 350 });
	});

	it('falls back to defaults on junk JSON', () => {
		localStorage.setItem('dsi-sidebar', '{not json');
		expect(loadSidebarPrefs()).toEqual(defaultSidebarPrefs());
	});

	it('falls back to defaults on non-object JSON', () => {
		localStorage.setItem('dsi-sidebar', 'true');
		expect(loadSidebarPrefs()).toEqual(defaultSidebarPrefs());
	});

	it('clamps a stored width above the max', () => {
		localStorage.setItem('dsi-sidebar', JSON.stringify({ collapsed: false, width: 9999 }));
		expect(loadSidebarPrefs().width).toBe(SIDEBAR_MAX_WIDTH);
	});

	it('clamps a stored width below the min', () => {
		localStorage.setItem('dsi-sidebar', JSON.stringify({ collapsed: false, width: 1 }));
		expect(loadSidebarPrefs().width).toBe(SIDEBAR_MIN_WIDTH);
	});

	it('falls back to the default width on a non-finite stored width', () => {
		localStorage.setItem(
			'dsi-sidebar',
			JSON.stringify({ collapsed: false, width: 'not-a-number' })
		);
		expect(loadSidebarPrefs()).toEqual({ collapsed: false, width: SIDEBAR_DEFAULT_WIDTH });
	});

	it('treats a non-true collapsed as expanded', () => {
		localStorage.setItem('dsi-sidebar', JSON.stringify({ collapsed: 'yes', width: 300 }));
		expect(loadSidebarPrefs().collapsed).toBe(false);
	});

	it('clampSidebarWidth bounds both ends', () => {
		expect(clampSidebarWidth(0)).toBe(SIDEBAR_MIN_WIDTH);
		expect(clampSidebarWidth(10000)).toBe(SIDEBAR_MAX_WIDTH);
		expect(clampSidebarWidth(320)).toBe(320);
	});

	it('save is best-effort — a throwing store does not propagate', () => {
		const setter = localStorage.setItem;
		localStorage.setItem = () => {
			throw new Error('store full');
		};
		try {
			expect(() => saveSidebarPrefs({ collapsed: false, width: 300 })).not.toThrow();
		} finally {
			localStorage.setItem = setter;
		}
	});
});

describe('sidebar-prefs — workspace profiles (dsi-sidebar_<profile>)', () => {
	it('save/load under a profile touch ONLY dsi-sidebar_widi — desks isolated', () => {
		localStorage.clear();
		saveSidebarPrefs({ collapsed: true, width: 340 }, 'widi');
		expect(localStorage.getItem('dsi-sidebar_widi')).toContain('"collapsed":true');
		expect(localStorage.getItem('dsi-sidebar')).toBeNull(); // default desk untouched

		// Different content under the default key; each desk reads its own.
		saveSidebarPrefs({ collapsed: false, width: 280 });
		expect(loadSidebarPrefs('widi')).toEqual({ collapsed: true, width: 340 });
		expect(loadSidebarPrefs()).toEqual({ collapsed: false, width: 280 }); // the stored default-desk blob
	});

	it('a junk profile blob falls back to defaults without touching the default desk', () => {
		localStorage.clear();
		localStorage.setItem('dsi-sidebar_widi', '"junk"');
		saveSidebarPrefs({ collapsed: false, width: 280 });
		expect(loadSidebarPrefs('widi')).toEqual({ collapsed: false, width: SIDEBAR_DEFAULT_WIDTH });
		expect(loadSidebarPrefs()).toEqual({ collapsed: false, width: 280 }); // not the junk
	});
});

/**
 * Unit: spine-group-prefs — the persisted spine group state (collapse +
 * session-name filter + sub-agent toggle), 2026-09-01.
 *
 * Behavior under test: defaults on absent storage, full round-trip,
 * per-field junk fallback, SSR safety, profile-key isolation, and
 * best-effort writes. happy-dom provides localStorage.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultSpineGroupPrefs, loadSpineGroupPrefs, saveSpineGroupPrefs } from '$lib/utils/spine-group-prefs';

describe('spine-group-prefs', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('returns defaults when nothing is stored (expanded, unfiltered, sub-agents visible)', () => {
		expect(loadSpineGroupPrefs()).toEqual(defaultSpineGroupPrefs());
	});

	it('round-trips the full state', () => {
		const prefs = { collapsed: true, nameFilter: 'refactor', subagentsHidden: true, dateFilter: '2026-09-04' };
		saveSpineGroupPrefs(prefs);
		expect(loadSpineGroupPrefs()).toEqual(prefs);
	});

	it('an empty-string nameFilter round-trips as unfiltered', () => {
		saveSpineGroupPrefs({ collapsed: false, nameFilter: '', subagentsHidden: false, dateFilter: '' });
		expect(loadSpineGroupPrefs()).toEqual(defaultSpineGroupPrefs());
	});

	it('the dateFilter round-trips and falls back per field on junk', () => {
		saveSpineGroupPrefs({ collapsed: false, nameFilter: '', subagentsHidden: false, dateFilter: '2026-09-01' });
		expect(loadSpineGroupPrefs().dateFilter).toBe('2026-09-01');
		localStorage.setItem('dsi-spine-group', JSON.stringify({ collapsed: false, nameFilter: '', subagentsHidden: false, dateFilter: 42 }));
		expect(loadSpineGroupPrefs().dateFilter).toBe('');
	});

	it('falls back to defaults on junk JSON', () => {
		localStorage.setItem('dsi-spine-group', '{not json');
		expect(loadSpineGroupPrefs()).toEqual(defaultSpineGroupPrefs());
	});

	it('falls back to defaults on non-object JSON', () => {
		localStorage.setItem('dsi-spine-group', JSON.stringify(true));
		expect(loadSpineGroupPrefs()).toEqual(defaultSpineGroupPrefs());
	});

	it('falls back PER FIELD on wrong-shaped values', () => {
		// collapsed/subagentsHidden are true only on an explicit `true`;
		// nameFilter/dateFilter only on a string — anything else is that
		// field's default.
		localStorage.setItem(
			'dsi-spine-group',
			JSON.stringify({ collapsed: 'yes', nameFilter: 42, subagentsHidden: false, dateFilter: 7, extra: 1 })
		);
		expect(loadSpineGroupPrefs()).toEqual({ collapsed: false, nameFilter: '', subagentsHidden: false, dateFilter: '' });
	});

	it('save is best-effort — a throwing store does not propagate', () => {
		const setter = localStorage.setItem;
		localStorage.setItem = () => {
			throw new Error('store full');
		};
		try {
			expect(() => saveSpineGroupPrefs(defaultSpineGroupPrefs())).not.toThrow();
		} finally {
			localStorage.setItem = setter;
		}
	});
});

describe('spine-group-prefs — workspace profiles (dsi-spine-group_<profile>)', () => {
	it('save/load under a profile touch ONLY the profile key — desks isolated', () => {
		localStorage.clear();
		saveSpineGroupPrefs({ collapsed: true, nameFilter: 'widi filter', subagentsHidden: true, dateFilter: '' }, 'widi');
		expect(localStorage.getItem('dsi-spine-group_widi')).toContain('widi filter');
		expect(localStorage.getItem('dsi-spine-group')).toBeNull();

		saveSpineGroupPrefs({ collapsed: false, nameFilter: 'default filter', subagentsHidden: false, dateFilter: '' });
		const widi = loadSpineGroupPrefs('widi');
		const def = loadSpineGroupPrefs();
		expect(widi.nameFilter).toBe('widi filter');
		expect(def.nameFilter).toBe('default filter');
	});
});

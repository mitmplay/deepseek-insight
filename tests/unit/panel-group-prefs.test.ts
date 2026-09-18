/**
 * panel-group-prefs — the persisted sidebar panel-group state
 * (SidebarOpenPanels, 2026-08-26; fold field 2026-09-03, ADR The Tree
 * That Remembers).
 *
 * Pins the round-trip contract shared with sidebar-prefs/spine-group-prefs:
 * expanded-by-default, ONLY an explicit `true` collapses (junk stays
 * expanded — the default wins), absent/SSR/junk payloads fall
 * back to the default, profile keys stay isolated per workspace desk, and
 * writes are best-effort (a throwing store loses persistence, never the
 * layout). The fold field validates PER FIELD (spine grammar): only an
 * array of non-empty strings survives — deduped — everything else is `[]`,
 * and a stored blob without the field (the pre-2026-09-03 format) loads
 * `[]` too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	defaultPanelGroupPrefs,
	loadPanelGroupPrefs,
	savePanelGroupPrefs
} from '$lib/utils/panel-group-prefs';

beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('panel-group-prefs — load fallbacks', () => {
	it('defaults to EXPANDED with every family folded when nothing is stored', () => {
		expect(loadPanelGroupPrefs()).toEqual(defaultPanelGroupPrefs());
		expect(loadPanelGroupPrefs()).toEqual({ collapsed: false, unfoldedSessionIds: [] });
	});

	it('falls back to the default when localStorage is absent entirely (SSR)', () => {
		vi.stubGlobal('localStorage', undefined);
		expect(loadPanelGroupPrefs()).toEqual({ collapsed: false, unfoldedSessionIds: [] });
		expect(() => savePanelGroupPrefs({ collapsed: false, unfoldedSessionIds: [] })).not.toThrow();
	});

	it('falls back to the default on junk JSON (parse throws)', () => {
		localStorage.setItem('dsi-panel-group', '{not json');
		expect(loadPanelGroupPrefs()).toEqual({ collapsed: false, unfoldedSessionIds: [] });
	});

	it('falls back to the default on a JSON null payload', () => {
		localStorage.setItem('dsi-panel-group', 'null');
		expect(loadPanelGroupPrefs()).toEqual({ collapsed: false, unfoldedSessionIds: [] });
	});

	it('falls back to the default on a non-object payload', () => {
		for (const junk of ['42', '"expanded"', 'true']) {
			localStorage.setItem('dsi-panel-group', junk);
			expect(loadPanelGroupPrefs()).toEqual({ collapsed: false, unfoldedSessionIds: [] });
		}
	});

	it('an empty stored value reads as absent (the default)', () => {
		localStorage.setItem('dsi-panel-group', '');
		expect(loadPanelGroupPrefs()).toEqual({ collapsed: false, unfoldedSessionIds: [] });
	});
});

describe('panel-group-prefs — collapsed is false unless explicitly true', () => {
	it('an explicit true collapses the group', () => {
		savePanelGroupPrefs({ collapsed: true, unfoldedSessionIds: [] });
		expect(loadPanelGroupPrefs().collapsed).toBe(true);
	});

	it('junk collapsed values stay expanded (the default wins)', () => {
		for (const collapsed of ['no', 0, null, undefined]) {
			localStorage.setItem('dsi-panel-group', JSON.stringify({ collapsed }));
			expect(loadPanelGroupPrefs().collapsed).toBe(false);
		}
		localStorage.setItem('dsi-panel-group', JSON.stringify({}));
		expect(loadPanelGroupPrefs().collapsed).toBe(false);
	});
});

// Fold field (2026-09-03, ADR The Tree That Remembers D3): per-field junk
// fallback on the SAME blob — a junk fold list never costs the collapse
// choice, and vice versa.
describe('panel-group-prefs — unfoldedSessionIds (fold map)', () => {
	it('round-trips: save → load → the same ids in order', () => {
		const ids = ['s-zeta', 's-alpha', 's-main'];
		savePanelGroupPrefs({ collapsed: false, unfoldedSessionIds: ids }, 'widi');
		expect(loadPanelGroupPrefs('widi').unfoldedSessionIds).toEqual(ids);
	});

	it('an absent field loads [] — the pre-2026-09-03 blob format IS valid', () => {
		localStorage.setItem('dsi-panel-group', JSON.stringify({ collapsed: false }));
		expect(loadPanelGroupPrefs()).toEqual({ collapsed: false, unfoldedSessionIds: [] });
	});

	it('a non-array fold field falls back to [] per field', () => {
		for (const junk of ['s-one', 42, true, null, { 0: 's-one' }]) {
			localStorage.setItem(
				'dsi-panel-group',
				JSON.stringify({ collapsed: false, unfoldedSessionIds: junk })
			);
			const prefs = loadPanelGroupPrefs();
			expect(prefs.unfoldedSessionIds).toEqual([]);
			expect(prefs.collapsed).toBe(false); // the sibling field survives junk
		}
	});

	it('non-string and empty-string members drop; surviving members keep order', () => {
		localStorage.setItem(
			'dsi-panel-group',
			JSON.stringify({ unfoldedSessionIds: ['s-keep', 7, '', null, 's-also', 'x'] })
		);
		expect(loadPanelGroupPrefs().unfoldedSessionIds).toEqual(['s-keep', 's-also', 'x']);
	});

	it('duplicate ids dedupe (first occurrence wins its position)', () => {
		localStorage.setItem(
			'dsi-panel-group',
			JSON.stringify({ unfoldedSessionIds: ['s-a', 's-b', 's-a'] })
		);
		expect(loadPanelGroupPrefs().unfoldedSessionIds).toEqual(['s-a', 's-b']);
	});
});

describe('panel-group-prefs — save + workspace desks', () => {
	it('round-trips under the default desk key', () => {
		savePanelGroupPrefs({ collapsed: false, unfoldedSessionIds: [] });
		expect(JSON.parse(localStorage.getItem('dsi-panel-group') ?? '')).toEqual({
			collapsed: false,
			unfoldedSessionIds: []
		});
		expect(loadPanelGroupPrefs()).toEqual({ collapsed: false, unfoldedSessionIds: [] });
	});

	it('a profile key touches ONLY that desk — default stays untouched', () => {
		savePanelGroupPrefs({ collapsed: false, unfoldedSessionIds: ['s-one'] }, 'widi');
		expect(localStorage.getItem('dsi-panel-group_widi')).toBe(
			'{"collapsed":false,"unfoldedSessionIds":["s-one"]}'
		);
		expect(localStorage.getItem('dsi-panel-group')).toBeNull();
		expect(loadPanelGroupPrefs('widi').unfoldedSessionIds).toEqual(['s-one']);
		expect(loadPanelGroupPrefs()).toEqual({ collapsed: false, unfoldedSessionIds: [] });
	});

	it('save is best-effort — a throwing store does not propagate', () => {
		const setter = localStorage.setItem;
		localStorage.setItem = () => {
			throw new Error('store full');
		};
		try {
			expect(() => savePanelGroupPrefs({ collapsed: true, unfoldedSessionIds: [] })).not.toThrow();
		} finally {
			localStorage.setItem = setter;
		}
	});
});

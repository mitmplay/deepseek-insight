import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearDraft, loadDraft, saveDraft } from '$lib/utils/draft-prefs';

/**
 * Margin tests for draft-prefs — the guard/error arms the round-trip suite
 * does not need: SSR (no localStorage), junk JSON, malformed payloads,
 * empty-text clears, blocked-store catch arms, and the prune ordering
 * (junk/non-finite ts sort oldest and go first).
 */

const KEY = 'dsi-draft_s1';

describe('draft-prefs — guard and error margins', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		// Restore localStorage in case an SSR-safety test removed it.
		if (typeof localStorage === 'undefined') {
			// happy-dom always provides it; nothing to do.
		}
	});

	it('loadDraft returns null when localStorage is absent (SSR)', () => {
		const store = globalThis.localStorage;
		delete (globalThis as { localStorage?: Storage }).localStorage; // simulate SSR
		try {
			expect(loadDraft('s1')).toBeNull();
			expect(() => saveDraft('s1', 'x', true)).not.toThrow();
			expect(() => clearDraft('s1')).not.toThrow();
		} finally {
			(globalThis as { localStorage?: Storage }).localStorage = store;
		}
	});

	it('loadDraft returns null on junk JSON (the catch arm)', () => {
		localStorage.setItem(KEY, '{not json');
		expect(loadDraft('s1')).toBeNull();
	});

	it('loadDraft returns null for null / non-object payloads', () => {
		localStorage.setItem(KEY, 'null');
		expect(loadDraft('s1')).toBeNull();
		localStorage.setItem(KEY, '42');
		expect(loadDraft('s1')).toBeNull();
		localStorage.setItem(KEY, '"str"');
		expect(loadDraft('s1')).toBeNull();
	});

	it('loadDraft returns null when text is missing, non-string, or empty', () => {
		localStorage.setItem(KEY, JSON.stringify({ focused: true }));
		expect(loadDraft('s1')).toBeNull();
		localStorage.setItem(KEY, JSON.stringify({ text: 5 }));
		expect(loadDraft('s1')).toBeNull();
		localStorage.setItem(KEY, JSON.stringify({ text: '' }));
		expect(loadDraft('s1')).toBeNull();
	});

	it('loadDraft coerces focused strictly (only true restores focused)', () => {
		saveDraft('s1', 'hello', true);
		expect(loadDraft('s1')).toEqual({ text: 'hello', focused: true });
		saveDraft('s1', 'hello', false);
		expect(loadDraft('s1')).toEqual({ text: 'hello', focused: false });
		localStorage.setItem(KEY, JSON.stringify({ text: 'x', focused: 'yes' }));
		expect(loadDraft('s1')).toEqual({ text: 'x', focused: false });
	});

	it('saveDraft with empty text clears instead of storing', () => {
		saveDraft('s1', 'kept', false);
		saveDraft('s1', '', true);
		expect(localStorage.getItem(KEY)).toBeNull();
		expect(loadDraft('s1')).toBeNull();
	});

	it('saveDraft swallows a blocked store (setItem throws)', () => {
		const setItem = localStorage.setItem.bind(localStorage);
		localStorage.setItem = () => {
			throw new Error('QuotaExceededError');
		};
		try {
			expect(() => saveDraft('s1', 'kept', false)).not.toThrow();
		} finally {
			localStorage.setItem = setItem;
		}
	});

	it('clearDraft swallows a blocked store (removeItem throws)', () => {
		saveDraft('s1', 'kept', false);
		const removeItem = localStorage.removeItem.bind(localStorage);
		localStorage.removeItem = () => {
			throw new Error('SecurityError');
		};
		try {
			expect(() => clearDraft('s1')).not.toThrow();
		} finally {
			localStorage.removeItem = removeItem;
		}
	});

	it('prunes to 20 drafts; junk entries sort oldest and go first', () => {
		// Junk (unparseable) and non-finite-ts entries sort ts=0 — pruned first.
		localStorage.setItem('dsi-draft_junk', '{oops');
		localStorage.setItem('dsi-draft_infinite', JSON.stringify({ ts: Infinity }));
		localStorage.setItem('not-a-draft', 'untouched');
		for (let i = 0; i < 22; i++) {
			saveDraft('s' + i, 'text ' + i, false);
		}
		expect(localStorage.getItem('not-a-draft')).toBe('untouched'); // never pruned
		expect(localStorage.getItem('dsi-draft_junk')).toBeNull(); // pruned first
		expect(localStorage.getItem('dsi-draft_infinite')).toBeNull();
		// The just-written session is exempt; same-ms ties make WHICH older
		// drafts survive nondeterministic — only the count is pinned.
		expect(localStorage.getItem('dsi-draft_s21')).not.toBeNull();
		let draftKeys = 0;
		for (let i = 0; i < localStorage.length; i++) {
			if (localStorage.key(i)!.startsWith('dsi-draft_')) draftKeys++;
		}
		expect(draftKeys).toBe(20);
	});
});

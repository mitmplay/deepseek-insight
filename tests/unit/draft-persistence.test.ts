import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DraftPersistence } from '$lib/services/chat/draft-persistence.svelte';

describe('draft-persistence (ADR-0018 W3 task 3.1-T)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		localStorage.clear();
	});
	afterEach(() => {
		vi.useRealTimers();
		localStorage.clear();
	});

	const key = (sid: string) => `dsi-draft_${sid}`;

	it('debounces a typing burst into one save', () => {
		const d = new DraftPersistence(400);
		d.schedule('s1', 'a', () => true);
		d.schedule('s1', 'ab', () => true);
		d.schedule('s1', 'abc', () => true);
		expect(d.pending).toBe(true);
		vi.advanceTimersByTime(400);
		expect(d.pending).toBe(false);
		const raw = localStorage.getItem(key('s1'));
		expect(raw).not.toBeNull();
		expect(JSON.parse(raw!).text).toBe('abc');
	});

	it('an emptied draft clears SYNCHRONOUSLY — never resurrects a submitted prompt', () => {
		localStorage.setItem(key('s1'), JSON.stringify({ text: 'old', updatedAt: 1 }));
		const d = new DraftPersistence(400);
		d.schedule('s1', '', () => true);
		// No timer wait — the clear must not be debounced.
		expect(d.pending).toBe(false);
		expect(localStorage.getItem(key('s1'))).toBeNull();
	});

	it('flush persists the CURRENT value at teardown (HMR-strike tail)', () => {
		const d = new DraftPersistence(400);
		d.schedule('s1', 'typing', () => true);
		d.flush('s1', 'typing tail', true);
		expect(d.pending).toBe(false); // pending timer cancelled
		const raw = localStorage.getItem(key('s1'));
		expect(JSON.parse(raw!).text).toBe('typing tail');
	});

	it('flush with an empty value clears the stored draft', () => {
		localStorage.setItem(key('s1'), JSON.stringify({ text: 'old', updatedAt: 1 }));
		const d = new DraftPersistence(400);
		d.flush('s1', '', true);
		expect(localStorage.getItem(key('s1'))).toBeNull();
	});

	it('the focus flag is read at FIRE time, not schedule time', () => {
		let focused = false;
		const d = new DraftPersistence(400);
		d.schedule('s1', 'mid-window focus', () => focused);
		focused = true; // focus lands inside the debounce window
		vi.advanceTimersByTime(400);
		expect(JSON.parse(localStorage.getItem(key('s1'))!).focused).toBe(true);
	});

	it('cancel drops the pending save without writing', () => {
		const d = new DraftPersistence(400);
		d.schedule('s1', 'keep me out', () => true);
		d.cancel();
		vi.advanceTimersByTime(1000);
		expect(localStorage.getItem(key('s1'))).toBeNull();
	});
});

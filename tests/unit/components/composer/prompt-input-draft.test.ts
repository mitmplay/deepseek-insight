/**
 * Composer × draft persistence (2026-08-30, HMR DX): typing saves to
 * localStorage debounced; an unmount inside the debounce window flushes
 * the tail (the HMR strike case); a mount restores text with the caret
 * at the end; focus follows only a snapshot saved mid-typing; send and
 * any emptied draft clear the stored entry so a sent prompt never
 * resurrects.
 *
 * Harness copied from prompt-input-suggest.test.ts (component-direct
 * mount, fetch stubbed at the global seam, fake timers advance the
 * debounce); the module round-trip tests cover draft-prefs itself.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Composer from '$lib/components/composer/Composer.svelte';
import { clearDraft, loadDraft, saveDraft } from '$lib/utils/draft-prefs';

vi.stubGlobal(
	'fetch',
	vi.fn(async () => new Promise<Response>(() => {}))
);

const SID = '9f0c1a2b-3d4e-4f5a-6b7c-8d9e0a1b2c3d';
const KEY = `dsi-draft_${SID}`;

function mountInput(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(Composer, {
		target,
		props: {
			onsubmit: () => true,
			oncancel: () => {},
			isStreaming: false,
			sending: false,
			sessionId: SID,
			...props
		}
	});
	flushSync();
	const textarea = () =>
		target.querySelector('[data-testid="prompt-textarea"]') as HTMLTextAreaElement;
	const cleanup = () => {
		unmount(comp);
		target.remove();
	};
	return { target, textarea, cleanup };
}

/** Type into the textarea and fire the input event (native-like). */
function type(h: ReturnType<typeof mountInput>, text: string): HTMLTextAreaElement {
	const ta = h.textarea();
	ta.value = text;
	ta.selectionStart = ta.selectionEnd = text.length;
	ta.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
	return ta;
}

beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	// Belt-and-braces (suggest tests): real timers back for the file even
	// when a fake-timer test fails mid-way.
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('draft-prefs — localStorage round-trip', () => {
	it('save → load returns text + focused; clear removes the entry', () => {
		saveDraft(SID, 'hello world', true);
		expect(loadDraft(SID)).toEqual({ text: 'hello world', focused: true });
		clearDraft(SID);
		expect(loadDraft(SID)).toBeNull();
		expect(localStorage.getItem(KEY)).toBeNull();
	});

	it('an empty-text save clears the entry instead of storing it', () => {
		saveDraft(SID, 'x', false);
		saveDraft(SID, '', false);
		expect(loadDraft(SID)).toBeNull();
		expect(localStorage.getItem(KEY)).toBeNull();
	});

	it('junk and empty payloads load as null', () => {
		localStorage.setItem(KEY, '{not json');
		expect(loadDraft(SID)).toBeNull();
		localStorage.setItem(KEY, JSON.stringify({ nope: 1 }));
		expect(loadDraft(SID)).toBeNull();
		localStorage.setItem(KEY, JSON.stringify({ text: '', focused: true }));
		expect(loadDraft(SID)).toBeNull(); // empty text is not a draft
	});

	it('prune keeps only the newest 20 sessions', () => {
		vi.useFakeTimers();
		// Distinct save timestamps — same-ms ties would make the prune order
		// (deliberately) ambiguous, and the assertions need an order.
		for (let i = 0; i < 25; i++) {
			vi.setSystemTime(1_000_000 + i * 1000);
			saveDraft(`sess-${i}`, `draft ${i}`, false);
		}
		expect(loadDraft('sess-24')?.text).toBe('draft 24'); // just written — kept
		expect(loadDraft('sess-5')?.text).toBe('draft 5'); // oldest keeper
		expect(loadDraft('sess-4')).toBeNull(); // pruned
		expect(loadDraft('sess-0')).toBeNull(); // pruned
	});
});

describe('Composer — debounced draft save', () => {
	it('typing saves after the debounce window with the focus flag', async () => {
		vi.useFakeTimers();
		const h = mountInput();
		try {
			const ta = type(h, 'half-typed prompt');
			ta.focus();
			await vi.advanceTimersByTimeAsync(399);
			expect(loadDraft(SID)).toBeNull(); // still inside the window
			await vi.advanceTimersByTimeAsync(1);
			expect(loadDraft(SID)).toEqual({ text: 'half-typed prompt', focused: true });
		} finally {
			h.cleanup();
		}
	});

	it('a typing burst stays debounced — one save, the latest text', async () => {
		vi.useFakeTimers();
		const h = mountInput();
		try {
			type(h, 'a');
			await vi.advanceTimersByTimeAsync(200);
			type(h, 'ab');
			await vi.advanceTimersByTimeAsync(200);
			type(h, 'abc');
			await vi.advanceTimersByTimeAsync(399);
			expect(loadDraft(SID)).toBeNull(); // every keystroke re-armed the window
			await vi.advanceTimersByTimeAsync(1);
			expect(loadDraft(SID)?.text).toBe('abc');
		} finally {
			h.cleanup();
		}
	});
});

describe('Composer — HMR strike (teardown flush + remount restore)', () => {
	it('an unmount inside the debounce window flushes the tail', async () => {
		vi.useFakeTimers();
		const h = mountInput();
		const ta = type(h, 'typed just before the strike');
		ta.focus();
		await vi.advanceTimersByTimeAsync(50); // mid-window — timer never fired
		h.cleanup(); // the HMR strike
		expect(loadDraft(SID)).toEqual({ text: 'typed just before the strike', focused: true });
	});

	it('the next mount restores the text with the caret at the end', async () => {
		vi.useFakeTimers();
		saveDraft(SID, 'restored draft', false);
		const h = mountInput();
		try {
			const ta = h.textarea();
			expect(ta.value).toBe('restored draft');
			await Promise.resolve(); // the restore microtask (caret placement)
			expect(ta.selectionStart).toBe('restored draft'.length);
			expect(ta.selectionEnd).toBe('restored draft'.length);
		} finally {
			h.cleanup();
		}
	});

	it('a focused snapshot takes the caret back; an unfocused one never steals', async () => {
		vi.useFakeTimers();
		saveDraft(SID, 'was typing here', true);
		const h = mountInput();
		try {
			await Promise.resolve();
			expect(document.activeElement).toBe(h.textarea());
		} finally {
			h.cleanup();
		}
		localStorage.clear();
		saveDraft(SID, 'typed earlier, then looked away', false);
		const h2 = mountInput();
		try {
			await Promise.resolve();
			expect(h2.textarea().value).toBe('typed earlier, then looked away');
			expect(document.activeElement).not.toBe(h2.textarea());
		} finally {
			h2.cleanup();
		}
	});
});

describe('Composer — blur flush and clear paths', () => {
	it('blur flushes immediately with focused=false', async () => {
		vi.useFakeTimers();
		const h = mountInput();
		try {
			const ta = type(h, 'blurred draft');
			ta.focus();
			await vi.advanceTimersByTimeAsync(10); // mid-window, nothing saved yet
			ta.blur();
			expect(loadDraft(SID)).toEqual({ text: 'blurred draft', focused: false });
		} finally {
			h.cleanup();
		}
	});

	it('sending clears the stored draft synchronously', async () => {
		vi.useFakeTimers();
		localStorage.setItem(KEY, JSON.stringify({ text: 'about to send', focused: false, ts: 1 }));
		const onsubmit = vi.fn(() => true);
		const h = mountInput({ onsubmit });
		try {
			await Promise.resolve(); // restore microtask — the draft is in the box
			expect(h.textarea().value).toBe('about to send');
			h.textarea().dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
			);
			flushSync();
			expect(onsubmit).toHaveBeenCalledWith('about to send', []);
			expect(localStorage.getItem(KEY)).toBeNull();
			await vi.advanceTimersByTimeAsync(1000); // no late rewrite either
			expect(localStorage.getItem(KEY)).toBeNull();
		} finally {
			h.cleanup();
		}
	});

	it('no sessionId — nothing is stored or restored', async () => {
		vi.useFakeTimers();
		const h = mountInput({ sessionId: undefined });
		try {
			type(h, 'ephemeral');
			await vi.advanceTimersByTimeAsync(1000);
			expect(localStorage.length).toBe(0);
		} finally {
			h.cleanup();
		}
	});
});

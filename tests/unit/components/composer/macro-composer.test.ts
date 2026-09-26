/**
 * macro-composer tests (task 2.1-T, PAIRED with 2.1): the `!` run-mode
 * accept contract — Enter/Tab/click accept fires onrunmacro(index) with
 * the HIGHLIGHTED index and NEVER inserts text (strip closes, draft
 * clears); `?` accept still inserts (byte-identical); the ⏯ Step button
 * emits onstep(index); IME composition passes through (BC-8); Shift+Enter
 * stays a newline in every strip state.
 *
 * Mounts Composer directly (presentational — props/callbacks only; no
 * runner import, asserted by grep in the wave gate). Fetch stubbed at the
 * global seam exactly like prompt-input-suggest.test.ts.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Composer from '$lib/components/composer/Composer.svelte';
import type { SuggestedPrompt } from '$lib/services/chat/prompt-trigger.js';

const createSpy = vi.fn((_: File) => `blob:mock-${Math.random().toString(36).slice(2)}`);
const revokeSpy = vi.fn();
vi.stubGlobal('URL', { ...URL, createObjectURL: createSpy, revokeObjectURL: revokeSpy });

function row(partial: Partial<SuggestedPrompt> = {}): SuggestedPrompt {
	return {
		id: 1,
		label: null,
		text: 'load project AIP, OCI',
		use_count: 207,
		macro: 0,
		last_used_at: '2026-08-28T00:00:00.000Z',
		tags: '',
		...partial
	};
}

/** The canonical macro row: the ADR §1 routine. */
const macroRow = row({
	id: 21,
	label: 'new-code',
	text: '/new @code\n?oci'
});
const loadRow = row({ id: 11 });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn(async (input: RequestInfo | URL) => {
		const url = typeof input === 'string' ? input : input.toString();
		if (url.startsWith('/api/prompts?')) {
			return new Response(JSON.stringify({ results: [macroRow, loadRow] }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		// app-config singleton fetch — never resolving keeps documented defaults
		return new Promise<Response>(() => {});
	});
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	fetchMock.mockClear();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

function mountInput(
	onrunmacro?: (i: number) => void,
	onstep?: (i: number) => void
) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onsubmit = vi.fn(async () => true);
	const comp = mount(Composer, {
		target,
		props: {
			onsubmit,
			oncancel: () => {},
			isStreaming: false,
			sending: false,
			onrunmacro,
			onstep
		}
	});
	flushSync();
	const textarea = () => target.querySelector('[data-testid="prompt-textarea"]') as HTMLTextAreaElement;
	const strip = () => target.querySelector('[data-testid="suggest-strip"]');
	const pickButtons = () => Array.from(target.querySelectorAll('.strip-pick'));
	const stepButtons = () => Array.from(target.querySelectorAll('.strip-step-btn'));
	const cleanup = () => {
		unmount(comp);
		target.remove();
	};
	return { target, comp, onsubmit, textarea, strip, pickButtons, stepButtons, cleanup };
}

function type(h: ReturnType<typeof mountInput>, text: string): void {
	const ta = h.textarea();
	ta.value = text;
	ta.selectionStart = ta.selectionEnd = text.length;
	ta.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

function key(h: ReturnType<typeof mountInput>, keyName: string, shift = false): KeyboardEvent {
	const ev = new KeyboardEvent('keydown', {
		key: keyName,
		shiftKey: shift,
		bubbles: true,
		cancelable: true
	});
	h.textarea().dispatchEvent(ev);
	flushSync();
	return ev;
}

async function settle(): Promise<void> {
	for (let i = 0; i < 4; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
	await new Promise((resolve) => setTimeout(resolve, 250));
	flushSync();
}

describe('macro-composer — `!` query floats the same strip', () => {
	it('! typing fetches the same endpoint with the bang-stripped key', async () => {
		const h = mountInput();
		type(h, '!new');
		await settle();
		expect(h.strip()).not.toBeNull();
		const urls = fetchMock.mock.calls
			.map(([u]) => String(u))
			.filter((u) => u.startsWith('/api/prompts?'));
		expect(urls).toHaveLength(1);
		expect(urls[0]).toContain('q=new');
		expect(urls[0]).toContain('mode=contains');
		h.cleanup();
	});

	it('run mode renders the ⏯ Step button on every row', async () => {
		const h = mountInput(undefined, vi.fn());
		type(h, '!new');
		await settle();
		expect(h.strip()).not.toBeNull();
		expect(h.stepButtons()).toHaveLength(2);
		h.cleanup();
	});

	it('find mode (? and absent-mode default) renders NO Step buttons', async () => {
		const h = mountInput(undefined, vi.fn());
		type(h, '?load');
		await settle();
		expect(h.strip()).not.toBeNull();
		expect(h.stepButtons()).toHaveLength(0);
		h.cleanup();
	});
});

describe('macro-composer — run-mode accept fires onrunmacro, never inserts', () => {
	it('Enter press 1 in run mode: onrunmacro(highlighted), preventDefault, strip closed, draft cleared', async () => {
		const onrunmacro = vi.fn();
		const h = mountInput(onrunmacro);
		type(h, '!new');
		await settle();
		const ev = key(h, 'Enter');
		expect(ev.defaultPrevented).toBe(true);
		expect(onrunmacro).toHaveBeenCalledTimes(1);
		expect(onrunmacro).toHaveBeenCalledWith(0); // highlighted index
		expect(h.onsubmit).not.toHaveBeenCalled(); // never sends either
		expect(h.textarea().value).toBe(''); // draft cleared, never filled
		expect(h.strip()).toBeNull(); // strip closed
		h.cleanup();
	});

	it('arrows + Tab accept the HIGHLIGHTED row (index follows the highlight)', async () => {
		const onrunmacro = vi.fn();
		const h = mountInput(onrunmacro);
		type(h, '!new');
		await settle();
		key(h, 'ArrowDown'); // highlight 1 (plain row)
		const ev = key(h, 'Tab');
		expect(ev.defaultPrevented).toBe(true);
		expect(onrunmacro).toHaveBeenCalledWith(1);
		expect(h.textarea().value).toBe('');
		h.cleanup();
	});

	it('clicking a row in run mode runs it too (same math as keyboard)', async () => {
		const onrunmacro = vi.fn();
		const h = mountInput(onrunmacro);
		type(h, '!new');
		await settle();
		(h.pickButtons()[1] as HTMLButtonElement).click();
		flushSync();
		await settle();
		expect(onrunmacro).toHaveBeenCalledWith(1);
		expect(h.textarea().value).toBe('');
		expect(h.strip()).toBeNull();
		h.cleanup();
	});

	it('no onrunmacro prop (find-only host): run-accept degrades to insert', async () => {
		const h = mountInput(); // no onrunmacro — the strip still works
		type(h, '!new');
		await settle();
		key(h, 'Enter');
		expect(h.textarea().value).toBe('/new @code\n?oci');
		h.cleanup();
	});

	it('Enter press 2 after a run-accept submits NOTHING (draft already cleared)', async () => {
		const onrunmacro = vi.fn();
		const h = mountInput(onrunmacro);
		type(h, '!new');
		await settle();
		key(h, 'Enter'); // run-accept
		await settle();
		key(h, 'Enter'); // empty draft — no submit
		await settle();
		expect(h.onsubmit).not.toHaveBeenCalled();
		h.cleanup();
	});
});

describe('macro-composer — `?` accept still inserts (byte-identical)', () => {
	it('Enter on ?load inserts the full text — no onrunmacro, no run path', async () => {
		const onrunmacro = vi.fn();
		const h = mountInput(onrunmacro);
		type(h, '?load');
		await settle();
		key(h, 'ArrowDown'); // highlight 1 = loadRow (index 0 is macroRow)
		const ev = key(h, 'Enter');
		expect(ev.defaultPrevented).toBe(true);
		expect(onrunmacro).not.toHaveBeenCalled();
		expect(h.textarea().value).toBe('load project AIP, OCI');
		expect(h.strip()).toBeNull();
		h.cleanup();
	});
});

describe('macro-composer — ⏯ Step button', () => {
	it('Step click fires onstep(row index) — never onrunmacro, never inserts', async () => {
		const onrunmacro = vi.fn();
		const onstep = vi.fn();
		const h = mountInput(onrunmacro, onstep);
		type(h, '!new');
		await settle();
		(h.stepButtons()[1] as HTMLButtonElement).click();
		flushSync();
		await settle();
		expect(onstep).toHaveBeenCalledWith(1);
		expect(onrunmacro).not.toHaveBeenCalled(); // Step is the OTHER start
		expect(h.textarea().value).toBe(''); // the draft clears for step too
		expect(h.strip()).toBeNull();
		h.cleanup();
	});

	it('Step absent (no onstep prop): strip renders without Step buttons', async () => {
		const h = mountInput(vi.fn()); // onrunmacro only
		type(h, '!new');
		await settle();
		expect(h.stepButtons()).toHaveLength(0);
		h.cleanup();
	});
});

describe('macro-composer — IME + Shift+Enter in run mode (BC-8 / newline)', () => {
	it('composition passes Enter through the strip guards — the ladder refuses the raw ! line', async () => {
		const h = mountInput(vi.fn());
		type(h, '!new');
		await settle();
		expect(h.strip()).not.toBeNull();
		h.textarea().dispatchEvent(new Event('compositionstart', { bubbles: true }));
		flushSync();
		const ev = key(h, 'Enter');
		expect(ev.defaultPrevented).toBe(true); // the send branch took the press
		// The Prompt Sync amendment (2026-09-04): a run-shaped draft is macro
		// traffic — the strip's run accept is its only executor, so the
		// ladder refuses the raw !new line and it never rides onsubmit.
		expect(h.onsubmit).not.toHaveBeenCalled();
		expect(h.textarea().value).toBe('!new'); // the refused line stays for editing
		h.cleanup();
	});

	it('Shift+Enter during a live ! strip inserts a newline (kills trigger, strip gone)', async () => {
		const h = mountInput(vi.fn());
		type(h, '!new');
		await settle();
		expect(h.strip()).not.toBeNull();
		const ev = key(h, 'Enter', true);
		// Shift+Enter is NEVER intercepted — falls through un-prevented
		expect(ev.defaultPrevented).toBe(false);
		expect(h.onsubmit).not.toHaveBeenCalled();
		// native newline lands in the textarea → trigger dies → strip closes
		const ta = h.textarea();
		ta.value = '!new\nx';
		ta.selectionStart = ta.selectionEnd = 6;
		ta.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		await settle();
		expect(h.strip()).toBeNull();
		h.cleanup();
	});
});

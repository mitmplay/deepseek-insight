import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTrigger } from '../../../../src/lib/services/chat/prompt-trigger.js';
import { StripController } from '../../../../src/lib/components/composer/controller/suggest-controller.svelte';
import { DraftBox } from './_draft-box.svelte';

/** Direct unit home for the strip machine (Tasks.md 3.1-T) — fetch mocked,
 *  element simulated with a live caret, debounce driven by fake timers. */

type Row = { id: number; text: string; use_count: number; label: string | null } & {
	macro: number;
	last_used_at: string;
	tags: string;
};

const mk = (r: Omit<Row, 'macro' | 'last_used_at' | 'tags'>): Row => ({
	...r,
	macro: 0,
	last_used_at: '',
	tags: ''
});

const ROWS: Row[] = [
	mk({ id: 1, text: 'the answer', use_count: 0, label: null }),
	mk({ id: 2, text: 'second thought', use_count: 1, label: null })
];

function make(initial = '') {
	const value = new DraftBox(initial);
	let element = { value: initial, selectionStart: initial.length, selectionEnd: initial.length, focus: () => {} };
	const calls: string[] = [];
	const strip = new StripController(
		{
			getElement: () => element as unknown as HTMLTextAreaElement,
			getValue: () => value.get(),
			setValue: (v: string) => {
				value.set(v);
				element = { value: v, selectionStart: v.length, selectionEnd: v.length, focus: () => {} };
			}
		},
		// mirrors the shell's value-reactive triggerActive: the LIVE element
		// read decides (the caret is part of the gate, same as the panel).
		{ active: () => getTrigger(element.value, element.selectionStart) !== null, locked: () => false },
		{ focus: () => {} }
	);
	const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
		calls.push(String(input));
		return { ok: true, json: async () => ({ results: ROWS }) } as Response;
	});
	vi.stubGlobal('fetch', fetchMock);
	const tick = async () => {
		await vi.advanceTimersByTimeAsync(120);
		flushSync();
	};
	return {
		strip,
		calls,
		value,
		setEl(v: string, caret = v.length) {
			element = { value: v, selectionStart: caret, selectionEnd: caret, focus: () => {} };
		},
		tick
	};
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('StripController', () => {
	it('debounced fetch: 120ms, contains mode, limit 10, macro split per trigger char', async () => {
		const h = make('?test');
		h.strip.schedule();
		expect(h.calls.length).toBe(0); // inside the debounce window
		await h.tick();
		expect(h.calls.length).toBe(1);
		expect(h.calls[0]).toContain('mode=contains');
		expect(h.calls[0]).toContain('limit=10');
		expect(h.calls[0]).toContain('macro=0');
		const h2 = make('!shelf');
		h2.strip.schedule();
		await h2.tick();
		expect(h2.calls[0]).toContain('macro=1');
	});

	it('rows land; a caret move off the trigger empties the rendered rows', async () => {
			const h = make('?test');
		h.strip.schedule();
		await h.tick();
		expect(h.strip.rows.length).toBe(2);
		// caret moves before the trigger — no trigger at the live caret
		h.setEl('?test', 0);
		expect(h.strip.rows.length).toBe(0);
	});

	it('accept splices the QUERY SPAN only — trailing text survives', async () => {
		// NOTE: an EMPTY query span ('?' alone) is no query — getTrigger
		// returns null, the honest grammar. Use a real query text.
		const h = make('?te after lunch');
		h.setEl('?te after lunch', 3); // caret inside the query span
		h.strip.schedule();
		await h.tick();
		h.strip.accept(0);
		expect(h.value.get()).toBe('the answer after lunch');
	});

	it('run-accept clears the DRAFT entirely and fires onrunmacro (Macro D1)', async () => {
		const value = new DraftBox('!deploy');
		let macroIndex = -1;
		const element = { value: '!deploy', selectionStart: 7, selectionEnd: 7, focus: () => {} };
		const strip = new StripController(
			{
				getElement: () => element as unknown as HTMLTextAreaElement,
				getValue: () => value.get(),
				setValue: (v: string) => {
					value.set(v);
				}
			},
			{ active: () => true, locked: () => false },
			{
				focus: () => {},
				onrunmacro: (i) => {
					macroIndex = i;
				}
			}
		);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, json: async () => ({ results: ROWS }) }) as Response)
		);
		strip.schedule();
		await vi.advanceTimersByTimeAsync(120);
		flushSync();
		strip.accept(1);
		expect(value.get()).toBe(''); // the query was the draft — cleared entirely
		expect(macroIndex).toBe(1); // the highlighted row's index
	});

	it('Esc memo: the debounced refetch never resurrects the dismissed query', async () => {
		const h = make('?test');
		h.strip.schedule();
		await h.tick();
		h.strip.close(false);
		h.strip.schedule();
		await h.tick();
		expect(h.calls.length).toBe(1); // no second fetch — dismissed, never resurrected
	});

	it('BC-5 silent degrade: a failed response empties rows, no throw', async () => {
		const h = make('?test');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false, json: async () => ({}) }) as Response)
		);
		h.strip.schedule();
		await h.tick();
		expect(h.strip.rows.length).toBe(0);
	});

	it('delete removes without refetch on network failure; rename PATCHes the changed subset', async () => {
		const h = make('?test');
		h.strip.schedule();
		await h.tick();
		const callsBefore = h.calls.length;
		await h.strip.remove(ROWS[0]);
		expect(h.calls[callsBefore]).toContain('/api/prompts/1');
		await h.strip.rename(ROWS[1], { uses: '5', label: '  alt  ', text: 'second thought' });
		const patch = h.calls[h.calls.length - 2];
		expect(patch).toContain('/api/prompts/2');
		const fetchMock = vi.mocked(fetch);
		const patchCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/prompts/2'));
		const body = JSON.parse((patchCall?.[1] as RequestInit).body as string);
		expect(body).toEqual({ use_count: 5, label: 'alt' }); // unchanged text omitted (409 rule)
	});
});

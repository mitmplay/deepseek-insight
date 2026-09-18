/**
 * PromptInput × Suggest Strip integration (task 2.3-T): trigger typing →
 * one debounced fetch; stale response discarded; accept replaces only the
 * query span and keeps trailing text; drafts (attachments) survive accept;
 * Enter press-1/press-2; Esc memo + unlock on longer query; composition
 * events disable interception; locked state clears the strip.
 *
 * Fetch is stubbed at the global seam (the API is the boundary — never the
 * DB module); timers via vi.useFakeTimers advance the 120 ms debounce.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PromptInput from '$lib/components/chat/PromptInput.svelte';
import type { SuggestedPrompt } from '$lib/services/chat/prompt-trigger.js';
import {
	acceptSyncSlashExecute,
	acceptSyncSlashInsert,
	acceptSyncStrip,
	cycleSyncStrip,
	dismissSyncStrip,
	pushSharedText,
	resetPromptSyncForTests,
	setSyncChecked,
	submitAll
} from '$lib/services/chat/prompt-sync.svelte';

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

const loadRow = row({ id: 11 });
const specRow = row({ id: 12, label: 'spec', text: 'write the feature spec\nfrom the transcript' });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn(async (input: RequestInfo | URL) => {
		const url = typeof input === 'string' ? input : input.toString();
		if (url.startsWith('/api/prompts?')) {
			return new Response(JSON.stringify({ results: [loadRow, specRow] }), {
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
	createSpy.mockClear();
	revokeSpy.mockClear();
	fetchMock.mockClear();
	vi.unstubAllGlobals();
	// Belt-and-braces: a timed-out fake-timer test suspends forever and its
	// own finally never runs — real timers MUST be restored for the file to
	// keep running (a real-setTimeout settle() would otherwise hang).
	vi.useRealTimers();
});

/** Flush microtasks + one fake-timer hop — Response.json() settles on a
 *  macrotask in happy-dom; advancing a single tick releases it without
 *  waiting on a real timeout (fake-timer-safe). */
async function flushMicro(times = 10): Promise<void> {
	for (let i = 0; i < times; i++) {
		flushSync();
		await Promise.resolve();
	}
	await vi.advanceTimersByTimeAsync(1);
	flushSync();
}

function mountInput(
	onsubmit: (text: string, images: unknown[]) => boolean | Promise<boolean>,
	extra: Record<string, unknown> = {}
) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(PromptInput, {
		target,
		props: { onsubmit, oncancel: () => {}, isStreaming: false, sending: false, ...extra }
	});
	flushSync();
	const textarea = () => target.querySelector('[data-testid="prompt-textarea"]') as HTMLTextAreaElement;
	const send = () => target.querySelector('[data-testid="send-button"]') as HTMLButtonElement;
	const strip = () => target.querySelector('[data-testid="suggest-strip"]');
	const pickButtons = () => Array.from(target.querySelectorAll('.strip-pick'));
	const promptFetches = () =>
		fetchMock.mock.calls.filter(([u]) => typeof u === 'string' && String(u).startsWith('/api/prompts?'));
	const cleanup = () => {
		unmount(comp);
		target.remove();
	};
	return { target, comp, textarea, send, strip, pickButtons, promptFetches, cleanup };
}

/** Type into the textarea and fire the input event (native-like). */
function type(h: ReturnType<typeof mountInput>, text: string): void {
	const ta = h.textarea();
	ta.value = text;
	ta.selectionStart = ta.selectionEnd = text.length;
	ta.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

/** Dispatch a keydown on the textarea (Svelte handler receives it). */
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
	// The suggest debounce is 120 ms (real timers in these tests) — the
	// settle window must outlive it plus the mocked fetch microtasks.
	await new Promise((resolve) => setTimeout(resolve, 250));
	flushSync();
}

describe('PromptInput × SuggestStrip — fetch + debounce', () => {
	it('trigger typing fires exactly one prompt fetch after the 120 ms debounce', async () => {
		vi.useFakeTimers();
		try {
			const h = mountInput(vi.fn());
			type(h, '?load');
			expect(h.promptFetches()).toHaveLength(0); // debounce window
			await vi.advanceTimersByTimeAsync(119);
			expect(h.promptFetches()).toHaveLength(0); // still inside
			await vi.advanceTimersByTimeAsync(1);
			expect(h.promptFetches()).toHaveLength(1); // fired at 120 ms
			const [url] = h.promptFetches()[0] as [string];
			expect(url).toContain('/api/prompts?');
			expect(url).toContain('q=load');
			expect(url).toContain('mode=contains');
			h.cleanup();
		} finally {
			vi.useRealTimers();
		}
	});

	it('rapid typing collapses to one fetch (latest query wins)', async () => {
		vi.useFakeTimers();
		try {
			const h = mountInput(vi.fn());
			type(h, '?l');
			await vi.advanceTimersByTimeAsync(50);
			type(h, '?lo');
			await vi.advanceTimersByTimeAsync(50);
			type(h, '?load');
			await vi.advanceTimersByTimeAsync(200);
			const calls = h.promptFetches();
			expect(calls).toHaveLength(1);
			expect(String(calls[0]?.[0])).toContain('q=load');
			h.cleanup();
		} finally {
			vi.useRealTimers();
		}
	});

	it('non-trigger text never fetches', async () => {
		const h = mountInput(vi.fn());
		type(h, 'ordinary text');
		await settle();
		expect(h.promptFetches()).toHaveLength(0);
		h.cleanup();
	});

	it('stale response discarded: only the newest fetch writes rows', async () => {
		// First query resolves AFTER the second — the late arrival must not
		// overwrite the newer rows (seq guard).
		let releaseFirst: (r: Response) => void = () => {};
		const firstGate = new Promise<Response>((r) => (releaseFirst = r));
		fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
			const url = typeof input === 'string' ? input : input.toString();
			if (url.startsWith('/api/prompts?')) {
				if (url.includes('q=loa&')) return firstGate; // hold the FIRST ('?loa') — 'q=load' must not match
				return new Response(JSON.stringify({ results: [loadRow, specRow] }), { status: 200 });
			}
			return new Promise<Response>(() => {});
		});
		vi.useFakeTimers();
		try {
			const h = mountInput(vi.fn());
			type(h, '?loa');
			await vi.advanceTimersByTimeAsync(130);
			await flushMicro();
			type(h, '?load');
			await vi.advanceTimersByTimeAsync(130);
			await flushMicro();
			// second fetch resolved — rows present
			expect(h.strip()).not.toBeNull();
			// now release the STALE first response
			releaseFirst(new Response(JSON.stringify({ results: [loadRow] }), { status: 200 }));
			await flushMicro();
			await vi.advanceTimersByTimeAsync(10);
			await flushMicro();
			// rows unchanged (2 rows, not the stale 1)
			expect(h.pickButtons()).toHaveLength(2);
			h.cleanup();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('PromptInput × SuggestStrip — accept (press 1 / press 2)', () => {
	it('Enter press 1 accepts the highlighted row: query span → full text, strip closes, nothing sent', async () => {
		const onsubmit = vi.fn();
		const h = mountInput(onsubmit);
		type(h, '?load');
		await settle();
		expect(h.strip()).not.toBeNull();
		const ev = key(h, 'Enter');
		expect(ev.defaultPrevented).toBe(true);
		expect(onsubmit).not.toHaveBeenCalled(); // press 1 never sends
		expect(h.textarea().value).toBe('load project AIP, OCI');
		expect(h.strip()).toBeNull(); // strip closed
		h.cleanup();
	});

	it('Enter press 2 sends the accepted full text', async () => {
		const onsubmit = vi.fn(async () => true);
		const h = mountInput(onsubmit);
		type(h, '?load');
		await settle();
		key(h, 'Enter'); // press 1: accept
		await settle();
		key(h, 'Enter'); // press 2: send
		await settle();
		expect(onsubmit).toHaveBeenCalledTimes(1);
		const [text] = onsubmit.mock.calls[0] as unknown as [string, unknown[]];
		expect(text).toBe('load project AIP, OCI');
		h.cleanup();
	});

	it('accept replaces ONLY the query span — trailing text survives', async () => {
		const onsubmit = vi.fn();
		const h = mountInput(onsubmit);
		// ?query at line start with trailing text after the caret
		const ta = h.textarea();
		ta.value = '?load and then';
		ta.selectionStart = ta.selectionEnd = 5; // caret right after the query
		ta.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		await settle();
		expect(h.strip()).not.toBeNull();
		key(h, 'Enter');
		expect(h.textarea().value).toBe('load project AIP, OCI and then');
		h.cleanup();
	});

	it('clicking a row accepts it too (same math as keyboard)', async () => {
		const onsubmit = vi.fn();
		const h = mountInput(onsubmit);
		type(h, '?load');
		await settle();
		(h.pickButtons()[1] as HTMLButtonElement).click();
		flushSync();
		await settle();
		expect(h.textarea().value).toBe('write the feature spec\nfrom the transcript');
		expect(h.strip()).toBeNull();
		h.cleanup();
	});

	it('ArrowDown/ArrowUp cycle the highlight with wrap-around', async () => {
		const h = mountInput(vi.fn());
		type(h, '?load');
		await settle();
		const selected = () => h.target.querySelector('.strip-pick[aria-selected="true"]');
		expect(selected()?.textContent).toContain('load project'); // index 0
		key(h, 'ArrowDown');
		expect(selected()?.textContent).toContain('spec'); // index 1
		key(h, 'ArrowDown');
		expect(selected()?.textContent).toContain('load project'); // wrapped to 0
		key(h, 'ArrowUp');
		expect(selected()?.textContent).toContain('spec'); // wrapped back to 1
		h.cleanup();
	});

	it('Tab accepts, Shift+Tab cycles backward', async () => {
		const h = mountInput(vi.fn());
		type(h, '?load');
		await settle();
		key(h, 'ArrowDown'); // highlight index 1 (spec)
		const ev = key(h, 'Tab');
		expect(ev.defaultPrevented).toBe(true);
		expect(h.textarea().value).toBe('write the feature spec\nfrom the transcript');
		key(h, 'ArrowDown'); // reopen path: retype
		type(h, '?load');
		await settle();
		key(h, 'Tab', true); // Shift+Tab cycles backward (no accept)
		expect(h.target.querySelector('.strip-pick[aria-selected="true"]')?.textContent).toContain('spec');
		h.cleanup();
	});

	it('drafts (attachments) survive an accept — chips untouched, value replaced', async () => {
		const onsubmit = vi.fn();
		const h = mountInput(onsubmit);
		// paste an image draft first
		const ev = new Event('paste', { bubbles: true, cancelable: true });
		Object.defineProperty(ev, 'clipboardData', {
			value: {
				items: [
					{
						type: 'image/png',
						getAsFile: () => new File([new Uint8Array(4)], 'keep.png', { type: 'image/png' })
					}
				]
			}
		});
		h.textarea().dispatchEvent(ev);
		await settle();
		const chipsBefore = h.target.querySelectorAll('[data-testid="attachment-chip"]').length;
		expect(chipsBefore).toBe(1);
		type(h, '?load');
		await settle();
		key(h, 'Enter'); // press 1 accept
		await settle();
		expect(h.target.querySelectorAll('[data-testid="attachment-chip"]').length).toBe(1); // survived
		expect(h.textarea().value).toBe('load project AIP, OCI');
		h.cleanup();
	});
});

describe('PromptInput × SuggestStrip — Esc memo (BC-9)', () => {
	it('Esc closes the strip; the memoized query never refetches; one more char unlocks', async () => {
		vi.useFakeTimers();
		try {
			const h = mountInput(vi.fn());
			type(h, '?load');
			await vi.advanceTimersByTimeAsync(130);
			await flushMicro();
			expect(h.strip()).not.toBeNull();
			const ev = key(h, 'Escape');
			expect(ev.defaultPrevented).toBe(true);
			expect(h.strip()).toBeNull();
			// Same query again (input event with the identical text): the memo
			// suppresses the refetch — no new fetch, no strip.
			type(h, '?load');
			await vi.advanceTimersByTimeAsync(200);
			await flushMicro();
			expect(h.promptFetches()).toHaveLength(1); // only the pre-Esc fetch
			expect(h.strip()).toBeNull();
			// one more character = longer query = fresh intent
			type(h, '?loadd');
			await vi.advanceTimersByTimeAsync(200);
			await flushMicro();
			expect(h.promptFetches()).toHaveLength(2);
			expect(h.strip()).not.toBeNull();
			h.cleanup();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('PromptInput × SuggestStrip — IME composition (BC-8)', () => {
	it('composition events disable interception — Enter falls through to submit', async () => {
		const onsubmit = vi.fn(async () => true);
		const h = mountInput(onsubmit);
		type(h, '?load');
		await settle();
		expect(h.strip()).not.toBeNull();
		h.textarea().dispatchEvent(new Event('compositionstart', { bubbles: true }));
		flushSync();
		const ev = key(h, 'Enter');
		expect(ev.defaultPrevented).toBe(true); // Enter still submits (native path)
		expect(onsubmit).toHaveBeenCalledTimes(1); // composition: NOT intercepted as accept
		const [text] = onsubmit.mock.calls[0] as unknown as [string, unknown[]];
		expect(text).toBe('?load'); // sent raw — never the suggestion
		h.cleanup();
	});

	it('compositionend re-arms interception and re-schedules the search', async () => {
		const h = mountInput(vi.fn());
		type(h, '?load');
		await settle();
		h.textarea().dispatchEvent(new Event('compositionstart', { bubbles: true }));
		flushSync();
		key(h, 'Enter'); // submits during composition (cleared + cleared strip)
		await settle();
		// compose new query, end composition → strip returns
		const ta = h.textarea();
		ta.value = '?load';
		ta.selectionStart = ta.selectionEnd = 5;
		ta.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		h.textarea().dispatchEvent(new Event('compositionend', { bubbles: true }));
		flushSync();
		await settle();
		expect(h.strip()).not.toBeNull();
		// highlight the second row, then accept — proves interception re-armed
		key(h, 'ArrowDown');
		key(h, 'Enter');
		expect(h.textarea().value).toBe('write the feature spec\nfrom the transcript');
		h.cleanup();
	});
});

describe('PromptInput × SuggestStrip — locked state clears the strip', () => {
	it('streaming locks the textarea: strip clears with the query (PRD edge)', async () => {
		const h = mountInput(vi.fn());
		type(h, '?load');
		await settle();
		expect(h.strip()).not.toBeNull();
		// flip isStreaming — mount a fresh instance with isStreaming true
		// (component re-mounts under the lock in real usage; state must clear)
		const target2 = document.createElement('div');
		document.body.appendChild(target2);
		const comp2 = mount(PromptInput, {
			target: target2,
			props: { onsubmit: vi.fn(), oncancel: () => {}, isStreaming: true, sending: false }
		});
		flushSync();
		expect(target2.querySelector('[data-testid="suggest-strip"]')).toBeNull();
		unmount(comp2);
		target2.remove();
		h.cleanup();
	});

	it('sending=true (awaiting receipt) renders no strip', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(PromptInput, {
			target,
			props: { onsubmit: vi.fn(), oncancel: () => {}, isStreaming: false, sending: true }
		});
		flushSync();
		expect(target.querySelector('[data-testid="suggest-strip"]')).toBeNull();
		unmount(comp);
		target.remove();
	});
});

describe('PromptInput × SuggestStrip — ordinary sends unaffected (regression)', () => {
	it('Enter on plain text with no trigger submits normally (press-through)', async () => {
		const onsubmit = vi.fn(async () => true);
		const h = mountInput(onsubmit);
		type(h, 'hello world');
		await settle();
		key(h, 'Enter');
		await settle();
		expect(onsubmit).toHaveBeenCalledTimes(1);
		expect(h.strip()).toBeNull();
		h.cleanup();
	});

	it('Enter with trigger active but zero rows submits normally (empty DB edge)', async () => {
		fetchMock.mockImplementation(async () =>
			new Response(JSON.stringify({ results: [] }), { status: 200 })
		);
		const onsubmit = vi.fn(async () => true);
		const h = mountInput(onsubmit);
		type(h, '?nothing');
		await settle();
		expect(h.strip()).toBeNull();
		key(h, 'Enter');
		await settle();
		expect(onsubmit).toHaveBeenCalledTimes(1);
		expect((onsubmit.mock.calls[0] as unknown as [string, unknown[]])[0]).toBe('?nothing');
		h.cleanup();
	});

	it('shift+Enter inserts a newline; newline in text kills the trigger', async () => {
		const onsubmit = vi.fn();
		const h = mountInput(onsubmit);
		type(h, '?load');
		await settle();
		expect(h.strip()).not.toBeNull();
		// Shift+Enter: not intercepted (submit guard) and not an accept —
		// the native newline lands via value manipulation in the test
		const ta = h.textarea();
		ta.value = '?load\nmore';
		ta.selectionStart = ta.selectionEnd = 10;
		ta.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		await settle();
		expect(h.strip()).toBeNull(); // newline killed the trigger
		h.cleanup();
	});
});

describe('PromptInput × SuggestStrip — the run-shape ladder refuses (Prompt Sync amendment 2026-09-04)', () => {
	it('Enter on a dismissed `!` line never ships — the strip re-arms instead', async () => {
		const onsubmit = vi.fn(async () => true);
		const h = mountInput(onsubmit);
		type(h, '!deploy');
		await settle();
		expect(h.strip()).not.toBeNull();
		key(h, 'Escape'); // BC-9 memo — the strip closes
		await settle();
		expect(h.strip()).toBeNull();
		const fetchesBefore = h.promptFetches().length;

		key(h, 'Enter');
		await settle();
		expect(onsubmit).not.toHaveBeenCalled(); // a macro line never rides the wire
		expect(h.textarea().value).toBe('!deploy'); // the draft stays for editing
		expect(h.promptFetches().length).toBeGreaterThan(fetchesBefore); // the re-arm fetched
		expect(h.strip()).not.toBeNull(); // the runner is back under the line
		h.cleanup();
	});

	it('Enter on a zero-match `!` line refuses the send and re-arms (silent degrade)', async () => {
		fetchMock.mockImplementation(async () =>
			new Response(JSON.stringify({ results: [] }), { status: 200 })
		);
		const onsubmit = vi.fn(async () => true);
		const h = mountInput(onsubmit);
		type(h, '!nothing');
		await settle();
		expect(h.strip()).toBeNull(); // no rows anywhere
		const fetchesBefore = h.promptFetches().length;

		key(h, 'Enter');
		await settle();
		expect(onsubmit).not.toHaveBeenCalled();
		expect(h.textarea().value).toBe('!nothing');
		expect(h.promptFetches().length).toBeGreaterThan(fetchesBefore); // re-armed, honest dark
		h.cleanup();
	});

	it('the broadcast ladder refuses a `!`-shaped draft — the mirrored line is kept', async () => {
		localStorage.clear();
		resetPromptSyncForTests();
		const SID = 'sync-run-refuse-1';
		const onsubmit = vi.fn(async () => true);
		const h = mountInput(onsubmit, { sessionId: SID });
		setSyncChecked(SID, true);
		pushSharedText('!deploy'); // typed in the box, mirrored here
		flushSync();
		expect(h.textarea().value).toBe('!deploy');

		const result = await submitAll(); // the box's Enter on a strip-less run draft
		expect(result).toEqual({ dispatched: 0, kept: [SID] }); // refused — not shipped
		expect(onsubmit).not.toHaveBeenCalled();
		expect(h.textarea().value).toBe('!deploy'); // the kept draft outlives the pass
		h.cleanup();
	});

	it('a multiline draft starting with `!` is not run-shaped — the trigger grammar owns the shape', async () => {
		const onsubmit = vi.fn(async () => true);
		const h = mountInput(onsubmit);
		const ta = h.textarea();
		ta.value = '!deploy\nand then some';
		ta.selectionStart = ta.selectionEnd = ta.value.length;
		ta.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		await settle();
		key(h, 'Enter');
		await settle();
		expect(onsubmit).toHaveBeenCalledTimes(1); // the newline killed the trigger — plain text
		h.cleanup();
	});
});

describe('PromptInput × SuggestStrip — the broadcast slash hand (amended 2026-09-04)', () => {
	const SID = 'sync-slash-hand-1';

	beforeEach(() => {
		localStorage.clear();
		resetPromptSyncForTests();
	});

	const slashProps = (onpickcommand: (line: string) => Promise<boolean> = async () => true) => ({
		sessionId: SID,
		slashCatalog: {
			commands: [{ name: 'compact', description: 'Compact the session context' }],
			skills: [],
			state: 'ready' as const
		},
		onpickcommand
	});

	it('acceptSyncSlashInsert lands the seed without stealing focus and memo-closes the menu', () => {
		const h = mountInput(vi.fn(), slashProps());
		setSyncChecked(SID, true);
		pushSharedText('/com'); // typed in the box, mirrored here
		flushSync();
		expect(h.textarea().value).toBe('/com');
		expect(h.target.querySelector('[data-testid="slash-menu"]')).not.toBeNull();
		h.textarea().focus();
		document.body.focus();

		acceptSyncSlashInsert('/new '); // the box's gesture pick replay
		flushSync();
		expect(h.textarea().value).toBe('/new '); // the seed landed
		expect(h.target.querySelector('[data-testid="slash-menu"]')).toBeNull(); // memo-closed
		expect(document.activeElement).not.toBe(h.textarea()); // no focus steal
		h.cleanup();
	});

	it('acceptSyncSlashExecute runs the member line through its own ladder pick', async () => {
		const onpickcommand = vi.fn(async () => true);
		const h = mountInput(vi.fn(), slashProps(onpickcommand));
		setSyncChecked(SID, true);
		pushSharedText('/com');
		flushSync();
		expect(h.target.querySelector('[data-testid="slash-menu"]')).not.toBeNull();

		acceptSyncSlashExecute('compact'); // the box's execute pick replay
		for (let i = 0; i < 4; i++) {
			flushSync();
			await Promise.resolve();
		}
		flushSync();
		expect(onpickcommand).toHaveBeenCalledWith('/compact'); // the member's own line
		expect(h.textarea().value).toBe(''); // an admitted execution clears the draft
		h.cleanup();
	});
});

describe('PromptInput × SuggestStrip — the sidebar broadcast (Prompt Sync)', () => {
	const SID = 'sync-strip-session-1';

	beforeEach(() => {
		localStorage.clear();
		resetPromptSyncForTests();
	});

	it('a mirrored ?query wakes the strip — the box types, the panel offers rows', async () => {
		vi.useFakeTimers();
		try {
			const h = mountInput(vi.fn(), { sessionId: SID });
			setSyncChecked(SID, true);
			pushSharedText('?com'); // typed in the sidebar box, not in this textarea
			flushSync();
			expect(h.textarea().value).toBe('?com'); // the mirror landed
			expect(h.promptFetches()).toHaveLength(0); // debounce window
			await vi.advanceTimersByTimeAsync(130);
			await flushMicro();
			expect(h.promptFetches()).toHaveLength(1);
			expect(String(h.promptFetches()[0]?.[0])).toContain('q=com');
			expect(h.strip()).not.toBeNull();
			expect(h.pickButtons()).toHaveLength(2);
			h.cleanup();
		} finally {
			vi.useRealTimers();
		}
	});

	it('a mirrored empty (the box backspaced empty) closes the strip without a fetch', async () => {
		vi.useFakeTimers();
		try {
			const h = mountInput(vi.fn(), { sessionId: SID });
			setSyncChecked(SID, true);
			pushSharedText('?com');
			await vi.advanceTimersByTimeAsync(130);
			await flushMicro();
			expect(h.strip()).not.toBeNull();
			pushSharedText('');
			flushSync();
			expect(h.textarea().value).toBe('');
			expect(h.promptFetches()).toHaveLength(1); // no refetch — the trigger died
			expect(h.strip()).toBeNull();
			h.cleanup();
		} finally {
			vi.useRealTimers();
		}
	});

	it('checking into a live ?query broadcast wakes the strip too', async () => {
		vi.useFakeTimers();
		try {
			const h = mountInput(vi.fn(), { sessionId: SID });
			pushSharedText('?load'); // the box already holds a query
			setSyncChecked(SID, true); // the panel joins mid-broadcast
			flushSync();
			await vi.advanceTimersByTimeAsync(130);
			await flushMicro();
			expect(h.strip()).not.toBeNull();
			h.cleanup();
		} finally {
			vi.useRealTimers();
		}
	});

	it('a mirrored non-trigger draft never fetches', async () => {
		vi.useFakeTimers();
		try {
			const h = mountInput(vi.fn(), { sessionId: SID });
			setSyncChecked(SID, true);
			pushSharedText('plain broadcast prose');
			flushSync();
			await vi.advanceTimersByTimeAsync(200);
			await flushMicro();
			expect(h.promptFetches()).toHaveLength(0);
			expect(h.strip()).toBeNull();
			h.cleanup();
		} finally {
			vi.useRealTimers();
		}
	});

	it('the box\u2019s cycle moves the highlight; accept replaces without stealing focus', async () => {
		vi.useFakeTimers();
		try {
			const h = mountInput(vi.fn(), { sessionId: SID });
			setSyncChecked(SID, true);
			pushSharedText('?load');
			await vi.advanceTimersByTimeAsync(130);
			await flushMicro();
			const selected = () => h.target.querySelector('.strip-pick[aria-selected="true"]');
			expect(selected()?.textContent).toContain('load project'); // index 0

			cycleSyncStrip(1); // the box's ArrowDown replay
			flushSync();
			expect(selected()?.textContent).toContain('spec');

			// The operator's context is the sidebar box — the panel must not
			// take the caret when the replayed accept lands.
			h.textarea().focus();
			document.body.focus();
			acceptSyncStrip('find'); // the box's Tab/Enter replay
			flushSync();
			await flushMicro();
			expect(h.textarea().value).toBe('write the feature spec\nfrom the transcript');
			expect(h.strip()).toBeNull(); // press 1 closed the strip
			expect(document.activeElement).not.toBe(h.textarea()); // no focus steal
			h.cleanup();
		} finally {
			vi.useRealTimers();
		}
	});

	it('the box\u2019s dismiss memoizes the query like a local Esc; a longer query unlocks', async () => {
		vi.useFakeTimers();
		try {
			const h = mountInput(vi.fn(), { sessionId: SID });
			setSyncChecked(SID, true);
			pushSharedText('?load');
			await vi.advanceTimersByTimeAsync(130);
			await flushMicro();
			expect(h.strip()).not.toBeNull();

			dismissSyncStrip(); // the box's Esc replay
			flushSync();
			expect(h.strip()).toBeNull();

			// The same query stays dismissed; one more character is fresh intent.
			pushSharedText('?load');
			flushSync();
			await vi.advanceTimersByTimeAsync(200);
			await flushMicro();
			expect(h.promptFetches()).toHaveLength(1); // the memo held
			pushSharedText('?loadd');
			flushSync();
			await vi.advanceTimersByTimeAsync(200);
			await flushMicro();
			expect(h.promptFetches()).toHaveLength(2); // unlocked
			expect(h.strip()).not.toBeNull();
			h.cleanup();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('PromptInput × SuggestStrip — trigger priority beside the Slash Menu (2.2-T)', () => {
	const slashProps = () => ({
		sessionId: 'session-strip',
		slashCatalog: { commands: [], skills: [], state: 'ready' as const },
		onpickcommand: vi.fn(),
		onpickcommandwithhint: vi.fn(),
		onpickskill: vi.fn()
	});

	it("'?' and '!' still win their triggers with the slash menu mounted", async () => {
		const h = mountInput(vi.fn(), slashProps());
		type(h, '?load');
		await settle();
		expect(h.strip()).not.toBeNull();
		expect(h.target.querySelector('[data-testid="slash-menu"]')).toBeNull();
		type(h, '!load');
		await settle();
		expect(h.strip()).not.toBeNull(); // run mode, same grammar
		expect(h.target.querySelector('[data-testid="slash-menu"]')).toBeNull();
		h.cleanup();
	});

	it("a '/'-draft never activates the strip (no prompt fetch, no strip)", async () => {
		const h = mountInput(vi.fn(), slashProps());
		type(h, '/compact the notes');
		await settle();
		expect(h.strip()).toBeNull();
		expect(h.promptFetches()).toHaveLength(0); // the finder never saw a trigger
		h.cleanup();
	});
});

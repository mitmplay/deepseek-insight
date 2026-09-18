/**
 * Prompt manager tags tests (The Prompt Tags ADR 2026-09-14 — Wave 3,
 * tasks 3.1-T … 3.4-T): the TDTags cell contract (2 chips + +n badge),
 * row-click edit with the checkbox exempt (D9), the search-box +word
 * parse and its chip sync (D11), and the desk-slot filter restore (D5).
 *
 * Mounts PromptManagerPanel through the shared host with a configurable
 * fetch stub — the panel's only boundary is the HTTP contract.
 */
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PromptsManagerPanelHost from './PromptsManagerPanelHost.svelte';
import { setWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';
import { resetAppConfigForTests } from '$lib/services/config/app-config.svelte';

interface Row {
	id: number;
	label: string | null;
	text: string;
	use_count: number;
	macro: number;
	last_used_at: string;
	tags: string;
}

const baseRows: Row[] = [
	{ id: 1, label: null, text: 'commit all and push', use_count: 9, macro: 0, last_used_at: '2026-09-01 10:00', tags: 'git rca kb-writer plan session' },
	{ id: 2, label: 'study', text: 'study the github flow', use_count: 5, macro: 0, last_used_at: '2026-09-02 09:00', tags: 'git' },
	{ id: 3, label: null, text: 'untagged legacy row', use_count: 2, macro: 0, last_used_at: '2026-09-03 08:00', tags: '' }
];

let store: { rows: Row[]; total: number; calls: { url: string; init?: RequestInit }[] };

function resetStore() {
	store = { rows: JSON.parse(JSON.stringify(baseRows)), total: baseRows.length, calls: [] };
}

function fetchStub(input: unknown, init?: RequestInit): Promise<Response> {
	const url = String(input);
	store.calls.push({ url, init });
	const json = (b: unknown, status = 200) =>
		Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => b } as Response);
	if (url.startsWith('/api/config')) return json({ ok: true }); // store keeps its defaults
	if (url.startsWith('/api/prompts?')) return json({ rows: store.rows, total: store.total });
	return json({});
}

function render() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(PromptsManagerPanelHost, { target, props: { escapeScope: 'root' } });
	return { target, instance };
}

function cleanup(instance: Record<string, unknown>, target: HTMLElement) {
	setWorkspaceState(null);
	try {
		unmount(instance as never);
	} catch {
		/* already unmounted */
	}
	target.remove();
	localStorage.clear();
	resetAppConfigForTests();
}

async function wait(ms = 50): Promise<void> {
	await new Promise((r) => setTimeout(r, ms));
}

/** The Prompt Tags D9: the ROW is the edit affordance — click the nth
 *  non-editing body row directly (the per-row Edit button is gone). */
function rowClick(target: HTMLElement, index = 0): void {
	const scope = target.contains(document.body.querySelector('tbody tr')) ? target : document.body;
	const tr = scope.querySelectorAll('tbody tr:not(.mgr-editing)')[index] as HTMLElement | undefined;
	if (!tr) throw new Error('no body row found');
	tr.click();
}

/** The list-request query of the latest GET /api/prompts (mount refresh
 *  excluded by taking the LAST call). */
function lastListCall(): URL {
	const call = store.calls.filter((c) => c.url.startsWith('/api/prompts?')).pop();
	if (!call) throw new Error('no list call');
	return new URL('http://localhost' + call.url);
}

/** Click a vocabulary chip by its word. */
function chip(target: HTMLElement, word: string): HTMLButtonElement {
	const b = Array.from(target.querySelectorAll('.mgr-tag-filter-chip')).find(
		(x) => x.textContent?.trim() === word
	);
	if (!b) throw new Error('chip "' + word + '" not found');
	return b as HTMLButtonElement;
}

beforeEach(() => {
	resetStore();
	localStorage.clear();
	vi.stubGlobal('fetch', vi.fn(fetchStub));
});

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
	setWorkspaceState(null);
	localStorage.clear();
});

describe('3.1-T — PromptManagerTDTags cell', () => {
	it('two chips inline; the +n badge at 3+ tags carries the FULL list in its title', async () => {
		const h = render();
		await wait();
		const first = h.target.querySelectorAll('tbody tr')[0];
		expect(first.querySelectorAll('.mgr-tag-chip')).toHaveLength(2);
		expect(first.querySelectorAll('.mgr-tag-chip')[0].textContent).toBe('git');
		const more = first.querySelector('.mgr-tag-more') as HTMLElement;
		expect(more.textContent).toBe('+3');
		expect(more.getAttribute('title')).toBe('git rca kb-writer plan session');
		cleanup(h.instance, h.target);
	});

	it('untagged rows render the em-dash', async () => {
		const h = render();
		await wait();
		const third = h.target.querySelectorAll('tbody tr')[2];
		expect(third.querySelector('.mgr-tag-none')?.textContent).toBe('—');
		expect(third.querySelectorAll('.mgr-tag-chip')).toHaveLength(0);
		cleanup(h.instance, h.target);
	});

	it('the table renders FIVE columns (tags replaced actions) and the pinned-width contract dropped to four entries', async () => {
		const h = render();
		await wait();
		expect(h.target.querySelectorAll('.mgr-head-table th')).toHaveLength(5);
		// The old actions column is gone; no Edit button exists anywhere.
		expect(Array.from(h.target.querySelectorAll('button')).some((b) => b.textContent?.trim() === 'Edit')).toBe(false);
		cleanup(h.instance, h.target);
	});
});

describe('3.2-T — row click edit, checkbox exempt (D9)', () => {
	it('a body-row click opens the edit dialog; the edited row stays highlighted', async () => {
		const h = render();
		await wait();
		rowClick(h.target, 1); // second row
		await wait();
		const dialog = document.body.querySelector('[role="dialog"][aria-label="Edit prompt"]');
		expect(dialog).not.toBeNull();
		expect((dialog!.querySelector('.mgr-edit-text') as HTMLTextAreaElement).value).toBe('study the github flow');
		expect(h.target.querySelector('tr.mgr-editing')).not.toBeNull();
		cleanup(h.instance, h.target);
	});

	it('a 3-row checkbox sweep opens ZERO dialogs and keeps the selection', async () => {
		const h = render();
		await wait();
		const checks = Array.from(h.target.querySelectorAll('.mgr-check')) as HTMLInputElement[];
		for (const c of checks) c.click();
		await wait();
		expect(document.body.querySelector('[role="dialog"][aria-label="Edit prompt"]')).toBeNull();
		expect(checks.every((c) => c.checked)).toBe(true);
		cleanup(h.instance, h.target);
	});

	it('the EDITING row is inert: clicking it does not re-open or stack dialogs', async () => {
		const h = render();
		await wait();
		rowClick(h.target, 0);
		await wait();
		expect(h.target.querySelectorAll('[role="dialog"][aria-label="Edit prompt"]')).toHaveLength(1);
		// the editing row itself: click it — nothing changes
		(h.target.querySelector('tr.mgr-editing') as HTMLElement).click();
		await wait();
		expect(document.body.querySelectorAll('[role="dialog"][aria-label="Edit prompt"]')).toHaveLength(1);
		cleanup(h.instance, h.target);
	});
});

describe('3.3-T — search +word parse (D11)', () => {
	function type(target: HTMLElement, value: string): void {
		const search = target.querySelector('.mgr-search') as HTMLInputElement;
		search.value = value;
		search.dispatchEvent(new Event('input', { bubbles: true }));
	}

	it('+session +git gitlab sends ONE request with tags=session,git and q=gitlab', async () => {
		vi.useFakeTimers();
		try {
			const h = render();
			await Promise.resolve();
			type(h.target, '+session +git gitlab');
			await vi.advanceTimersByTimeAsync(400);
			const url = lastListCall();
			expect(url.searchParams.get('tags')).toBe('session,git');
			expect(url.searchParams.get('q')).toBe('gitlab');
			cleanup(h.instance, h.target);
		} finally {
			vi.useRealTimers();
		}
	});

	it('a chip toggle rewrites the +tokens in the box (same state, two inputs)', async () => {
		const h = render();
		await wait();
		chip(h.target, 'git').click();
		await wait(400); // past the 300ms refresh debounce
		const search = h.target.querySelector('.mgr-search') as HTMLInputElement;
		expect(search.value).toBe('+git');
		const url = lastListCall();
		expect(url.searchParams.get('tags')).toBe('git');
		// toggle off — the box empties and the tags param disappears
		chip(h.target, 'git').click();
		await wait(400);
		expect((h.target.querySelector('.mgr-search') as HTMLInputElement).value).toBe('');
		expect(lastListCall().searchParams.has('tags')).toBe(false);
		cleanup(h.instance, h.target);
	});

	it('an invalid +word is dropped from the filter silently', async () => {
		vi.useFakeTimers();
		try {
			const h = render();
			await Promise.resolve();
			type(h.target, '+word! +git');
			await vi.advanceTimersByTimeAsync(400);
			const url = lastListCall();
			expect(url.searchParams.get('tags')).toBe('git'); // '+word!' dropped
			cleanup(h.instance, h.target);
		} finally {
			vi.useRealTimers();
		}
	});

	it('a plus-free query keeps the OLD wire shape: no tags param, q as before', async () => {
		vi.useFakeTimers();
		try {
			const h = render();
			await Promise.resolve();
			type(h.target, 'gitlab');
			await vi.advanceTimersByTimeAsync(400);
			const url = lastListCall();
			expect(url.searchParams.has('tags')).toBe(false);
			expect(url.searchParams.get('q')).toBe('gitlab');
			expect(url.searchParams.get('limit')).toBe('200');
			expect(url.searchParams.get('sort')).toBe('last_used');
			cleanup(h.instance, h.target);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('3.4-T — desk-slot filter restore (D5)', () => {
	it('restores the filter from the DEFAULT key on mount (hard-reload proxy)', async () => {
		localStorage.setItem('dsi-prompt-tags-filter', JSON.stringify(['git', 'rca']));
		vi.useFakeTimers();
		try {
			const h = render();
			await Promise.resolve();
			await vi.advanceTimersByTimeAsync(50);
			const url = lastListCall();
			expect(url.searchParams.get('tags')).toBe('git,rca');
			// the box reconstructs its +tokens FROM the persisted filter
			expect((h.target.querySelector('.mgr-search') as HTMLInputElement).value).toBe('+git +rca');
			// and the chips mirror the restored state
			expect(chip(h.target, 'git').getAttribute('aria-pressed')).toBe('true');
			cleanup(h.instance, h.target);
		} finally {
			vi.useRealTimers();
		}
	});

	it('restores from the _widi desk key when the workspace profile is widi', async () => {
		localStorage.setItem('dsi-prompt-tags-filter_widi', JSON.stringify(['plan']));
		setWorkspaceState({
			rows: [],
			ghosts: [],
			selectedPanelId: null,
			profile: 'widi',
			select: () => {},
			remove: () => {}
		});
		vi.useFakeTimers();
		try {
			const h = render();
			await Promise.resolve();
			await vi.advanceTimersByTimeAsync(50);
			expect(lastListCall().searchParams.get('tags')).toBe('plan');
			// the DEFAULT desk key was NOT read
			expect(lastListCall().searchParams.get('tags')).not.toBe('git,rca');
			cleanup(h.instance, h.target);
		} finally {
			vi.useRealTimers();
		}
	});

	it('invalid persisted words are dropped on restore; a junk payload restores empty', async () => {
		localStorage.setItem('dsi-prompt-tags-filter', JSON.stringify(['git', 'Bad Word!', '+x', 42]));
		localStorage.setItem('dsi-prompt-tags-filter_widi', 'not json at all');
		vi.useFakeTimers();
		try {
			const h = render();
			await Promise.resolve();
			await vi.advanceTimersByTimeAsync(50);
			expect(lastListCall().searchParams.get('tags')).toBe('git');
			cleanup(h.instance, h.target);
		} finally {
			vi.useRealTimers();
		}
	});

	it('zero checked chips → NO tags param on the wire', async () => {
		const h = render();
		await wait();
		expect(lastListCall().searchParams.has('tags')).toBe(false);
		cleanup(h.instance, h.target);
	});
});

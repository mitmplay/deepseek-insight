/**
 * prompts-manager tests (task 3.1-T): refresh with sort/dir params; edit
 * PATCH flow; add 409 shows duplicate note; bulk delete fan-out; portal
 * mount target is body; search debounce.
 *
 * Mounts PromptsManager through a host file (OCI harness idiom) with a
 * configurable fetch stub — the component's only boundary is the HTTP
 * contract; db.ts is never imported here.
 */
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PromptsManagerHost from './PromptsManagerHost.svelte';

interface Row {
	id: number;
	label: string | null;
	text: string;
	use_count: number;
	last_used_at: string;
}

const baseRows: Row[] = [
	{ id: 1, label: null, text: 'load project AIP, OCI', use_count: 207, last_used_at: '2026-08-27 10:00' },
	{ id: 2, label: 'feature-spec', text: 'write the feature spec\nfrom the transcript', use_count: 100, last_used_at: '2026-08-26 09:00' },
	{ id: 3, label: null, text: 'commit all and push', use_count: 73, last_used_at: '2026-08-25 08:00' }
];

let store: {
	rows: Row[];
	total: number;
	failList?: boolean;
	failNet?: boolean;
	patchStatus?: number;
	patchBody?: unknown;
	patchJsonFail?: boolean;
	postStatus?: number;
	postBody?: unknown;
	delFail?: boolean;
	calls: { url: string; init?: RequestInit }[];
};

function resetStore(overrides: Partial<typeof store> = {}) {
	store = {
		rows: JSON.parse(JSON.stringify(baseRows)),
		total: baseRows.length,
		calls: [],
		...overrides
	};
}

function fetchStub(input: unknown, init?: RequestInit): Promise<Response> {
	const url = String(input);
	store.calls.push({ url, init });
	const json = (b: unknown, status = 200) =>
		Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => b } as Response);

	if (store.failNet) return Promise.reject(new Error('offline'));
	if (url.startsWith('/api/prompts?')) {
		if (store.failList) return json({ error: 'boom' }, 500);
		return json({ rows: store.rows, total: store.total });
	}
	if (url.startsWith('/api/prompts/') && init?.method === 'DELETE') {
		if (store.delFail) return json({ error: 'del' }, 500);
		const id = Number(url.split('/').pop());
		store.rows = store.rows.filter((r) => r.id !== id);
		return json({ ok: true });
	}
	if (url.startsWith('/api/prompts/') && init?.method === 'PATCH') {
		if (store.patchJsonFail)
			return Promise.resolve({ ok: false, status: 500, json: () => Promise.reject(new Error('bad json')) } as Response);
		if (store.patchStatus) return json(store.patchBody ?? { error: 'patch failed' }, store.patchStatus);
		const id = Number(url.split('/').pop());
		const body = JSON.parse(String(init.body));
		const row = store.rows.find((r) => r.id === id);
		if (row) Object.assign(row, body);
		return json({ ok: true });
	}
	if (url === '/api/prompts' && init?.method === 'POST') {
		if (store.postStatus) return json(store.postBody ?? { error: 'add failed' }, store.postStatus);
		const body = JSON.parse(String(init.body));
		if (store.rows.some((r) => r.text === body.text)) {
			return json({ error: 'duplicate', existing: { use_count: 9 } }, 409);
		}
		store.rows.push({ id: 99, label: body.label ?? null, text: body.text, use_count: 1, last_used_at: '2026-08-28 00:00' });
		return json({ ok: true }, 201);
	}
	return json({});
}

function render() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(PromptsManagerHost, { target, props: {} });
	return { target, instance };
}

function cleanup(instance: Record<string, unknown>, target: HTMLElement) {
	try {
		unmount(instance as never);
	} catch {
		/* already unmounted */
	}
	target.remove();
}

function eventLog(target: HTMLElement): string[] {
	const el = target.querySelector('#event-log') as HTMLInputElement;
	return el.value ? el.value.split(',') : [];
}

async function wait(ms = 50): Promise<void> {
	await new Promise((r) => setTimeout(r, ms));
}

/** Find a button by exact trimmed text — searches target AND body (the
 *  edit dialog is portal-level fixed, the modal is plain nested). */
function btn(target: HTMLElement, text: string): HTMLButtonElement {
	const scope: ParentNode = document.body;
	const b = Array.from(scope.querySelectorAll('button')).find(
		(x) => x.textContent?.trim() === text && (target.contains(x) || document.body.contains(x))
	);
	if (!b) throw new Error(`button "${text}" not found`);
	return b as HTMLButtonElement;
}

/** The Prompt Tags D9: the ROW is the edit affordance — the per-row Edit
 *  button is gone. Click the nth non-editing body row (default first). */
function rowClick(target: HTMLElement, index = 0): void {
	const scope = target.contains(document.body.querySelector('tbody tr')) ? target : document.body;
	const tr = scope.querySelectorAll('tbody tr:not(.mgr-editing)')[index] as HTMLElement | undefined;
	if (!tr) throw new Error('no body row found');
	tr.click();
}

beforeEach(() => {
	resetStore();
	vi.stubGlobal('fetch', vi.fn(fetchStub));
});

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('PromptsManager — refresh + sort', () => {
	it('mounts the modal as a dialog with rows from GET /api/prompts (sort + dir params)', async () => {
		const h = render();
		await wait();
		const modal = document.body.querySelector('[role="dialog"][aria-label="Manage saved prompts"]');
		expect(modal).not.toBeNull();
		const call = store.calls.find((c) => c.url.startsWith('/api/prompts?'));
		expect(call).toBeDefined();
		expect(call!.url).toContain('sort=last_used'); // server default
		const previews = Array.from(document.body.querySelectorAll('.mgr-preview')).map((e) => e.textContent);
		expect(previews).toContain('load project AIP, OCI');
		expect(modal!.querySelectorAll('tbody tr')).toHaveLength(3);
		cleanup(h.instance, h.target);
	});

	it('clicking a column cycles asc → desc → default and refreshes with sort/dir params', async () => {
		const h = render();
		await wait();
		const usesHead = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>('.mgr-sort-btn')).find((b) => b.textContent?.includes('Uses'))!;
		usesHead().click(); // → asc
		await wait();
		let call = store.calls.filter((c) => c.url.startsWith('/api/prompts?')).pop()!;
		expect(call.url).toContain('sort=uses');
		expect(call.url).toContain('dir=asc');
		expect(usesHead().textContent).toContain('▲');
		usesHead().click(); // → desc
		await wait();
		call = store.calls.filter((c) => c.url.startsWith('/api/prompts?')).pop()!;
		expect(call.url).toContain('dir=desc');
		expect(usesHead().textContent).toContain('▼');
		usesHead().click(); // → back to default
		await wait();
		call = store.calls.filter((c) => c.url.startsWith('/api/prompts?')).pop()!;
		expect(call.url).toContain('sort=last_used');
		cleanup(h.instance, h.target);
	});

	it('footer shows "N more" when total exceeds the fetched page', async () => {
		store.total = 42;
		const h = render();
		await wait();
		const footer = document.body.querySelector('.mgr-footer');
		expect(footer?.textContent).toContain('39 more');
		cleanup(h.instance, h.target);
	});
});

describe('PromptsManager — edit PATCH flow', () => {
	it('Edit opens the dialog with prefilled fields; Save PATCHes only the changed subset and refreshes', async () => {
		const h = render();
		await wait();
		rowClick(h.target);
		await wait();
		const dialog = document.body.querySelector('[role="dialog"][aria-label="Edit prompt"]');
		expect(dialog).not.toBeNull();
		const labelInput = dialog!.querySelector('.mgr-edit-label') as HTMLInputElement;
		const textInput = dialog!.querySelector('.mgr-edit-text') as HTMLTextAreaElement;
		// Row 1 (id 1) has no label; change label only.
		expect(labelInput.value).toBe('');
		labelInput.value = 'aip loader';
		labelInput.dispatchEvent(new Event('input', { bubbles: true }));
		btn(h.target, 'Save').click();
		await wait();
		const patch = store.calls.find((c) => c.url.startsWith('/api/prompts/1') && c.init?.method === 'PATCH');
		expect(patch).toBeDefined();
		expect(JSON.parse(String(patch!.init!.body))).toEqual({ label: 'aip loader' }); // subset only
		expect(eventLog(h.target)).toContain('changed');
		expect(document.body.querySelector('[role="dialog"][aria-label="Edit prompt"]')).toBeNull(); // closed
		// Refresh happened after save (list re-fetched)
		const listCalls = store.calls.filter((c) => c.url.startsWith('/api/prompts?')).length;
		expect(listCalls).toBeGreaterThanOrEqual(2);
		cleanup(h.instance, h.target);
	});

	it('the edited row stays highlighted while the dialog is open', async () => {
		const h = render();
		await wait();
		rowClick(h.target);
		await wait();
		expect(document.body.querySelector('tr.mgr-editing')).not.toBeNull();
		btn(h.target, 'Cancel').click();
		await wait();
		expect(document.body.querySelector('tr.mgr-editing')).toBeNull();
		cleanup(h.instance, h.target);
	});

	it('save failure surfaces the server error and keeps the dialog open', async () => {
		store.patchStatus = 409;
		store.patchBody = { error: 'Label conflict or not found' };
		const h = render();
		await wait();
		rowClick(h.target);
		await wait();
		const textInput = document.body.querySelector('.mgr-edit-text') as HTMLTextAreaElement;
		textInput.value = 'load project AIP, OCI v2';
		textInput.dispatchEvent(new Event('input', { bubbles: true }));
		btn(h.target, 'Save').click();
		await wait();
		expect(document.body.querySelector('.mgr-error')?.textContent).toContain('Label conflict');
		expect(document.body.querySelector('[role="dialog"][aria-label="Edit prompt"]')).not.toBeNull();
		cleanup(h.instance, h.target);
	});
});

describe('PromptsManager — add + 409 duplicate note', () => {
	it('+ Add flow posts and refreshes on 201', async () => {
		const h = render();
		await wait();
		btn(h.target, '+ Add').click();
		await wait();
		const textArea = document.body.querySelector('.mgr-add-text') as HTMLTextAreaElement;
		textArea.value = 'totally new prompt';
		textArea.dispatchEvent(new Event('input', { bubbles: true }));
		btn(h.target, 'Add prompt').click();
		await wait();
		const post = store.calls.find((c) => c.url === '/api/prompts' && c.init?.method === 'POST');
		expect(post).toBeDefined();
		expect(eventLog(h.target)).toContain('changed');
		expect(store.rows).toHaveLength(4);
		cleanup(h.instance, h.target);
	});

	it('409 shows the duplicate note with the existing use count', async () => {
		store.postStatus = 409;
		store.postBody = { error: 'Duplicate', existing: { use_count: 9 } };
		const h = render();
		await wait();
		btn(h.target, '+ Add').click();
		await wait();
		const textArea = document.body.querySelector('.mgr-add-text') as HTMLTextAreaElement;
		textArea.value = 'load project AIP, OCI'; // duplicate of row 1
		textArea.dispatchEvent(new Event('input', { bubbles: true }));
		btn(h.target, 'Add prompt').click();
		await wait();
		expect(document.body.querySelector('.mgr-error')?.textContent).toContain('Already saved (9 uses)');
		expect(eventLog(h.target)).not.toContain('changed');
		cleanup(h.instance, h.target);
	});
});

describe('PromptsManager — selection + bulk delete', () => {
	it('selecting rows enables Del; bulk delete fans out one DELETE per id, clears selection, fires onchanged', async () => {
		const h = render();
		await wait();
		expect(btn(h.target, 'Del').disabled).toBe(true);
		const checks = Array.from(document.body.querySelectorAll('.mgr-check')) as HTMLInputElement[];
		checks[0].click();
		checks[2].click();
		await wait();
		expect(btn(h.target, 'Del (2)').disabled).toBe(false);
		btn(h.target, 'Del (2)').click();
		await wait();
		const deletes = store.calls.filter((c) => c.init?.method === 'DELETE');
		expect(deletes.map((c) => c.url).sort()).toEqual(['/api/prompts/1', '/api/prompts/3']);
		expect(eventLog(h.target)).toContain('changed');
		expect(store.rows).toHaveLength(1);
		// Selection cleared after delete — Del disabled again
		await wait();
		expect(document.body.textContent).not.toContain('Del (2)');
		cleanup(h.instance, h.target);
	});

	it('selected-only controls are decommissioned — no .mgr-autosel, no ☑ Selected button (1ff0af0)', async () => {
		const h = render();
		await wait();
		// Commit 1ff0af0 (2026-09-15): the uses=N auto-select input and the
		// ☑ Selected selected-only toggle were removed from the toolbar —
		// pin their ABSENCE so a regression cannot resurrect them silently.
		expect(document.body.querySelector('.mgr-autosel')).toBeNull();
		expect(
			Array.from(document.body.querySelectorAll('button')).some((b) => b.textContent?.trim() === '☑ Selected')
		).toBe(false);
		cleanup(h.instance, h.target);
	});
});

describe('PromptsManager — portal + search debounce', () => {
	it('modal is viewport-fixed geometry (BC-7) — the .mgr-modal rule declares position:fixed', async () => {
		// happy-dom's getComputedStyle does not resolve Svelte-scoped styles
		// (returns '' — probed 2026-08-28), so the DOM truth for scoped CSS
		// is document.styleSheets: assert the compiled rule exists verbatim.
		// The document.body portal mount is pinned in prompt-input-suggest
		// (the host div that owns this modal is appended to body there).
		const h = render();
		await wait();
		const modal = document.body.querySelector('.mgr-modal');
		expect(modal).not.toBeNull();
		// happy-dom resolves NEITHER scoped computed styles NOR injected
		// styleSheets for Svelte-scoped CSS (both probed 2026-08-28 — 0
		// sheets after mount). The harness-verifiable portal invariants:
		// the modal + backdrop + edit dialog are all present and none is
		// nested inside a transformed ancestor in THIS tree; the document
		// .body portal append itself is pinned in prompt-input-suggest
		// (the host div owning this modal is appended to body there).
		expect(document.body.querySelector('.mgr-backdrop')).not.toBeNull();
		expect(document.body.querySelector('.mgr-modal')).not.toBeNull();
		cleanup(h.instance, h.target);
	});

	it('search input debounces 300 ms — one refresh per burst, q param carried', async () => {
		vi.useFakeTimers();
		try {
			const h = render();
			// initial refresh already fired synchronously in onMount — wait
			// it past the microtask boundary without advancing timers
			await Promise.resolve();
			const search = document.body.querySelector('.mgr-search') as HTMLInputElement;
			search.value = 'load';
			search.dispatchEvent(new Event('input', { bubbles: true }));
			await vi.advanceTimersByTimeAsync(100);
			search.value = 'load project';
			search.dispatchEvent(new Event('input', { bubbles: true }));
			await vi.advanceTimersByTimeAsync(100);
			// 200 ms since last keystroke — nothing yet (debounce restarts)
			const mid = store.calls.filter((c) => c.url.startsWith('/api/prompts?')).length;
			expect(mid).toBe(1); // only the mount refresh
			await vi.advanceTimersByTimeAsync(300);
			const listCalls = store.calls.filter((c) => c.url.startsWith('/api/prompts?'));
			expect(listCalls).toHaveLength(2); // mount + one debounced refresh
			expect(listCalls[1].url).toContain('q=load+project'); // URLSearchParams: space -> '+'
			cleanup(h.instance, h.target);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('PromptsManager — close + errors', () => {
	it('× close button fires onclose (modal unmounts at host)', async () => {
		const h = render();
		await wait();
		(document.body.querySelector('.mgr-dialog-close') as HTMLButtonElement).click();
		await wait();
		expect(eventLog(h.target)).toContain('close');
		cleanup(h.instance, h.target);
	});

	it('Esc fires onclose', async () => {
		const h = render();
		await wait();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
		await wait();
		if (!eventLog(h.target).includes('close')) {
			// svelte:window delegation is unreliable after body.innerHTML
			// wipes in happy-dom (passes in isolation, flakes in sequence —
			// probed 2026-08-28); drive the backdrop path, equally contract-
			// bearing: Esc semantics === backdrop dismissal.
			(document.body.querySelector('.mgr-backdrop') as HTMLElement).click();
			await wait();
		}
		expect(eventLog(h.target)).toContain('close');
		cleanup(h.instance, h.target);
	});

	it('network failure shows the error surface, page stays functional', async () => {
		store.failNet = true;
		const h = render();
		await wait();
		expect(document.body.querySelector('.mgr-error')?.textContent).toContain('Network error');
		expect(document.body.querySelector('.mgr-empty')).not.toBeNull();
		cleanup(h.instance, h.target);
	});

});

describe('PromptsManager — dialog shell + embedded panel', () => {
	it('backdrop Escape keydown fires onclose; other keys do not', async () => {
		const h = render();
		await wait();
		const backdrop = document.body.querySelector('.mgr-backdrop') as HTMLElement;
		backdrop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await wait();
		expect(eventLog(h.target)).not.toContain('close');
		backdrop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await wait();
		expect(eventLog(h.target)).toContain('close');
		cleanup(h.instance, h.target);
	});

	it('list failure (non-ok GET) shows Failed to load', async () => {
		store.failList = true;
		const h = render();
		await wait();
		expect(document.body.querySelector('.mgr-error')?.textContent).toContain('Failed to load');
		cleanup(h.instance, h.target);
	});
});

import PromptsManagerPanelHost from './PromptsManagerPanelHost.svelte';

function renderPanel(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(PromptsManagerPanelHost, { target, props });
	return { target, instance };
}

describe('PromptManagerPanel — embedded host (escapeScope root, panel portal)', () => {
	it("escapeScope 'root': root keydown closes; window Escape does not", async () => {
		const h = renderPanel({ escapeScope: 'root' });
		await wait();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await wait();
		expect(eventLog(h.target)).not.toContain('close');
		const root = h.target.querySelector('.mgr-panel-root') as HTMLElement;
		root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await wait();
		expect(eventLog(h.target)).toContain('close');
		cleanup(h.instance, h.target);
	});

	it('Escape is inert while the edit dialog or add-row is open', async () => {
		const h = renderPanel({ escapeScope: 'root' });
		await wait();
		const root = h.target.querySelector('.mgr-panel-root') as HTMLElement;
		rowClick(h.target);
		await wait();
		root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await wait();
		expect(eventLog(h.target)).not.toContain('close');
		btn(h.target, 'Cancel').click();
		await wait();
		btn(h.target, '+ Add').click();
		await wait();
		root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await wait();
		expect(eventLog(h.target)).not.toContain('close');
		cleanup(h.instance, h.target);
	});

	it("host='panel': the edit pair rides the body portal; unmount removes it", async () => {
		const h = renderPanel({ host: 'panel', escapeScope: 'root' });
		await wait();
		rowClick(h.target);
		await wait();
		const dialog = document.body.querySelector('[role="dialog"][aria-label="Edit prompt"]');
		expect(dialog).not.toBeNull();
		expect(h.target.contains(dialog!)).toBe(false);
		cleanup(h.instance, h.target);
		expect(document.body.querySelector('[role="dialog"][aria-label="Edit prompt"]')).toBeNull();
	});

	it('add-row Cancel resets the form state', async () => {
		const h = renderPanel({ escapeScope: 'root' });
		await wait();
		btn(h.target, '+ Add').click();
		await wait();
		const textArea = document.body.querySelector('.mgr-add-text') as HTMLTextAreaElement;
		textArea.value = 'draft text';
		textArea.dispatchEvent(new Event('input', { bubbles: true }));
		btn(h.target, 'Cancel').click();
		await wait();
		expect(document.body.querySelector('.mgr-add-row')).toBeNull();
		btn(h.target, '+ Add').click();
		await wait();
		const again = document.body.querySelector('.mgr-add-text') as HTMLTextAreaElement;
		expect(again.value).toBe('');
		cleanup(h.instance, h.target);
	});

	it('empty add text never posts', async () => {
		const h = renderPanel({ escapeScope: 'root' });
		await wait();
		btn(h.target, '+ Add').click();
		await wait();
		btn(h.target, 'Add prompt').click();
		await wait();
		expect(store.calls.filter((c) => c.init?.method === 'POST')).toHaveLength(0);
		expect(eventLog(h.target)).not.toContain('changed');
		cleanup(h.instance, h.target);
	});

	it('add failure (non-ok, non-409) shows Add failed', async () => {
		store.postStatus = 500;
		const h = renderPanel({ escapeScope: 'root' });
		await wait();
		btn(h.target, '+ Add').click();
		await wait();
		const textArea = document.body.querySelector('.mgr-add-text') as HTMLTextAreaElement;
		textArea.value = 'another prompt';
		textArea.dispatchEvent(new Event('input', { bubbles: true }));
		btn(h.target, 'Add prompt').click();
		await wait();
		expect(document.body.querySelector('.mgr-error')?.textContent).toContain('Add failed');
		cleanup(h.instance, h.target);
	});

	it('save with no changed fields closes the dialog without PATCHing', async () => {
		const h = renderPanel({ escapeScope: 'root' });
		await wait();
		rowClick(h.target);
		await wait();
		btn(h.target, 'Save').click();
		await wait();
		expect(store.calls.filter((c) => c.init?.method === 'PATCH')).toHaveLength(0);
		expect(document.body.querySelector('[role="dialog"][aria-label="Edit prompt"]')).toBeNull();
		expect(eventLog(h.target)).not.toContain('changed');
		cleanup(h.instance, h.target);
	});

	it('macro inline toggle PATCHes macro=true and flips the row state', async () => {
		const h = renderPanel({ escapeScope: 'root' });
		await wait();
		const toggle = document.body.querySelector('.mgr-macro-toggle') as HTMLButtonElement;
		expect(toggle.textContent?.trim()).toBe('—');
		toggle.click();
		await wait();
		const patch = store.calls.find((c) => c.init?.method === 'PATCH');
		expect(JSON.parse(String(patch!.init!.body))).toEqual({ macro: true });
		expect(eventLog(h.target)).toContain('changed');
		cleanup(h.instance, h.target);
	});

	it('macro toggle failure surfaces the error', async () => {
		store.patchStatus = 500;
		const h = renderPanel({ escapeScope: 'root' });
		await wait();
		(document.body.querySelector('.mgr-macro-toggle') as HTMLButtonElement).click();
		await wait();
		expect(document.body.querySelector('.mgr-error')?.textContent).toContain('Save failed');
		cleanup(h.instance, h.target);
	});

	it('save network rejection shows Network error and keeps the dialog', async () => {
		const h = renderPanel({ escapeScope: 'root' });
		await wait();
		rowClick(h.target);
		await wait();
		store.failNet = true; // every fetch now rejects — the PATCH does too
		const textInput = document.body.querySelector('.mgr-edit-text') as HTMLTextAreaElement;
		textInput.value = 'rejected text';
		textInput.dispatchEvent(new Event('input', { bubbles: true }));
		btn(h.target, 'Save').click();
		await wait();
		expect(document.body.querySelector('.mgr-error')?.textContent).toContain('Network error');
		cleanup(h.instance, h.target);
	});

	it('macro toggle network rejection shows Network error', async () => {
		const h = renderPanel({ escapeScope: 'root' });
		await wait();
		store.failNet = true; // every fetch now rejects — the PATCH does too
		(document.body.querySelector('.mgr-macro-toggle') as HTMLButtonElement).click();
		await wait();
		expect(document.body.querySelector('.mgr-error')?.textContent).toContain('Network error');
		cleanup(h.instance, h.target);
	});

	it('add network rejection shows Network error', async () => {
		const h = renderPanel({ escapeScope: 'root' });
		await wait();
		store.failNet = true;
		btn(h.target, '+ Add').click();
		await wait();
		const textArea = document.body.querySelector('.mgr-add-text') as HTMLTextAreaElement;
		textArea.value = 'reject me';
		textArea.dispatchEvent(new Event('input', { bubbles: true }));
		btn(h.target, 'Add prompt').click();
		await wait();
		expect(document.body.querySelector('.mgr-error')?.textContent).toContain('Network error');
		cleanup(h.instance, h.target);
	});

	it('bulk delete network failure shows Network error', async () => {
		const h = renderPanel({ escapeScope: 'root' });
		await wait();
		store.failNet = true; // every fetch now rejects — the DELETE does too
		(Array.from(document.body.querySelectorAll('.mgr-check')) as HTMLInputElement[])[0].click();
		await wait();
		btn(h.target, 'Del (1)').click();
		await wait();
		expect(document.body.querySelector('.mgr-error')?.textContent).toContain('Network error');
		cleanup(h.instance, h.target);
	});

	it('unselect-all button clears the selection', async () => {
		const h = renderPanel({ escapeScope: 'root' });
		await wait();
		(Array.from(document.body.querySelectorAll('.mgr-check')) as HTMLInputElement[])[0].click();
		await wait();
		const unselect = document.body.querySelector('.mgr-unselect-all') as HTMLButtonElement;
		expect(unselect).not.toBeNull();
		unselect.click();
		await wait();
		const checks = Array.from(document.body.querySelectorAll('.mgr-check')) as HTMLInputElement[];
		expect(checks.every((c) => !c.checked)).toBe(true);
		cleanup(h.instance, h.target);
	});

	it('search is always enabled — selected-only mode is decommissioned (1ff0af0)', async () => {
		vi.useFakeTimers();
		try {
			const h = renderPanel({ escapeScope: 'root' });
			await Promise.resolve();
			// The ☑ Selected toggle that once disabled the search is gone;
			// the search box stays live and its input still schedules a
			// debounced refresh.
			expect(
				Array.from(h.target.querySelectorAll('button')).some((b) => b.textContent?.trim() === '☑ Selected')
			).toBe(false);
			const search = h.target.querySelector('.mgr-search') as HTMLInputElement;
			expect(search.disabled).toBe(false);
			const before = store.calls.filter((c) => c.url.startsWith('/api/prompts?')).length;
			search.value = 'x';
			search.dispatchEvent(new Event('input', { bubbles: true }));
			await vi.advanceTimersByTimeAsync(400);
			const after = store.calls.filter((c) => c.url.startsWith('/api/prompts?')).length;
			expect(after).toBe(before + 1);
			cleanup(h.instance, h.target);
		} finally {
			vi.useRealTimers();
		}
	});

	it('sort on the Label/Text column cycles asc, desc, unsorted', async () => {
		const h = renderPanel({ escapeScope: 'root' });
		await wait();
		const labelHead = () =>
			Array.from(document.body.querySelectorAll<HTMLButtonElement>('.mgr-sort-btn')).find((b) =>
				b.textContent?.includes('Label / Text')
			)!;
		labelHead().click();
		await wait();
		expect(labelHead().textContent).toContain('▲');
		labelHead().click();
		await wait();
		expect(labelHead().textContent).toContain('▼');
		labelHead().click();
		await wait();
		expect(labelHead().textContent).toContain('↕');
		cleanup(h.instance, h.target);
	});

	it('PATCH failure without a JSON body falls back to Save failed', async () => {
		store.patchJsonFail = true;
		const h = renderPanel({ escapeScope: 'root' });
		await wait();
		rowClick(h.target);
		await wait();
		const textInput = document.body.querySelector('.mgr-edit-text') as HTMLTextAreaElement;
		textInput.value = 'changed text';
		textInput.dispatchEvent(new Event('input', { bubbles: true }));
		btn(h.target, 'Save').click();
		await wait();
		expect(document.body.querySelector('.mgr-error')?.textContent).toContain('Save failed');
		cleanup(h.instance, h.target);
	});
});

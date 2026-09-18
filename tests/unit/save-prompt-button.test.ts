/**
 * save-prompt-button tests (task 3.2-T; The Prompt Tags W4 4.1-T — the D6
 * popup: trigger opens, Save runs the machine): saved / duplicate / check-race-409
 * / error states via stubbed fetch; disabled on empty text.
 *
 * Fetch is stubbed at the global seam (the API is the boundary). The 2.6 s
 * note tooltip is asserted via the title attribute before expiry (fake
 * timers where determinism matters).
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SavePromptButton from '$lib/components/common/buttons/SavePromptButton.svelte';
import Host from './SavePromptButtonHost.svelte';
import { appConfig } from '$lib/services/config/app-config.svelte';

function json(b: unknown, status = 200): Response {
	return new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
}

let fetchMock: ReturnType<typeof vi.fn>;
const calls = () => fetchMock.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
	document.body.innerHTML = '';
});

function mountBtn(text = 'load project AIP, OCI') {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(SavePromptButton, { target, props: { text } });
	flushSync();
	const btn = () => target.querySelector('[data-testid="save-prompt-button"]') as HTMLButtonElement;
	const cleanup = () => {
		unmount(comp);
		target.remove();
	};
	return { btn, cleanup };
}

/** The Prompt Tags D6: the trigger click OPENS the popup; the popup's
 *  Save runs the original check-then-POST machine. Let the two chained
 *  fetches settle (check → POST). */
async function clickAndSettle(btn: HTMLButtonElement) {
	btn.click();
	flushSync();
	const confirm = document.body.querySelector('[data-testid="save-prompt-confirm"]') as HTMLButtonElement;
	confirm.click();
	for (let i = 0; i < 12; i++) {
		await Promise.resolve();
	}
	flushSync();
}

describe('SavePromptButton — idle + disabled', () => {
	it('renders the bookmark icon with the default title, disabled on empty text', () => {
		const h = mountBtn('');
		expect(h.btn().disabled).toBe(true); // empty text never saves
		expect(h.btn().getAttribute('title')).toBe('Save prompt');
		h.cleanup();
	});

	it('enabled when text is non-empty; whitespace-only still disabled', () => {
		const h = mountBtn('   ');
		expect(h.btn().disabled).toBe(true);
		h.cleanup();
	});
});

describe('SavePromptButton — saved state', () => {
	it('check misses → POSTs → check icon + note tooltip', async () => {
		fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.startsWith('/api/prompts?q=')) return json({ results: [] }); // exact check: miss
			if (url === '/api/prompts') return json({ record: { id: 99 } }, 201);
			return json({});
		});
		const h = mountBtn();
		await clickAndSettle(h.btn());
		// GET check with the exact text, then POST
		expect(calls()[0]).toContain('/api/prompts?q=load%20project%20AIP%2C%20OCI&limit=1');
		const post = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/prompts');
		expect(post?.[1]).toMatchObject({ method: 'POST' });
		// D6: tags rides the body additively — [] when the popup picks nothing
		expect(JSON.parse(String(post?.[1]?.body))).toEqual({ text: 'load project AIP, OCI', tags: [] });
		// saved: svg present (Check icon), note tooltip
		expect(h.btn().querySelector('svg')).not.toBeNull();
		expect(h.btn().getAttribute('title')).toBe('prompt saved');
		h.cleanup();
	});
});

describe('SavePromptButton — duplicate state', () => {
	it('check HITS (exact text) → no POST, duplicate note', async () => {
		fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.startsWith('/api/prompts?q='))
				return json({ results: [{ text: 'load project AIP, OCI' }] }); // exact hit
			return json({});
		});
		const h = mountBtn();
		await clickAndSettle(h.btn());
		expect(calls()).toHaveLength(1); // GET only — never POSTed
		expect(h.btn().getAttribute('title')).toBe('already in the prompt library');
		h.cleanup();
	});

	it('near-miss text is NOT a duplicate (exact-text match only) → POSTs', async () => {
		fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.startsWith('/api/prompts?q='))
				return json({ results: [{ text: 'load project AIP, OCI (variant)' }] }); // different text
			if (url === '/api/prompts') return json({ record: {} }, 201);
			return json({});
		});
		const h = mountBtn();
		await clickAndSettle(h.btn());
		expect(calls().some((u) => u === '/api/prompts')).toBe(true); // POSTed
		expect(h.btn().getAttribute('title')).toBe('prompt saved');
		h.cleanup();
	});
});

describe('SavePromptButton — 409 race + errors', () => {
	it('check misses but POST 409s (lost race) → duplicate note, same UX', async () => {
		fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.startsWith('/api/prompts?q=')) return json({ results: [] });
			if (url === '/api/prompts') return json({ error: 'Duplicate' }, 409);
			return json({});
		});
		const h = mountBtn();
		await clickAndSettle(h.btn());
		expect(h.btn().getAttribute('title')).toBe('already in the prompt library');
		h.cleanup();
	});

	it('POST non-ok → error note', async () => {
		fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.startsWith('/api/prompts?q=')) return json({ results: [] });
			if (url === '/api/prompts') return json({ error: 'Failed to create prompt' }, 500);
			return json({});
		});
		const h = mountBtn();
		await clickAndSettle(h.btn());
		expect(h.btn().getAttribute('title')).toBe('save failed');
		h.cleanup();
	});

	it('network rejection → error note (silent degrade — never throws)', async () => {
		fetchMock.mockRejectedValue(new Error('offline'));
		const h = mountBtn();
		await clickAndSettle(h.btn());
		expect(h.btn().getAttribute('title')).toBe('network error');
		h.cleanup();
	});
});

describe('SavePromptButton — note expiry', () => {
	it('note clears after 2.6 s and the button returns to idle', async () => {
		vi.useFakeTimers();
		fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.startsWith('/api/prompts?q=')) return Promise.resolve(json({ results: [] }));
			if (url === '/api/prompts') return Promise.resolve(json({ record: {} }, 201));
			return Promise.resolve(json({}));
		});
		const h = mountBtn();
		h.btn().click(); // opens the popup
		flushSync();
		(document.body.querySelector('[data-testid="save-prompt-confirm"]') as HTMLButtonElement).click();
		await vi.advanceTimersByTimeAsync(10); // let the fetch chain settle under fake timers
		flushSync();
		expect(h.btn().getAttribute('title')).toBe('prompt saved');
		await vi.advanceTimersByTimeAsync(2600);
		flushSync();
		expect(h.btn().getAttribute('title')).toBe('Save prompt'); // back to idle title
		h.cleanup();
	});

	it('double-click while checking never double-POSTs', async () => {
		let postCount = 0;
		fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.startsWith('/api/prompts?q=')) {
				await new Promise((r) => setTimeout(r, 30)); // slow check — widen the race
				return json({ results: [] });
			}
			if (url === '/api/prompts') {
				postCount++;
				return json({ record: {} }, 201);
			}
			return json({});
		});
		const h = mountBtn();
		h.btn().click(); // opens the popup
		flushSync();
		const confirm = () => document.body.querySelector('[data-testid="save-prompt-confirm"]') as HTMLButtonElement;
		confirm().click(); // → checking
		confirm().click(); // disabled while checking — the guard
		await new Promise((r) => setTimeout(r, 120));
		expect(postCount).toBe(1);
		h.cleanup();
	});
});

// ── The Prompt Tags (ADR 2026-09-14, D6) — Wave 4 popup contract ──────────

describe('SavePromptButton — the D6 popup', () => {
	it('the trigger click OPENS the popup (preview + chips + label) and does NOT save', async () => {
		fetchMock.mockImplementation(async () => json({}));
		const h = mountBtn();
		h.btn().click();
		flushSync();
		const popup = document.body.querySelector('[data-testid="save-prompt-popup"]');
		expect(popup).not.toBeNull();
		expect(popup!.querySelector('.save-prompt-preview')?.textContent).toContain('load project AIP, OCI');
		expect(popup!.querySelectorAll('.save-prompt-chip').length).toBeGreaterThan(0); // vocabulary chips render
		expect(calls().filter((u) => u.startsWith('/api/prompts'))).toHaveLength(0); // nothing saved yet
		h.cleanup();
	});

	it('the data-testid contract stays on the trigger', async () => {
		const h = mountBtn();
		expect(h.btn().getAttribute('data-testid')).toBe('save-prompt-button');
		h.cleanup();
	});

	it('chips toggle on and off; the POST body carries the picked tags', async () => {
		fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.startsWith('/api/prompts?q=')) return json({ results: [] });
			if (url === '/api/prompts') return json({ record: {} }, 201);
			return json({});
		});
		const h = mountBtn();
		h.btn().click();
		flushSync();
		const popup = document.body.querySelector('[data-testid="save-prompt-popup"]')!;
		const chips = Array.from(popup.querySelectorAll<HTMLButtonElement>('.save-prompt-chip'));
		const git = chips.find((c) => c.textContent?.trim() === 'git')!;
		const rca = chips.find((c) => c.textContent?.trim() === 'rca')!;
		git.click();
		rca.click();
		rca.click(); // toggle back off
		flushSync();
		expect(git.getAttribute('aria-pressed')).toBe('true');
		expect(rca.getAttribute('aria-pressed')).toBe('false');
		(document.body.querySelector('[data-testid="save-prompt-confirm"]') as HTMLButtonElement).click();
		for (let i = 0; i < 12; i++) await Promise.resolve();
		flushSync();
		const post = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/prompts');
		expect(JSON.parse(String(post?.[1]?.body))).toEqual({ text: 'load project AIP, OCI', tags: ['git'] });
		h.cleanup();
	});

	it('saving with zero picked tags POSTs tags: [] (the old one-click flow still saves)', async () => {
		fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.startsWith('/api/prompts?q=')) return json({ results: [] });
			if (url === '/api/prompts') return json({ record: {} }, 201);
			return json({});
		});
		const h = mountBtn();
		await clickAndSettle(h.btn()); // open + Save, no chips touched
		const post = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/prompts');
		expect(JSON.parse(String(post?.[1]?.body))).toEqual({ text: 'load project AIP, OCI', tags: [] });
		expect(h.btn().getAttribute('title')).toBe('prompt saved');
		h.cleanup();
	});

	it('a non-empty label rides the POST body; empty label is omitted', async () => {
		fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.startsWith('/api/prompts?q=')) return json({ results: [] });
			if (url === '/api/prompts') return json({ record: {} }, 201);
			return json({});
		});
		const h = mountBtn();
		h.btn().click();
		flushSync();
		const labelInput = document.body.querySelector('.save-prompt-label') as HTMLInputElement;
		labelInput.value = 'AIP loader';
		labelInput.dispatchEvent(new Event('input', { bubbles: true }));
		(document.body.querySelector('[data-testid="save-prompt-confirm"]') as HTMLButtonElement).click();
		for (let i = 0; i < 12; i++) await Promise.resolve();
		flushSync();
		const post = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/prompts');
		expect(JSON.parse(String(post?.[1]?.body))).toEqual({ text: 'load project AIP, OCI', label: 'AIP loader', tags: [] });
		h.cleanup();
	});

	it('Cancel closes the popup without any request', async () => {
		fetchMock.mockImplementation(async () => json({}));
		const h = mountBtn();
		h.btn().click();
		flushSync();
		(Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Cancel') as HTMLButtonElement).click();
		flushSync();
		expect(document.body.querySelector('[data-testid="save-prompt-popup"]')).toBeNull();
		expect(calls().filter((u) => u.startsWith('/api/prompts'))).toHaveLength(0);
		h.cleanup();
	});

	it('the duplicate path closes the popup and shows the note on the trigger (machine unchanged)', async () => {
		fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.startsWith('/api/prompts?q=')) return json({ results: [{ text: 'load project AIP, OCI' }] });
			return json({});
		});
		const h = mountBtn();
		await clickAndSettle(h.btn());
		expect(document.body.querySelector('[data-testid="save-prompt-popup"]')).toBeNull(); // closed
		expect(h.btn().getAttribute('title')).toBe('already in the prompt library');
		h.cleanup();
	});
});

// ── Branch-completion sweep: every remaining reachable guard arm ──────────

describe('SavePromptButton — branch completion (guards + arms)', () => {
	it('class prop lands on the wrap span (non-empty class arm)', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(SavePromptButton, { target, props: { text: 'x', class: 'extra-class' } });
		flushSync();
		expect(target.querySelector('span.save-prompt-wrap')!.className).toContain('extra-class');
		unmount(comp);
		target.remove();
	});

	it('clicking the trigger again toggles the popup CLOSED (if (open) reset arm skipped)', () => {
		const h = mountBtn();
		h.btn().click();
		flushSync();
		expect(document.body.querySelector('[data-testid="save-prompt-popup"]')).not.toBeNull();
		h.btn().click(); // second click: open → false, the `if (open)` body is skipped
		flushSync();
		expect(document.body.querySelector('[data-testid="save-prompt-popup"]')).toBeNull();
		h.cleanup();
	});

	it('trigger click while checking is a no-op (togglePopup checking guard)', async () => {
		fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.startsWith('/api/prompts?q=')) {
				await new Promise((r) => setTimeout(r, 40)); // hold checking open
				return json({ results: [] });
			}
			if (url === '/api/prompts') return json({ record: {} }, 201);
			return json({});
		});
		const h = mountBtn();
		h.btn().click();
		flushSync();
		(document.body.querySelector('[data-testid="save-prompt-confirm"]') as HTMLButtonElement).click();
		flushSync(); // saveState === 'checking' now, popup still open
		h.btn().click(); // togglePopup: checking guard returns BEFORE toggling
		flushSync();
		expect(document.body.querySelector('[data-testid="save-prompt-popup"]')).not.toBeNull();
		await new Promise((r) => setTimeout(r, 120)); // let the save finish
		h.cleanup();
	});

	it('togglePopup empty-text guard: whitespace text never opens the popup', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(SavePromptButton, { target, props: { text: '   ' } });
		flushSync();
		const btn = target.querySelector('[data-testid="save-prompt-button"]') as HTMLButtonElement;
		// disabled buttons swallow .click(); a dispatched event reaches the handler
		btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(document.body.querySelector('[data-testid="save-prompt-popup"]')).toBeNull();
		unmount(comp);
		target.remove();
	});

	it('save empty-text guard: whitespace text reaches save() and returns before checking', async () => {
		// $state runes don't compile in plain .ts — a reactive host fixture
		// (PromptManagerAddHost pattern) flips text to whitespace mid-flight.
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(Host, { target });
		flushSync();
		(target.querySelector('[data-testid="save-prompt-button"]') as HTMLButtonElement).click();
		flushSync(); // popup open while text was non-empty
		(target.querySelector('[data-testid="host-set-empty"]') as HTMLButtonElement).click();
		flushSync(); // text goes whitespace AFTER the popup opened
		(document.body.querySelector('[data-testid="save-prompt-confirm"]') as HTMLButtonElement).click();
		flushSync();
		expect(fetchMock).not.toHaveBeenCalled(); // !trimmed guard returned first
		unmount(comp);
		target.remove();
	});

	it('empty vocabulary: the chips group is skipped (vocabulary.length > 0 false arm)', () => {
		const before = appConfig().prompts.tags;
		appConfig().prompts.tags = []; // the shared $state proxy accepts the mutation
		try {
			const h = mountBtn();
			h.btn().click();
			flushSync();
			const popup = document.body.querySelector('[data-testid="save-prompt-popup"]')!;
			expect(popup.querySelector('.save-prompt-chips')).toBeNull(); // chips group skipped
			expect(popup.querySelector('.save-prompt-label')).not.toBeNull(); // label still renders
			h.cleanup();
		} finally {
			appConfig().prompts.tags = before;
		}
	});

	it('non-ok exact-check response → data null → treated as a miss, still POSTs', async () => {
		fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.startsWith('/api/prompts?q=')) return json({ error: 'boom' }, 500); // res.ok false → data = null
			if (url === '/api/prompts') return json({ record: {} }, 201);
			return json({});
		});
		const h = mountBtn();
		await clickAndSettle(h.btn());
		expect(calls().some((u) => u === '/api/prompts')).toBe(true);
		expect(h.btn().getAttribute('title')).toBe('prompt saved');
		h.cleanup();
	});

	it('a second note within 2.6 s clears the previous timer (showNote noteTimer arm)', async () => {
		fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.startsWith('/api/prompts?q=')) return json({ results: [] });
			if (url === '/api/prompts') return json({ record: {} }, 201);
			return json({});
		});
		const h = mountBtn();
		await clickAndSettle(h.btn()); // first save → showNote (no prior timer)
		expect(h.btn().getAttribute('title')).toBe('prompt saved');
		await clickAndSettle(h.btn()); // second save within 2.6 s → showNote hits the clearTimeout arm
		expect(h.btn().getAttribute('title')).toBe('prompt saved');
		h.cleanup();
	});

	it('clicking the label input exercises its stopPropagation handler', () => {
		const h = mountBtn();
		h.btn().click();
		flushSync();
		const labelInput = document.body.querySelector('.save-prompt-label') as HTMLInputElement;
		labelInput.click(); // onclick={(e) => e.stopPropagation()}
		flushSync();
		expect(document.body.querySelector('[data-testid="save-prompt-popup"]')).not.toBeNull();
		h.cleanup();
	});
});

/**
 * Reload button feedback (2026-09-22 bug fix): while the reload
 * round-trips the button shows the loading state, on success a done
 * state for 5s, then it returns to idle — the same feedback the
 * "/dsi-skills --reload" macro gives through its note.
 */
import { flushSync, mount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsSkillsPanelHost from './SettingsSkillsPanelHost.svelte';

const SNAP = {
	ok: true,
	reused: true,
	uninstallable: [],
	snapshot: {
		generatedAt: '2026-09-22T00:00:00Z',
		sources: [
			{ id: 'pstack', author: 'L', repo: 'r', skills: [{ n: '1.1', id: 'a', path: 'p', tier: null, installed: false, signed: false, installedFrom: null }] }
		]
	}
};

function jsonRes(body: unknown): Response {
	return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

function state(target: HTMLElement): string | null {
	return target.querySelector('[data-testid="shelf-reload"]')?.getAttribute('data-reload-state') ?? null;
}

async function mountAndOpen(responses: Array<Promise<Response>>): Promise<HTMLElement> {
	const queue = [...responses];
	vi.stubGlobal('fetch', vi.fn(() => queue.shift() ?? Promise.resolve(jsonRes(SNAP))));
	const target = document.createElement('div');
	document.body.appendChild(target);
	mount(SettingsSkillsPanelHost, { target });
	flushSync();
	await vi.waitFor(() => {
		expect(target.querySelector('[data-testid="shelf-reload"]')).not.toBeNull();
	});
	return target;
}

it('reload walks idle -> loading -> done -> idle (5s)', { timeout: 15000 }, async () => {
	let resolveReload: (r: Response) => void = () => {};
	const reloadPromise = new Promise<Response>((r) => (resolveReload = r));
	const target = await mountAndOpen([Promise.resolve(jsonRes(SNAP)), reloadPromise]);

	const button = target.querySelector<HTMLButtonElement>('[data-testid="shelf-reload"]')!;
	button.click();
	flushSync();
	expect(state(target)).toBe('loading');
	expect(button.disabled).toBe(true);

	resolveReload(jsonRes({ ...SNAP, reused: false }));
	await vi.waitFor(() => {
		expect(state(target)).toBe('done');
	});
	expect(button.disabled).toBe(false);

	// the done window lasts 5s, then the button returns to idle
	await vi.waitFor(
		() => {
			expect(state(target)).toBe('idle');
		},
		{ timeout: 7000 }
	);
});

it('a failed reload returns straight to idle with the error note', async () => {
	const target = await mountAndOpen([
		Promise.resolve(jsonRes(SNAP)),
		Promise.resolve(jsonRes({ ok: false, error: 'snapshot rebuild failed (503)' }))
	]);
	const button = target.querySelector<HTMLButtonElement>('[data-testid="shelf-reload"]')!;
	button.click();
	flushSync();
	await vi.waitFor(() => {
		expect(state(target)).toBe('idle');
	});
	expect(target.querySelector('[data-testid="shelf-note"]')?.textContent).toContain('503');
});

// Live harvest progress (2026-09-23): while the spinner is up the
// button polls /api/skills/progress and renders {done}/{total}; the
// counter is absent at idle and when the engine reports no run.
it('the spinner renders the harvest counter {done}/{total} while loading', { timeout: 8000 }, async () => {
	vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes('/api/skills/progress')) {
			return Promise.resolve(jsonRes({ ok: true, running: true, done: 2, total: 7, skillDone: 400, skillTotal: 903 }));
		}
		if (url.includes('/api/skills/reload')) return new Promise<Response>(() => {}); // hold the spinner up
		return Promise.resolve(jsonRes(SNAP));
	}));
	const target = document.createElement('div');
	document.body.appendChild(target);
	mount(SettingsSkillsPanelHost, { target });
	flushSync();
	await vi.waitFor(() => {
		expect(target.querySelector('[data-testid="shelf-reload"]')).not.toBeNull();
	});
	// idle: no counter
	expect(target.querySelector('[data-testid="shelf-reload-progress"]')).toBeNull();
	(target.querySelector<HTMLButtonElement>('[data-testid="shelf-reload"]')!).click();
	flushSync();
	expect(state(target)).toBe('loading');
	// the first 1s poll lands the counter
	await vi.waitFor(
		() => {
			expect(target.querySelector('[data-testid="shelf-reload-progress"]')?.textContent)?.toContain('2/7');
		expect(target.querySelector('[data-testid="shelf-reload-progress"]')?.textContent)?.toContain('400/903');
		},
		{ timeout: 4000 }
	);
});
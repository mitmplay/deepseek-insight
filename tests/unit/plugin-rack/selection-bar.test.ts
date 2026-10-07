/**
 * Task 3.3-T — the shelf selection grammar on the rack: install-tab rows
 * are selectable; a sticky bottom bar renders Install with the selected
 * count; a successful apply POSTs the selected targets in ONE request,
 * clears the selection and reloads the snapshot.
 */
import { flushSync } from 'svelte';
import { mount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PluginRackPanelHost from '../PluginRackPanelHost.svelte';

const SNAP = {
	ok: true,
	reused: true,
	snapshot: {
		generatedAt: '2026-10-07T00:00:00Z',
		profile: 'web',
		sources: [{ id: 'x/garden', author: null, repo: 'link:/x', plugins: [
			{ n: '1', id: 'preset-a', group: 'owned', repo: 'link:/x/a', description: 'A', version: '1.0.0', installed: false },
			{ n: '2', id: 'preset-b', group: 'owned', repo: 'link:/x/b', description: 'B', version: '1.0.0', installed: false },
			{ n: '3', id: 'preset-installed', group: 'owned', repo: 'link:/x/c', installed: true }
		] }],
		plugins: [
			{ n: '1', id: 'preset-a', group: 'owned', repo: 'link:/x/a', description: 'A', version: '1.0.0', installed: false },
			{ n: '2', id: 'preset-b', group: 'owned', repo: 'link:/x/b', description: 'B', version: '1.0.0', installed: false },
			{ n: '3', id: 'preset-installed', group: 'owned', repo: 'link:/x/c', installed: true }
		]
	},
	stars: {}
};

function stubFetch(impl: (input: string, init?: RequestInit) => Promise<Response>): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn(impl);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function mountPanel() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(PluginRackPanelHost, { target });
	flushSync();
	return { target, instance };
}

const jsonRes = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('selection bar (shelf grammar, 3.3)', () => {
	it('selecting rows updates the count; installed rows are not selectable', async () => {
		stubFetch((input) => (String(input).includes('/api/plugins/snapshot') ? Promise.resolve(jsonRes(SNAP)) : Promise.reject(new Error('unexpected'))));
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows-x-garden"]')).toBeTruthy());
		expect(target.querySelector('[data-testid="rack-install"]')?.textContent).toContain('(0)');
		(target.querySelector('[data-testid="rack-select-1"]') as HTMLButtonElement).click();
		flushSync();
		expect(target.querySelector('[data-testid="rack-install"]')?.textContent).toContain('(1)');
		(target.querySelector('[data-testid="rack-select-2"]') as HTMLButtonElement).click();
		flushSync();
		expect(target.querySelector('[data-testid="rack-install"]')?.textContent).toContain('(2)');
		// installed rows render no select control
		expect(target.querySelector('[data-testid="rack-select-3"]')).toBeNull();
		// toggle off
		(target.querySelector('[data-testid="rack-select-1"]') as HTMLButtonElement).click();
		flushSync();
		expect(target.querySelector('[data-testid="rack-install"]')?.textContent).toContain('(1)');
	});

	it('the bar disables at zero selection', async () => {
		stubFetch((input) => (String(input).includes('/api/plugins/snapshot') ? Promise.resolve(jsonRes(SNAP)) : Promise.reject(new Error('unexpected'))));
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-install"]')).toBeTruthy());
		expect((target.querySelector('[data-testid="rack-install"]') as HTMLButtonElement).disabled).toBe(true);
	});

	it('a successful apply POSTs the selected targets in ONE request, clears the selection and reloads', async () => {
		const fetchMock = stubFetch((input, init) => {
			if (String(input).includes('/api/plugins/apply')) {
				return Promise.resolve(jsonRes({ ok: true, results: [] }));
			}
			return String(input).includes('/api/plugins/snapshot')
				? Promise.resolve(jsonRes(SNAP))
				: Promise.reject(new Error('unexpected'));
		});
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-select-1"]')).toBeTruthy());
		(target.querySelector('[data-testid="rack-select-1"]') as HTMLButtonElement).click();
		(target.querySelector('[data-testid="rack-select-2"]') as HTMLButtonElement).click();
		flushSync();
		(target.querySelector('[data-testid="rack-install"]') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-install"]')?.textContent).toContain('(0)'));
		const applyCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/plugins/apply'));
		expect(applyCalls).toHaveLength(1); // ONE request for all selected rows
		const body = JSON.parse(String(applyCalls[0][1]?.body));
		expect(body.action).toBe('install');
		expect([...body.targets].sort()).toEqual(['1', '2']);
	});
});

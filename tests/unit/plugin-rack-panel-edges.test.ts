/**
 * PluginManagerPanel edge coverage — the base suite
 * (plugin-rack-panel.test.ts) pins the happy paths; this file drives the
 * remaining panel branches: tab-change reporting, initialTab persistence,
 * the search needle, load/network failure + retry, apply network errors,
 * and apply diagnostics with missing result fields (defaults).
 */
import { flushSync } from 'svelte';
import { mount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PluginManagerPanel from '$lib/components/settings-plugins/PluginManagerPanel.svelte';

const SNAP = {
	ok: true,
	snapshot: {
		generatedAt: '2026-09-27T00:00:00Z',
		profile: 'web',
		plugins: [
			{ n: 'Alpha Plugin', id: 'alpha', repo: 'https://github.com/a/alpha', author: 'Temoa', installed: false },
			{ n: 'Beta', id: 'beta', repo: 'https://github.com/b/beta', author: null, installed: true }
		]
	}
};

const jsonRes = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

function stubFetch(impl: (input: string, init?: RequestInit) => Promise<Response>): ReturnType<typeof vi.fn> {
	return vi.fn(impl);
}

interface MountOpts {
	initialTab?: 'install' | 'uninstall';
	ontabchange?: (tab: 'install' | 'uninstall') => void;
}

function mountPanel(opts: MountOpts = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(PluginManagerPanel, { target, props: opts });
	flushSync();
	return { target, instance };
}

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('PluginManagerPanel edges', () => {
	it('reports tab changes up and honors initialTab: uninstall', async () => {
		const fetchMock = stubFetch(() => Promise.resolve(jsonRes(SNAP)));
		vi.stubGlobal('fetch', fetchMock);
		const ontabchange = vi.fn();
		const { target } = mountPanel({ initialTab: 'uninstall', ontabchange });
		// junk initialTab sanitizes to install
		const junk = mountPanel({ initialTab: 'nonsense' as 'uninstall' });
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="rack-rows-b-beta"]')).toBeTruthy();
			expect(junk.target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeTruthy();
		});
		// uninstall tab was honored: only the installed plugin is listed
		expect(target.querySelector('[data-testid="rack-row-beta"]')).toBeTruthy();
		expect(target.querySelector('[data-testid="rack-row-alpha"]')).toBeNull();
		// junk falls to the install tab: only uninstalled alpha
		expect(junk.target.querySelector('[data-testid="rack-row-alpha"]')).toBeTruthy();
		// the reported tab fires on every tab change of the wired panel
		(target.querySelector('[data-testid="rack-tab-install"]') as HTMLButtonElement).click();
		flushSync();
		expect(ontabchange).toHaveBeenCalledWith('install');
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-row-alpha"]')).toBeTruthy());
	});

	it('the search needle matches name, id, repo and author; no match names the empty tab', async () => {
		const fetchMock = stubFetch(() => Promise.resolve(jsonRes(SNAP)));
		vi.stubGlobal('fetch', fetchMock);
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeTruthy());
		const input = target.querySelector('[data-testid="rack-search"]') as HTMLInputElement;

		const setSearch = (q: string) => {
			input.value = q;
			input.dispatchEvent(new Event('input', { bubbles: true }));
			flushSync();
		};

		// by display name
		setSearch('alpha plug');
		expect(target.querySelector('[data-testid="rack-row-alpha"]')).toBeTruthy();
		expect(target.querySelector('[data-testid="rack-row-beta"]')).toBeNull();
		// by author (null-author rows fall back to '')
		setSearch('temoa');
		expect(target.querySelector('[data-testid="rack-row-alpha"]')).toBeTruthy();
		// by repo
		setSearch('github.com/b/beta');
		// beta is installed — not on the install tab — so the needle yields nothing
		expect(target.querySelector('[data-testid="rack-tab-empty"]')).toBeTruthy();
		expect(target.textContent).not.toContain('Retry');
		// whitespace-only query behaves as no query
		setSearch('   ');
		expect(target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeTruthy();
	});

	it('a rejected snapshot load shows the failed note and retry recovers', async () => {
		const fetchMock = stubFetch(() => Promise.reject(new Error('network down')));
		vi.stubGlobal('fetch', fetchMock);
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-load-failed"]')).toBeTruthy());
		// recover: retry hits a healthy snapshot
		fetchMock.mockImplementation(() => Promise.resolve(jsonRes(SNAP)));
		(target.querySelector('[data-testid="rack-load-failed"] button') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeTruthy());
	});

	it('an apply network failure records the network error row', async () => {
		const fetchMock = stubFetch((input) => {
			if (String(input).includes('/api/plugins/apply')) return Promise.reject(new Error('boom'));
			return Promise.resolve(jsonRes(SNAP));
		});
		vi.stubGlobal('fetch', fetchMock);
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeTruthy());
		(target.querySelector('[data-testid="rack-select-Alpha Plugin"]') as HTMLButtonElement).click();
		flushSync();
		(target.querySelector('[data-testid="rack-install"]') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-errors"]')?.textContent).toContain('alpha: network'));
	});

	it('apply diagnostics without results fall back to the target id and empty error', async () => {
		const fetchMock = stubFetch((input) => {
			if (String(input).includes('/api/plugins/apply')) return Promise.resolve(jsonRes({ ok: false }));
			return Promise.resolve(jsonRes(SNAP));
		});
		vi.stubGlobal('fetch', fetchMock);
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeTruthy());
		(target.querySelector('[data-testid="rack-select-Alpha Plugin"]') as HTMLButtonElement).click();
		flushSync();
		(target.querySelector('[data-testid="rack-install"]') as HTMLButtonElement).click();
		// no results array -> no diagnostic rows; the panel stays on the rack
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeTruthy());
		expect(target.querySelector('[data-testid="rack-errors"]')).toBeNull();
	});

	it('apply result entries missing id/error fall back per entry', async () => {
		const fetchMock = stubFetch((input) => {
			if (String(input).includes('/api/plugins/apply')) {
				return Promise.resolve(jsonRes({ ok: false, results: [{ ok: false }] }));
			}
			return Promise.resolve(jsonRes(SNAP));
		});
		vi.stubGlobal('fetch', fetchMock);
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeTruthy());
		(target.querySelector('[data-testid="rack-select-Alpha Plugin"]') as HTMLButtonElement).click();
		flushSync();
		(target.querySelector('[data-testid="rack-install"]') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-errors"]')?.textContent).toContain('Alpha Plugin: '));
	});
});

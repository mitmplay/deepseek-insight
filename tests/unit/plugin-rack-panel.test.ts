/**
 * Task 3.1-T — PluginManagerPanel: rows render from the snapshot fixture,
 * installed badge flips after an apply, uninstall affordance only on
 * installed rows (control matrix), dsh diagnostics relay verbatim into the
 * error rows (D6), the bounce banner announces the restart chain (D5).
 */
import { flushSync } from 'svelte';
import { mount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PluginRackPanelHost from './PluginRackPanelHost.svelte';

const SNAP = {
	ok: true,
	reused: true,
	snapshot: {
		generatedAt: '2026-09-27T00:00:00Z',
		profile: 'web',
		plugins: [
			{ n: '1', id: 'dsh-rules-paths', repo: 'https://github.com/Temoa/dsh-rules-paths', author: 'Temoa', authorUrl: 'https://github.com/Temoa', installed: false },
			{ n: '2', id: 'installed-plugin', repo: 'https://github.com/x/y', author: null, installed: true }
		]
	}
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

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

const jsonRes = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

describe('PluginManagerPanel', () => {
	it('install tab lists only uninstalled plugins, uninstall tab only installed ones', async () => {
		stubFetch((input) => (String(input).includes('/api/plugins/snapshot') ? Promise.resolve(jsonRes(SNAP)) : Promise.reject(new Error('unexpected'))));
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows"]')).toBeTruthy());
		expect(target.querySelector('[data-testid="rack-row-dsh-rules-paths"]')?.textContent).toContain('Temoa');
		expect(target.querySelector('[data-testid="rack-install-dsh-rules-paths"]')).toBeTruthy();
		// the installed plugin is NOT on the install tab
		expect(target.querySelector('[data-testid="rack-row-installed-plugin"]')).toBeNull();
		// switch to uninstall tab: only the installed plugin, with its verb
		(target.querySelector('[data-testid="rack-tab-uninstall"]') as HTMLButtonElement).click();
		flushSync();
		expect(target.querySelector('[data-testid="rack-uninstall-installed-plugin"]')).toBeTruthy();
		expect(target.querySelector('[data-testid="rack-row-dsh-rules-paths"]')).toBeNull();
	});

	it('installed badge marks installed rows only (uninstall tab)', async () => {
		stubFetch((input) => Promise.resolve(jsonRes(SNAP)));
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-tabs"]')).toBeTruthy());
		(target.querySelector('[data-testid="rack-tab-uninstall"]') as HTMLButtonElement).click();
		flushSync();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-badge-installed-plugin"]')).toBeTruthy());
		expect(target.querySelector('[data-testid="rack-badge-dsh-rules-paths"]')).toBeNull();
	});

	it('apply failure relays dsh diagnostics verbatim into error rows (D6)', async () => {
		const fetchMock = stubFetch((input) => {
			if (String(input).includes('/api/plugins/apply')) {
				return Promise.resolve(jsonRes({ ok: false, results: [{ id: 'dsh-rules-paths', ok: false, error: 'dsh plugin add failed (exit 3): allowBuilds hint verbatim' }] }));
			}
			return Promise.resolve(jsonRes(SNAP));
		});
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows"]')).toBeTruthy());
		(target.querySelector('[data-testid="rack-install-dsh-rules-paths"]') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-errors"]')?.textContent).toContain('allowBuilds hint verbatim'));
		const applyCall = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([u]) => String(u).includes('/api/plugins/apply'));
		expect(JSON.parse(String(applyCall?.[1]?.body))).toEqual({ action: 'install', targets: ['dsh-rules-paths'] });
	});

	it('a restarting apply announces the bounce banner, then the panel refreshes ITSELF (D5, no hard reload)', async () => {
		let snapshots = 0;
		stubFetch((input) => {
			if (String(input).includes('/api/plugins/apply')) return Promise.resolve(jsonRes({ ok: true, results: [{ id: 'dsh-rules-paths', ok: true }], restarting: true }));
			snapshots++;
			return Promise.resolve(jsonRes(SNAP));
		});
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows"]')).toBeTruthy());
		const before = snapshots;
		(target.querySelector('[data-testid="rack-install-dsh-rules-paths"]') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-bounce"]')).toBeTruthy());
		// The poll rides the bounce out (~BOUNCE_POLL_MS), then the panel
		// reloads its snapshot and the banner clears by itself.
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-bounce"]')).toBeNull(), { timeout: 10_000 });
		expect(snapshots).toBeGreaterThan(before);
	});


	it('the rack-reload verb REBUILDS via POST /api/plugins/reload, never a cached re-read', async () => {
		const REBUILT = { ...SNAP.snapshot, generatedAt: '2026-09-28T00:00:00Z', plugins: [{ ...SNAP.snapshot.plugins[0], installed: true }] };
		const fetchMock = stubFetch((input) => {
			if (String(input).includes('/api/plugins/reload')) return Promise.resolve(jsonRes({ ok: true, snapshot: REBUILT }));
			return Promise.resolve(jsonRes(SNAP));
		});
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-generated"]')?.textContent).toContain('2026-09-27'));
		(target.querySelector('[data-testid="rack-reload"]') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-generated"]')?.textContent).toContain('2026-09-28'));
		const reloadCall = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([u]) => String(u).includes('/api/plugins/reload'));
		expect(reloadCall?.[1]?.method).toBe('POST');
	});

describe('PluginManagerRackRow doors (Shelf Credentials grammar)', () => {
	it('renders the repo door and the author door with safe external anchors', async () => {
		stubFetch((input) => Promise.resolve(jsonRes(SNAP)));
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows"]')).toBeTruthy());
		const repoDoor = target.querySelector('[data-testid="rack-door-repo-dsh-rules-paths"]') as HTMLAnchorElement | null;
		expect(repoDoor?.href).toBe('https://github.com/Temoa/dsh-rules-paths');
		expect(repoDoor?.target).toBe('_blank');
		expect(repoDoor?.rel).toBe('noopener noreferrer');
		const authorDoor = target.querySelector('[data-testid="rack-door-author-dsh-rules-paths"]') as HTMLAnchorElement | null;
		expect(authorDoor?.href).toBe('https://github.com/Temoa');
		expect(authorDoor?.target).toBe('_blank');
	});
	it('a plugin without an author URL renders the repo door only', async () => {
		stubFetch((input) => Promise.resolve(jsonRes(SNAP)));
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows"]')).toBeTruthy());
		// installed-plugin lives on the uninstall tab and has no authorUrl
		(target.querySelector('[data-testid="rack-tab-uninstall"]') as HTMLButtonElement).click();
		flushSync();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-door-repo-installed-plugin"]')).toBeTruthy());
		expect(target.querySelector('[data-testid="rack-door-author-installed-plugin"]')).toBeNull();
	});
});

	it('a successful install MOVES the plugin to the uninstall tab', async () => {
		let installed = false;
		stubFetch((input) => {
			if (String(input).includes('/api/plugins/apply')) {
				installed = true;
				return Promise.resolve(jsonRes({ ok: true, results: [{ id: 'dsh-rules-paths', ok: true }], restarting: false }));
			}
			return Promise.resolve(jsonRes({
				ok: true,
				snapshot: { generatedAt: 't', profile: 'web', plugins: [
					{ n: '1', id: 'dsh-rules-paths', repo: 'r', author: 'Temoa', installed },
					{ n: '2', id: 'other', repo: 'r2', author: null, installed: false }
				] }
			}));
		});
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows"]')).toBeTruthy());
		(target.querySelector('[data-testid="rack-install-dsh-rules-paths"]') as HTMLButtonElement).click();
		// the refetch flips installed -> the row LEAVES the install tab
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-row-dsh-rules-paths"]')).toBeNull());
		(target.querySelector('[data-testid="rack-tab-uninstall"]') as HTMLButtonElement).click();
		flushSync();
		expect(target.querySelector('[data-testid="rack-uninstall-dsh-rules-paths"]')).toBeTruthy();
	});

	it('a failed load offers the retry verb', async () => {
		stubFetch(() => Promise.resolve(jsonRes({ ok: false })));
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-load-failed"]')).toBeTruthy());
		expect(target.textContent).toContain('Retry');
	});

	it('an empty rack names the reff file as the fix', async () => {
		stubFetch(() => Promise.resolve(jsonRes({ ok: true, snapshot: { generatedAt: 't', profile: 'web', plugins: [] } })));
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-empty"]')?.textContent).toContain('plugins-reff.md'));
	});
});

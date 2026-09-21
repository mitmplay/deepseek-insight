/**
 * SettingsSkillsPanel tests — The Shelf Chrome tab contract (2.1-T):
 * install tab lists only uninstalled skills, uninstall tab only
 * installed ones, uninstall verb gated by the uninstallable set
 * (Skill Shelf D5), counts interpolate, reload is install-tab-only.
 */
import { flushSync } from 'svelte';
import { mount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsSkillsPanelHost from './SettingsSkillsPanelHost.svelte';

const SNAP = {
	ok: true,
	reused: true,
	uninstallable: ['signed-one'],
	snapshot: {
		generatedAt: '2026-09-20T00:00:00Z',
		sources: [
			{
				id: 'pstack',
				author: 'Lauren Tan',
				repo: 'r',
				skills: [
					{ n: '1.1', id: 'signed-one', path: 'p', tier: null, installed: true, signed: true, installedFrom: 'pstack' },
					{ n: '1.2', id: 'unsigned-one', path: 'p', tier: null, installed: true, signed: false, installedFrom: null },
					{ n: '1.3', id: 'absent-one', path: 'p', tier: null, installed: false, signed: false, installedFrom: null }
				]
			}
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
	const instance = mount(SettingsSkillsPanelHost, { target });
	flushSync();
	return { target, instance };
}

function switchTab(target: HTMLElement, side: 'edit' | 'diff'): void {
	target.querySelector<HTMLButtonElement>(`[data-testid="shelf-tab-${side === 'edit' ? 'install' : 'uninstall'}"]`)!.click();
	flushSync();
}

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('SettingsSkillsPanel', () => {
	it('install tab: only uninstalled rows; badges survive; no uninstall verb anywhere', async () => {
		stubFetch((input) => Promise.resolve(new Response(JSON.stringify(SNAP), { headers: { 'content-type': 'application/json' } })));
		const { target } = mountPanel();
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="shelf-group-pstack"]')).not.toBeNull();
		});
		// the shelf ships ALL COLLAPSED - expand before asserting rows
		target.querySelector<HTMLButtonElement>('[data-testid="shelf-expand-all"]')!.click();
		flushSync();
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="shelf-row-absent-one"]')).not.toBeNull();
		});
		// installed rows are NOT on the install tab (D4)
		expect(target.querySelector('[data-testid="shelf-row-signed-one"]')).toBeNull();
		expect(target.querySelector('[data-testid="shelf-row-unsigned-one"]')).toBeNull();
		// no uninstall affordance exists on the install tab at all
		expect(target.querySelector('[data-testid^="shelf-uninstall"]')).toBeNull();
		// toolbar timestamp visible without scrolling (D2)
		expect(target.querySelector('[data-testid="shelf-generated"]')!.textContent).toContain('2026-09-20T00:00:00Z');
	});

	it('uninstall tab: only installed rows; uninstall verb ONLY on the signed row (D5); reload hidden', async () => {
		stubFetch((input) => Promise.resolve(new Response(JSON.stringify(SNAP), { headers: { 'content-type': 'application/json' } })));
		const { target } = mountPanel();
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="shelf-group-pstack"]')).not.toBeNull();
		});
		// the shelf ships ALL COLLAPSED - expand before asserting rows
		target.querySelector<HTMLButtonElement>('[data-testid="shelf-expand-all"]')!.click();
		flushSync();
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="shelf-row-absent-one"]')).not.toBeNull();
		});
		switchTab(target, 'diff');
		// uninstalled rows are NOT on the uninstall tab (D4)
		expect(target.querySelector('[data-testid="shelf-row-absent-one"]')).toBeNull();
		expect(target.querySelector('[data-testid="shelf-row-signed-one"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="shelf-row-unsigned-one"]')).not.toBeNull();
		// D5 gate: signed row has the verb, unsigned row does not
		expect(target.querySelector('[data-testid="shelf-uninstall-signed-one"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="shelf-uninstall-unsigned-one"]')).toBeNull();
		// D3: reload is an acquisition verb — install tab only
		expect(target.querySelector('[data-testid="shelf-reload"]')).toBeNull();
	});

	it('tabs show plain labels; the install bar carries the live count', async () => {
		stubFetch((input) => Promise.resolve(new Response(JSON.stringify(SNAP), { headers: { 'content-type': 'application/json' } })));
		const { target } = mountPanel();
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="shelf-group-pstack"]')).not.toBeNull();
		});
		// the shelf ships ALL COLLAPSED - expand before asserting rows
		target.querySelector<HTMLButtonElement>('[data-testid="shelf-expand-all"]')!.click();
		flushSync();
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="shelf-row-absent-one"]')).not.toBeNull();
		});
		const checkbox = target.querySelector<HTMLInputElement>('[data-testid="shelf-row-absent-one"] input[type="checkbox"]')!;
		checkbox.click();
		flushSync();
		const tabs = target.querySelector('[data-testid="shelf-tab-group"]')!;
		expect(tabs.textContent).not.toContain('(');
		const installBar = target.querySelector('[data-testid="shelf-install"]')!;
		expect(installBar.textContent).toContain('(1)');
	});

	it('search filters the active tab by skill id', async () => {
		stubFetch((input) => Promise.resolve(new Response(JSON.stringify(SNAP), { headers: { 'content-type': 'application/json' } })));
		const { target } = mountPanel();
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="shelf-group-pstack"]')).not.toBeNull();
		});
		// the shelf ships ALL COLLAPSED - expand before asserting rows
		target.querySelector<HTMLButtonElement>('[data-testid="shelf-expand-all"]')!.click();
		flushSync();
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="shelf-row-absent-one"]')).not.toBeNull();
		});
		const input = target.querySelector<HTMLInputElement>('[data-testid="shelf-search"]')!;
		input.value = 'absent';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(target.querySelector('[data-testid="shelf-row-absent-one"]')).not.toBeNull();
		input.value = 'zzz-no-match';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(target.querySelector('[data-testid="shelf-row-absent-one"]')).toBeNull();
	});

	it('collapse-all / expand-all drive the per-repo groups', async () => {
		stubFetch((input) => Promise.resolve(new Response(JSON.stringify(SNAP), { headers: { 'content-type': 'application/json' } })));
		const { target } = mountPanel();
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="shelf-group-pstack"]')).not.toBeNull();
		});
		// the shelf ships ALL COLLAPSED - expand before asserting rows
		target.querySelector<HTMLButtonElement>('[data-testid="shelf-expand-all"]')!.click();
		flushSync();
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="shelf-row-absent-one"]')).not.toBeNull();
		});
		(target.querySelector<HTMLButtonElement>('[data-testid="shelf-collapse-all"]')!).click();
		flushSync();
		expect(target.querySelector('[data-testid="shelf-row-absent-one"]')).toBeNull();
		(target.querySelector<HTMLButtonElement>('[data-testid="shelf-expand-all"]')!).click();
		flushSync();
		expect(target.querySelector('[data-testid="shelf-row-absent-one"]')).not.toBeNull();
	});

	it('install flow: select rows then confirm posts the selection', async () => {
		const fetchMock = stubFetch((input) => Promise.resolve(new Response(JSON.stringify(input === '/api/skills/snapshot' ? SNAP : { ok: true, results: [{ n: '1.3', ok: true }] }), { headers: { 'content-type': 'application/json' } })));
		const { target } = mountPanel();
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="shelf-install"]')).not.toBeNull();
		});
		// all-collapsed default: expand the repo rows first
		target.querySelector<HTMLButtonElement>('[data-testid="shelf-expand-all"]')!.click();
		flushSync();
		const checkbox = target.querySelector<HTMLInputElement>('[data-testid="shelf-row-absent-one"] input[type="checkbox"]')!;
		checkbox.click();
		flushSync();
		(target.querySelector<HTMLButtonElement>('[data-testid="shelf-install"]')! as HTMLButtonElement).click();
		flushSync();
		await vi.waitFor(() => {
			const installCall = (fetchMock.mock.calls as unknown as [string, RequestInit?][]).find(([u]) => u === '/api/skills/install');
			expect(installCall).toBeTruthy();
		});
		const [, init] = (fetchMock.mock.calls as unknown as [string, RequestInit?][]).find(([u]) => u === '/api/skills/install')!;
		expect(JSON.parse(String(init?.body)).targets).toEqual(['1.3']);
		// D2: a successful install surfaces the rescan expectation note
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="shelf-rescan"]')).not.toBeNull();
		});
	});

	it('reload button posts /api/skills/reload (visible on install tab)', async () => {
		const fetchMock = stubFetch((input) => Promise.resolve(new Response(JSON.stringify(input === '/api/skills/snapshot' ? SNAP : { ...SNAP, reused: false }), { headers: { 'content-type': 'application/json' } })));
		const { target } = mountPanel();
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="shelf-reload"]')).not.toBeNull();
		});
		(target.querySelector<HTMLButtonElement>('[data-testid="shelf-reload"]')! as HTMLButtonElement).click();
		flushSync();
		await vi.waitFor(() => {
			expect((fetchMock.mock.calls as unknown as [string][]).some(([u]) => u === '/api/skills/reload')).toBe(true);
		});
	});
});

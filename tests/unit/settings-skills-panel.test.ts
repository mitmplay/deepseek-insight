/**
 * 3.1-T - SettingsSkillsPanel host tests: badge per species, uninstall
 * affordance ONLY on signed rows, reload calls the reload endpoint.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
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
	const instance = mount(SettingsSkillsPanelHost, { target, props: { onclose: () => {} } });
	flushSync();
	return { target, instance };
}

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('SettingsSkillsPanel', () => {
	it('renders the snapshot with per-species badges and NO uninstall control on unsigned/homegrown rows', async () => {
		stubFetch((input) => Promise.resolve(new Response(JSON.stringify(SNAP), { headers: { 'content-type': 'application/json' } })));
		const { target } = mountPanel();
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="shelf-row-signed-one"]')).not.toBeNull();
		});
		// signed row: badge + uninstall affordance
		expect(target.querySelector('[data-testid="shelf-uninstall-signed-one"]')).not.toBeNull();
		// unsigned (hand-copied) row: badge present, uninstall ABSENT (D5)
		const unsigned = target.querySelector('[data-testid="shelf-row-unsigned-one"]')!;
		expect(unsigned.querySelector('[data-testid="shelf-badge"]')).not.toBeNull();
		expect(unsigned.querySelector('[data-testid="shelf-uninstall-unsigned-one"]')).toBeNull();
		// absent row: checkbox present (installable), no uninstall
		const absent = target.querySelector('[data-testid="shelf-row-absent-one"]')!;
		expect(absent.querySelector('input[type="checkbox"]')).not.toBeNull();
		expect(absent.querySelector('[data-testid^="shelf-uninstall"]')).toBeNull();
	});

	it('install flow: select rows then confirm posts the selection', async () => {
		const fetchMock = stubFetch((input) => Promise.resolve(new Response(JSON.stringify(input === '/api/skills/snapshot' ? SNAP : { ok: true, results: [{ n: '1.3', ok: true }] }), { headers: { 'content-type': 'application/json' } })));
		const { target } = mountPanel();
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="shelf-install"]')).not.toBeNull();
		});
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

	it('reload button posts /api/skills/reload', async () => {
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

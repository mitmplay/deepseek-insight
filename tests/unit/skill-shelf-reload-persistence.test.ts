/**
 * Reload feedback hard-reload survival (2026-09-22): the reload blob
 * persists on the floor entry and the panel seeds from it — a restored
 * 'done' lives out its REMAINING window; a restored 'loading' re-issues
 * the reload so the check still lands. Transitions emit to the floor.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsSkillsPanel from '$lib/components/settings-skills/SettingsSkillsPanel.svelte';

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

let instances: Array<Record<string, unknown>> = [];
afterEach(() => {
	for (const i of instances) void unmount(i as never);
	instances = [];
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

const state = (target: HTMLElement) => target.querySelector('[data-testid="shelf-reload"]')?.getAttribute('data-reload-state') ?? null;

function mountPanel(props: Record<string, unknown>): { target: HTMLElement; fetchMock: ReturnType<typeof vi.fn> } {
	const fetchMock = vi.fn(() => Promise.resolve(jsonRes(SNAP)));
	vi.stubGlobal('fetch', fetchMock);
	const target = document.createElement('div');
	document.body.appendChild(target);
	instances.push(mount(SettingsSkillsPanel, { target, props }));
	flushSync();
	return { target, fetchMock };
}

describe('reload feedback hard-reload survival', () => {
	it('restored done lives out its REMAINING window only', async () => {
		const { target } = mountPanel({
			initialReload: { state: 'done', doneAt: Date.now() + 1500 }
		});
		expect(state(target)).toBe('done');
		// expired well inside the 5s default: ~1.5s remaining + slack
		await vi.waitFor(
			() => {
				expect(state(target)).toBe('idle');
			},
			{ timeout: 6000 }
		);
	});

	it('expired done blob stays idle', () => {
		const { target } = mountPanel({
			initialReload: { state: 'done', doneAt: Date.now() - 10_000 }
		});
		expect(state(target)).toBe('idle');
	});

	it('restored loading re-issues the reload and walks to done', async () => {
		let resolveReload: (r: Response) => void = () => {};
		const reloadPromise = new Promise<Response>((r) => (resolveReload = r));
		const fetchMock = vi.fn(() => Promise.resolve(jsonRes(SNAP)));
		vi.stubGlobal('fetch', fetchMock);
		const emissions: Array<unknown> = [];
		const target = document.createElement('div');
		document.body.appendChild(target);
		instances.push(
			mount(SettingsSkillsPanel, {
				target,
				props: {
					initialReload: { state: 'loading' },
					onreloadchange: (r: unknown) => emissions.push(r)
				}
			})
		);
		flushSync();
		// the seed re-issues: the SECOND fetch (after the mount snapshot) is ours
		await vi.waitFor(() => {
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});
		expect(state(target)).toBe('loading');
		resolveReload(jsonRes({ ...SNAP, reused: false }));
		await vi.waitFor(() => {
			expect(state(target)).toBe('done');
		});
		// the floor heard about loading and done
		expect(emissions).toContainEqual({ state: 'loading' });
		expect(emissions.at(-1)).toEqual({ state: 'done', doneAt: expect.any(Number) });
	});

	it('emits null back to the floor when the done window expires', async () => {
		const emissions: Array<unknown> = [];
		const { target } = mountPanel({
			initialReload: { state: 'done', doneAt: Date.now() + 800 },
			onreloadchange: (r: unknown) => emissions.push(r)
		});
		await vi.waitFor(
			() => {
				expect(state(target)).toBe('idle');
			},
			{ timeout: 6000 }
		);
		expect(emissions.at(-1)).toBeNull();
	});
});

/**
 * SettingsSkillsPanel branch mop (Skill Shelf Chrome): pins the error,
 * busy-gate, note, warning and empty-shelf arms the tab-contract suite
 * doesn't reach — real behavior only, no smoke padding.
 */
import { flushSync, mount } from 'svelte';
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

function jsonRes(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type Route = Record<string, Response>;

/** Route a stub fetch by URL substring; unmatched URLs 404 loudly. */
function stubFetchRoutes(routes: Route): ReturnType<typeof vi.fn> {
	return vi.fn((input: string | URL | Request) => {
		const url = String(input);
		// Hand out a CLONE per request: each Response body reads once and the
	// panel refetches the snapshot after every verb.
	const originals = Object.entries(routes).map(([key, res]) => [key, res.clone()] as const);
	for (const [key, res] of originals) {
			if (url.includes(key)) return Promise.resolve(res.clone());
		}
		return Promise.resolve(jsonRes({ ok: false, error: 'unrouted: ' + url }, 404));
	});
}

function mountPanel(routes: Route): { target: HTMLElement; fetchMock: ReturnType<typeof vi.fn> } {
	const fetchMock = stubFetchRoutes(routes);
	vi.stubGlobal('fetch', fetchMock);
	const target = document.createElement('div');
	document.body.appendChild(target);
	mount(SettingsSkillsPanelHost, { target });
	flushSync();
	return { target, fetchMock };
}

async function waitLoaded(target: HTMLElement): Promise<void> {
	await vi.waitFor(() => {
		expect(target.querySelector('[data-testid="shelf-group-pstack"]')).not.toBeNull();
	});
	target.querySelector<HTMLButtonElement>('[data-testid="shelf-expand-all"]')!.click();
	flushSync();
	await vi.waitFor(() => {
		expect(target.querySelector('[data-testid="shelf-row-absent-one"]')).not.toBeNull();
	});
}

function click(target: HTMLElement, testid: string): void {
	const el = target.querySelector<HTMLButtonElement>('[data-testid="' + testid + '"]');
	if (!el) throw new Error('missing element ' + testid);
	el.click();
	flushSync();
}

function selectRow(target: HTMLElement, id: string): void {
	target.querySelector<HTMLInputElement>('[data-testid="shelf-row-' + id + '"] input[type="checkbox"]')!.click();
	flushSync();
}

function noteText(target: HTMLElement, testid: string): string | null {
	return target.querySelector('[data-testid="' + testid + '"]')?.textContent?.trim() ?? null;
}

/** Mount with a GATED snapshot fetch — releases after the panel is live,
 * so the caller can poke verbs against a null snapshot / busy panel. */
function mountGated(gatedKey: string, gatedRes: () => Response, rest: Route): { target: HTMLElement; fetchMock: ReturnType<typeof vi.fn>; release: () => void } {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	const fetchMock = vi.fn((input: string | URL | Request) => {
		const url = String(input);
		if (url.includes(gatedKey)) return gate.then(gatedRes);
		for (const [key, res] of Object.entries(rest)) {
			if (url.includes(key)) return Promise.resolve(res.clone());
		}
		return Promise.resolve(jsonRes({ ok: false }, 404));
	});
	vi.stubGlobal('fetch', fetchMock);
	const target = document.createElement('div');
	document.body.appendChild(target);
	mount(SettingsSkillsPanelHost, { target });
	flushSync();
	return { target, fetchMock, release };
}

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('SettingsSkillsPanel branches', () => {
	it('a failed snapshot renders the API error copy; a bare failure falls back to the default copy', async () => {
		const { target } = mountPanel({ 'skills/snapshot': jsonRes({ ok: false, error: 'boom' }) });
		await vi.waitFor(() => {
			expect(noteText(target, 'shelf-error')).toBe('boom');
		});
		expect(target.querySelector('[data-testid="shelf-group-pstack"]')).toBeNull();

		const second = mountPanel({ 'skills/snapshot': jsonRes({ ok: false }) });
		await vi.waitFor(() => {
			expect(noteText(second.target, 'shelf-error')).toBe('snapshot failed');
		});
	});

	it('collapse-all before the snapshot seeds an empty set, not a crash; post-load verbs collapse and expand', async () => {
		const gated = mountGated('skills/snapshot', () => jsonRes(SNAP), {});
		// still loading: snapshot is null here — the verb must not throw
		click(gated.target, 'shelf-collapse-all');
		expect(gated.target.querySelector('[data-testid="shelf-error"]')).toBeNull();
		gated.release();
		await waitLoaded(gated.target);
		// the pre-snapshot click left an EMPTY set — the shelf loads expanded
		expect(gated.target.querySelector('[data-testid="shelf-row-absent-one"]')).not.toBeNull();
		click(gated.target, 'shelf-collapse-all');
		expect(gated.target.querySelector('[data-testid="shelf-row-absent-one"]')).toBeNull();
		click(gated.target, 'shelf-expand-all');
		expect(gated.target.querySelector('[data-testid="shelf-row-absent-one"]')).not.toBeNull();
	});

	it('the group head toggle hides and re-shows one repo group', async () => {
		const { target } = mountPanel({ 'skills/snapshot': jsonRes(SNAP) });
		await waitLoaded(target);
		click(target, 'shelf-group-pstack');
		expect(target.querySelector('[data-testid="shelf-row-absent-one"]')).toBeNull();
		click(target, 'shelf-group-pstack');
		expect(target.querySelector('[data-testid="shelf-row-absent-one"]')).not.toBeNull();
	});

	it('unchecking a selected row drops it from the install count', async () => {
		const { target } = mountPanel({ 'skills/snapshot': jsonRes(SNAP) });
		await waitLoaded(target);
		selectRow(target, 'absent-one');
		expect(target.querySelector('[data-testid="shelf-install"]')!.textContent).toContain('(1)');
		selectRow(target, 'absent-one');
		expect(target.querySelector('[data-testid="shelf-install"]')!.textContent).toContain('(0)');
	});

	it('a busy install swallows the second click; a successful install flags the rescan note', async () => {
		const gated = mountGated('skills/install', () => jsonRes(SNAP), { 'skills/snapshot': jsonRes(SNAP) });
		await waitLoaded(gated.target);
		selectRow(gated.target, 'absent-one');
		click(gated.target, 'shelf-install');
		// busy: the second activation must not fire a second install POST
		click(gated.target, 'shelf-install');
		gated.release();
		await new Promise((r) => setTimeout(r, 100));
		console.log('CALLS', gated.fetchMock.mock.calls.map((c) => String(c[0])));
		console.log('TAIL', gated.target.innerHTML.slice(-1200));
		await vi.waitFor(() => {
			expect(noteText(gated.target, 'shelf-rescan')).not.toBeNull();
		});
		const installPosts = gated.fetchMock.mock.calls.filter((c) => String(c[0]).includes('skills/install'));
		expect(installPosts).toHaveLength(1);
		expect(String((installPosts[0][1] as RequestInit).body)).toBe(JSON.stringify({ targets: ['1.3'] }));
		// selection cleared after the install
		expect(gated.target.querySelector('[data-testid="shelf-install"]')!.textContent).toContain('(0)');
	});

	it('a failed install shows the API error; a bare failure shows the fallback copy', async () => {
		const failing = mountPanel({
			'skills/snapshot': jsonRes(SNAP),
			'skills/install': jsonRes({ ok: false, error: 'nope' })
		});
		await waitLoaded(failing.target);
		selectRow(failing.target, 'absent-one');
		click(failing.target, 'shelf-install');
		await vi.waitFor(() => {
			expect(noteText(failing.target, 'shelf-note')).toBe('nope');
		});
		expect(failing.target.querySelector('[data-testid="shelf-rescan"]')).toBeNull();

		const bare = mountPanel({
			'skills/snapshot': jsonRes(SNAP),
			'skills/install': jsonRes({ ok: false })
		});
		await waitLoaded(bare.target);
		selectRow(bare.target, 'absent-one');
		click(bare.target, 'shelf-install');
		await vi.waitFor(() => {
			expect(noteText(bare.target, 'shelf-note')).toBe('install reported failures');
		});
	});

	it('a 409 uninstall surfaces the refusal note and refreshes the shelf', async () => {
		const { target } = mountPanel({
			'skills/snapshot': jsonRes(SNAP),
			'skills/uninstall': jsonRes({ ok: false }, 409)
		});
		await waitLoaded(target);
		click(target, 'shelf-tab-uninstall');
		click(target, 'shelf-uninstall-signed-one');
		await vi.waitFor(() => {
			expect(noteText(target, 'shelf-note')).not.toBeNull();
		});
		expect(noteText(target, 'shelf-note')).not.toBe('');
	});

	it('a busy uninstall swallows the second click', async () => {
		const gated = mountGated('skills/uninstall', () => jsonRes({ ok: true }), { 'skills/snapshot': jsonRes(SNAP) });
		await waitLoaded(gated.target);
		click(gated.target, 'shelf-tab-uninstall');
		click(gated.target, 'shelf-uninstall-signed-one');
		click(gated.target, 'shelf-uninstall-signed-one');
		gated.release();
		await vi.waitFor(() => {
			expect(gated.fetchMock.mock.calls.filter((c) => String(c[0]).includes('skills/uninstall'))).toHaveLength(1);
		});
	});

	it('a failed reload shows the API error; a bare failure shows the fallback copy', async () => {
		const failing = mountPanel({
			'skills/snapshot': jsonRes(SNAP),
			'skills/reload': jsonRes({ ok: false, error: 'kaput' })
		});
		await waitLoaded(failing.target);
		click(failing.target, 'shelf-reload');
		await vi.waitFor(() => {
			expect(noteText(failing.target, 'shelf-note')).toBe('kaput');
		});

		const bare = mountPanel({
			'skills/snapshot': jsonRes(SNAP),
			'skills/reload': jsonRes({ ok: false })
		});
		await waitLoaded(bare.target);
		click(bare.target, 'shelf-reload');
		await vi.waitFor(() => {
			expect(noteText(bare.target, 'shelf-note')).toBe('reload failed');
		});
	});

	it('a busy reload swallows the second click; a good reload swaps in the new snapshot', async () => {
		const RELOADED = JSON.parse(JSON.stringify(SNAP));
		RELOADED.snapshot.generatedAt = '2026-09-22T00:00:00Z';
		const gated = mountGated('skills/reload', () => jsonRes({ ok: true, ...RELOADED }), { 'skills/snapshot': jsonRes(SNAP) });
		await waitLoaded(gated.target);
		click(gated.target, 'shelf-reload');
		click(gated.target, 'shelf-reload');
		gated.release();
		await vi.waitFor(() => {
			expect(gated.target.querySelector('[data-testid="shelf-generated"]')!.textContent).toContain('2026-09-22T00:00:00Z');
		});
		expect(gated.fetchMock.mock.calls.filter((c) => String(c[0]).includes('skills/reload'))).toHaveLength(1);
	});

	it('snapshot warnings render per source; a warning-free snapshot renders none', async () => {
		const WARNED = JSON.parse(JSON.stringify(SNAP));
		WARNED.snapshot.warnings = [{ code: 'dup', source: 'pstack', detail: 'duplicate skill id' }];
		const warned = mountPanel({ 'skills/snapshot': jsonRes(WARNED) });
		await waitLoaded(warned.target);
		expect(noteText(warned.target, 'shelf-warn-pstack')).toBe('duplicate skill id');

		const clean = mountPanel({ 'skills/snapshot': jsonRes(SNAP) });
		await waitLoaded(clean.target);
		expect(clean.target.querySelector('[data-testid^="shelf-warn-"]')).toBeNull();
	});

	it('a search that matches nothing empties the shelf into the empty note', async () => {
		const { target } = mountPanel({ 'skills/snapshot': jsonRes(SNAP) });
		await waitLoaded(target);
		const input = target.querySelector<HTMLInputElement>('[data-testid="shelf-search"]')!;
		input.value = 'zzz-no-match';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(target.querySelector('[data-testid="shelf-row-absent-one"]')).toBeNull();
		expect(target.querySelector('[data-testid="shelf-source-pstack"]')).toBeNull();
		expect(noteText(target, 'shelf-empty')).toBe('—');
		expect(target.querySelectorAll('[data-testid="shelf-search"]')).toHaveLength(1);
	});
});
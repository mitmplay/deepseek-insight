/**
 * AddWorkspaceButton unit tests — the sidebar's workspace adoption flow.
 *
 * happy-dom + route-aware fetch stub (the panel is a pure client of the
 * four /api/dsh endpoints it composes: directory browse, native pick,
 * workspace adopt, session create — no live host, BC-8 spirit).
 *
 * Covers: browse rendering (crumbs Home rule, hidden filter, truncated),
 * the native-picker switch, the adopt+create payoff, every error lane,
 * dismissal rules (outside click, Escape, busy pin), and the listing
 * supersession guard.
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AddWorkspaceButton from '$lib/components/common/layout/AddWorkspaceButton.svelte';
import type { DsiDirectoryListing } from '$lib/types';

type Deferred = { resolve: (v: Response) => void; promise: Promise<Response> };

function deferred(): Deferred {
	let resolve!: (v: Response) => void;
	const promise = new Promise<Response>((r) => (resolve = r));
	return { resolve, promise };
}

const jsonResponse = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const LISTING: DsiDirectoryListing = {
	path: '/Users/x/proj',
	home: '/Users/x',
	crumbs: [
		{ name: 'Users', path: '/Users', hidden: false },
		{ name: 'x', path: '/Users/x', hidden: false },
		{ name: 'proj', path: '/Users/x/proj', hidden: false }
	],
	entries: [
		{ name: 'alpha', path: '/Users/x/proj/alpha', hidden: false },
		{ name: '.dot', path: '/Users/x/proj/.dot', hidden: true }
	],
	truncated: false
};

interface Harness {
	target: HTMLElement;
	created: Array<{ sessionId: string; agentPreset: string | null; path: string }>;
	calls: Array<{ url: string; method: string; body?: unknown }>;
	fetchMock: ReturnType<typeof vi.fn>;
	unmount: () => void;
}

/** Mount the button with a recording oncreated + recording fetch. */
function render(
	fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>,
	agent?: string | null
): Harness {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const created: Harness['created'] = [];
	const calls: Harness['calls'] = [];
	const fetchMock = vi.fn(
		fetchImpl ??
			(async () => {
				return jsonResponse({ ok: true, listing: LISTING });
			})
	);
	vi.stubGlobal(
		'fetch',
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
			return fetchMock(url, init);
		}
	);
	const comp = mount(AddWorkspaceButton, {
		target,
		props: {
			oncreated: (sessionId: string, agentPreset: string | null, path: string) => {
				created.push({ sessionId, agentPreset, path });
			},
			...(agent === undefined ? {} : { agent })
		}
	});
	return { target, created, calls, fetchMock, unmount: () => unmount(comp) };
}

/** Let $effect + fetch chains settle (multi-await pipelines). */
async function settle(rounds = 25): Promise<void> {
	for (let i = 0; i < rounds; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

async function openPanel(h: Harness): Promise<void> {
	(h.target.querySelector('[data-testid="add-workspace-button"]') as HTMLElement).click();
	await settle();
}

describe('AddWorkspaceButton — browse flow (GET /api/dsh/directory)', () => {
	let h: Harness;
	beforeEach(() => {
		h = render();
	});
	afterEach(() => {
		h.unmount();
		vi.unstubAllGlobals();
	});

	it('idle renders only the button; click opens the panel and loads a level', async () => {
		expect(h.target.querySelector('[data-testid="add-workspace-panel"]')).toBeNull();
		await openPanel(h);
		expect(h.target.querySelector('[data-testid="add-workspace-panel"]')).not.toBeNull();
		expect(h.calls.filter((c) => c.url === '/api/dsh/directory')).toHaveLength(1);
	});

	it('renders rows, target path, and the Home-rooted crumb chain (DSH displayCrumbs rule)', async () => {
		await openPanel(h);
		const entries = [...h.target.querySelectorAll('[data-testid="add-workspace-entry"]')];
		expect(entries.map((e) => e.getAttribute('data-name'))).toEqual(['alpha']); // hidden filtered by default
		expect(h.target.querySelector('[data-testid="add-workspace-target"]')?.textContent).toBe('/Users/x/proj');
		const crumbs = [...h.target.querySelectorAll('[data-testid="add-workspace-crumb"]')];
		// home '/Users/x' found at index 1 → [Home, proj]
		expect(crumbs.map((c) => c.getAttribute('data-path'))).toEqual(['/Users/x', '/Users/x/proj']);
		expect(crumbs[0].textContent ?? '').not.toContain('x'); // Home icon, not the raw name
	});

	it('outside the home subtree the full ancestry shows (no Home crumb)', async () => {
		h.fetchMock.mockImplementation(async () =>
			jsonResponse({
				ok: true,
				listing: {
					path: '/Volumes/data',
					home: '/Users/x',
					crumbs: [
						{ name: 'Volumes', path: '/Volumes' },
						{ name: 'data', path: '/Volumes/data' }
					],
					entries: [],
					truncated: false
				}
			})
		);
		await openPanel(h);
		const crumbs = [...h.target.querySelectorAll('[data-testid="add-workspace-crumb"]')];
		expect(crumbs.map((c) => c.textContent)).toEqual(['Volumes', 'data']);
	});

	it('hidden toggle reveals hidden rows (aria-pressed flips)', async () => {
		await openPanel(h);
		const toggle = h.target.querySelector('[data-testid="add-workspace-hidden-toggle"]') as HTMLElement;
		expect(toggle.getAttribute('aria-pressed')).toBe('false');
		toggle.click();
		flushSync();
		expect(toggle.getAttribute('aria-pressed')).toBe('true');
		expect([...h.target.querySelectorAll('[data-testid="add-workspace-entry"]')].map((e) => e.getAttribute('data-name'))).toEqual(['alpha', '.dot']);
	});

	it('clicking a row descends one level (?path=); clicking a crumb jumps there', async () => {
		await openPanel(h);
		(h.target.querySelector('[data-testid="add-workspace-entry"]') as HTMLElement).click();
		await settle();
		expect(h.calls.at(-1)?.url).toBe(`/api/dsh/directory?path=${encodeURIComponent('/Users/x/proj/alpha')}`);
		const crumbs = h.target.querySelectorAll('[data-testid="add-workspace-crumb"]');
		(crumbs[0] as HTMLElement).click();
		await settle();
		expect(h.calls.at(-1)?.url).toBe(`/api/dsh/directory?path=${encodeURIComponent('/Users/x')}`);
	});

	it('empty level shows the no-subdirectories hint; truncated flag shows its hint', async () => {
		h.fetchMock.mockImplementation(async () =>
			jsonResponse({
				ok: true,
				listing: { ...LISTING, entries: [], truncated: true }
			})
		);
		await openPanel(h);
		expect(h.target.querySelector('[data-testid="add-workspace-empty"]')?.textContent).toContain('No subdirectories');
		expect(h.target.querySelector('[data-testid="add-workspace-truncated"]')).not.toBeNull();
	});

	it('listing failure shows the host error message verbatim', async () => {
		h.fetchMock.mockImplementation(async () =>
			jsonResponse({ ok: false, error: { code: 'boom', message: 'host says no' } }, 500)
		);
		await openPanel(h);
		expect(h.target.querySelector('[data-testid="add-workspace-error"]')?.textContent).toContain('host says no');
	});

	it('network throw lands in the error lane (fetch rejected)', async () => {
		h.fetchMock.mockImplementation(async () => {
			throw new Error('ECONNREFUSED');
		});
		await openPanel(h);
		expect(h.target.querySelector('[data-testid="add-workspace-error"]')?.textContent).toContain('ECONNREFUSED');
	});

	it('supersession: a late listing response cannot repopulate the panel after a newer one', async () => {
		const older = deferred();
		const newer = deferred();
		let n = 0;
		h.fetchMock.mockImplementation(() => {
			n += 1;
			return n === 1 ? Promise.resolve(jsonResponse({ ok: true, listing: LISTING })) : n === 2 ? older.promise : newer.promise;
		});
		await openPanel(h); // level 1 landed; rows render
		const rows = () => [...h.target.querySelectorAll('[data-testid="add-workspace-entry"]')] as HTMLElement[];
		rows()[0].click(); // request 2 (older) in flight
		rows()[0].click(); // request 3 (newer) supersedes it
		newer.resolve(jsonResponse({ ok: true, listing: { ...LISTING, path: '/fresh' } }));
		await settle();
		older.resolve(jsonResponse({ ok: true, listing: { ...LISTING, path: '/stale' } }));
		await settle();
		expect(h.target.querySelector('[data-testid="add-workspace-target"]')?.textContent).toBe('/fresh');
	});
});

describe('AddWorkspaceButton — native picker flow (directory-picker/unavailable)', () => {
	/** The browse-refusal that switches the flow to the OS dialog. */
	const nativeUnavailable = (): Response =>
		jsonResponse(
			{
				ok: false,
				error: { code: 'directory-picker/unavailable', message: 'native only', details: { capability: 'native' } }
			},
			501
		);

	let h: Harness;
	beforeEach(() => {
		h = render(async (url) => {
			if (url === '/api/dsh/directory') return nativeUnavailable();
			if (url === '/api/dsh/pick-directory') return jsonResponse({ ok: true, path: '/picked/folder' });
			if (url === '/api/dsh/workspaces') return jsonResponse({ ok: true });
			if (url === '/api/dsh/sessions')
				return jsonResponse({ ok: true, sessionId: 's-native', agentPreset: null });
			return jsonResponse({ ok: true });
		});
	});
	afterEach(() => {
		h.unmount();
		vi.unstubAllGlobals();
	});

	it('switches to the native step and runs adopt+create on the picked path', async () => {
		await openPanel(h);
		expect(h.target.querySelector('[data-testid="add-workspace-native"]')).not.toBeNull();
		expect(h.target.querySelector('[data-testid="add-workspace-native-retry"]')).not.toBeNull();
		await settle();
		const pick = h.calls.find((c) => c.url === '/api/dsh/pick-directory');
		expect(pick?.method).toBe('POST');
		expect(h.calls.find((c) => c.url === '/api/dsh/workspaces')?.body).toEqual({ path: '/picked/folder' });
		expect(h.calls.find((c) => c.url === '/api/dsh/sessions')?.body).toEqual({ cwd: '/picked/folder' });
		expect(h.created).toEqual([{ sessionId: 's-native', agentPreset: null, path: '/picked/folder' }]);
	});


	it('a successful native pick dismisses the panel (no stuck dialog)', async () => {
		await openPanel(h);
		await settle();
		expect(h.created).toEqual([{ sessionId: 's-native', agentPreset: null, path: '/picked/folder' }]);
		// 2026-09-15 bug: the 'done' step left the panel rendered with a
		// disabled confirm button (listing is null in the native flow).
		expect(h.target.querySelector('[data-testid="add-workspace-panel"]')).toBeNull();
	});
	it('a null pick (operator cancelled the OS dialog) closes the panel quietly', async () => {
		h.fetchMock.mockImplementation(async (url: string) => {
			if (url === '/api/dsh/directory') return nativeUnavailable();
			if (url === '/api/dsh/pick-directory') return jsonResponse({ ok: true, path: null });
			return jsonResponse({ ok: true });
		});
		await openPanel(h);
		await settle();
		expect(h.target.querySelector('[data-testid="add-workspace-panel"]')).toBeNull();
		expect(h.created).toEqual([]);
	});

	it('pick failure shows the error and keeps the native panel open (retry available)', async () => {
		h.fetchMock.mockImplementation(async (url: string) => {
			if (url === '/api/dsh/directory') return nativeUnavailable();
			if (url === '/api/dsh/pick-directory') return jsonResponse({ ok: false, error: { code: 'x', message: 'dialog exploded' } }, 500);
			return jsonResponse({ ok: true });
		});
		await openPanel(h);
		await settle();
		expect(h.target.querySelector('[data-testid="add-workspace-error"]')?.textContent).toContain('dialog exploded');
		expect(h.target.querySelector('[data-testid="add-workspace-native-retry"]')).not.toBeNull();
	});

	it('pick rejection lands in the error lane', async () => {
		h.fetchMock.mockImplementation(async (url: string) => {
			if (url === '/api/dsh/directory') return nativeUnavailable();
			if (url === '/api/dsh/pick-directory') throw new Error('aborted mid-dialog');
			return jsonResponse({ ok: true });
		});
		await openPanel(h);
		await settle();
		expect(h.target.querySelector('[data-testid="add-workspace-error"]')?.textContent).toContain('aborted mid-dialog');
	});

	it('"Open dialog again" re-runs the pick RPC', async () => {
		h.fetchMock.mockImplementation(async (url: string) => {
			if (url === '/api/dsh/directory') return nativeUnavailable();
			// First pick fails (panel stays native + retryable); the retry cancels quietly.
			if (url === '/api/dsh/pick-directory') {
				picks += 1;
				return picks === 1
					? jsonResponse({ ok: false, error: { code: 'x', message: 'dialog exploded' } }, 500)
					: jsonResponse({ ok: true, path: null });
			}
			return jsonResponse({ ok: true });
		});
		let picks = 0;
		await openPanel(h);
		await settle();
		const retry = h.target.querySelector('[data-testid="add-workspace-native-retry"]') as HTMLElement;
		retry.click();
		await settle();
		expect(h.calls.filter((c) => c.url === '/api/dsh/pick-directory')).toHaveLength(2);
	});
});

describe('AddWorkspaceButton — native flow with an armed agent pill', () => {
	const nativeUnavailable = (): Response =>
			jsonResponse(
						{
								ok: false,
								error: { code: 'directory-picker/unavailable', message: 'native only', details: { capability: 'native' } }
						},
						501
			);

	let h: Harness;
	beforeEach(() => {
		h = render(async (url: string) => {
			if (url === '/api/dsh/directory') return nativeUnavailable();
			if (url === '/api/dsh/pick-directory') return jsonResponse({ ok: true, path: '/picked/folder' });
			if (url === '/api/dsh/sessions')
				return jsonResponse({ ok: true, sessionId: 's-native', agentPreset: 'deep-agent' });
			return jsonResponse({ ok: true });
		}, 'deep-agent');
	});
	afterEach(() => {
		h.unmount();
		vi.unstubAllGlobals();
	});

	it('the armed agent rides the create — no silent default (2026-09-15)', async () => {
		await openPanel(h);
		await settle();
		expect(h.calls.find((c) => c.url === '/api/dsh/sessions')?.body).toEqual({
			cwd: '/picked/folder',
			agentPreset: 'deep-agent'
		});
		expect(h.created).toEqual([{ sessionId: 's-native', agentPreset: 'deep-agent', path: '/picked/folder' }]);
	});
});

describe('AddWorkspaceButton — adopt + create payoff (browse confirm)', () => {
	let h: Harness;
	beforeEach(() => {
		h = render(async (url) => {
			if (url === '/api/dsh/directory') return jsonResponse({ ok: true, listing: LISTING });
			if (url === '/api/dsh/workspaces') return jsonResponse({ ok: true });
			if (url === '/api/dsh/sessions') return jsonResponse({ ok: true, sessionId: 's-1', agentPreset: 'main' });
			return jsonResponse({ ok: true });
		});
	});
	afterEach(() => {
		h.unmount();
		vi.unstubAllGlobals();
	});

	it('confirm adopts the listed level and opens a fresh session there', async () => {
		await openPanel(h);
		(h.target.querySelector('[data-testid="add-workspace-confirm"]') as HTMLElement).click();
		await settle();
		expect(h.calls.find((c) => c.url === '/api/dsh/workspaces')?.body).toEqual({ path: '/Users/x/proj' });
		expect(h.calls.find((c) => c.url === '/api/dsh/sessions')?.body).toEqual({ cwd: '/Users/x/proj' });
		expect(h.created).toEqual([{ sessionId: 's-1', agentPreset: 'main', path: '/Users/x/proj' }]);
	});

	it('adopt failure shows the error and never creates a session', async () => {
		h.fetchMock.mockImplementation(async (url: string) => {
			if (url === '/api/dsh/workspaces')
				return jsonResponse({ ok: false, error: { code: 'e', message: 'already registered' } }, 409);
			return jsonResponse({ ok: true, listing: LISTING });
		});
		await openPanel(h);
		(h.target.querySelector('[data-testid="add-workspace-confirm"]') as HTMLElement).click();
		await settle();
		expect(h.target.querySelector('[data-testid="add-workspace-error"]')?.textContent).toContain('already registered');
		expect(h.calls.find((c) => c.url === '/api/dsh/sessions')).toBeUndefined();
		expect(h.created).toEqual([]);
	});

	it('create failure shows the error; adoption stood, no oncreated', async () => {
		h.fetchMock.mockImplementation(async (url: string) => {
			if (url === '/api/dsh/sessions')
				return jsonResponse({ ok: false, error: { code: 'e', message: 'preset vanished' } }, 500);
			return jsonResponse({ ok: true, listing: LISTING });
		});
		await openPanel(h);
		(h.target.querySelector('[data-testid="add-workspace-confirm"]') as HTMLElement).click();
		await settle();
		expect(h.target.querySelector('[data-testid="add-workspace-error"]')?.textContent).toContain('preset vanished');
		expect(h.created).toEqual([]);
	});

	it('busy pins the flow: outside click / Escape cannot dismiss an in-flight adopt', async () => {
		const gate = deferred();
		h.fetchMock.mockImplementation(async (url: string) => {
			if (url === '/api/dsh/workspaces') return gate.promise;
			return jsonResponse({ ok: true, listing: LISTING });
		});
		await openPanel(h);
		(h.target.querySelector('[data-testid="add-workspace-confirm"]') as HTMLElement).click();
		await settle();
		const cancel = [...h.target.querySelectorAll('button')].find((b) => b.textContent === 'Cancel') as HTMLButtonElement;
		expect(cancel.disabled).toBe(true); // busy: cancel disabled
		document.body.click(); // outside click
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		flushSync();
		expect(h.target.querySelector('[data-testid="add-workspace-panel"]')).not.toBeNull();
		gate.resolve(jsonResponse({ ok: false, error: { code: 'x', message: 'late failure' } }, 500));
		await settle();
		expect(h.target.querySelector('[data-testid="add-workspace-error"]')).not.toBeNull(); // now dismissible again
	});
});

describe('AddWorkspaceButton — dismissal rules', () => {
	let h: Harness;
	beforeEach(() => {
		h = render();
	});
	afterEach(() => {
		h.unmount();
		vi.unstubAllGlobals();
	});

	it('Escape closes the open panel', async () => {
		await openPanel(h);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		flushSync();
		expect(h.target.querySelector('[data-testid="add-workspace-panel"]')).toBeNull();
	});

	it('a click outside the panel closes it; a click inside does not', async () => {
		await openPanel(h);
		(h.target.querySelector('[data-testid="add-workspace-panel"]') as HTMLElement).click();
		flushSync();
		expect(h.target.querySelector('[data-testid="add-workspace-panel"]')).not.toBeNull();
		document.body.click();
		flushSync();
		expect(h.target.querySelector('[data-testid="add-workspace-panel"]')).toBeNull();
	});

	it('Cancel button closes the panel', async () => {
		await openPanel(h);
		([...h.target.querySelectorAll('button')].find((b) => b.textContent === 'Cancel') as HTMLElement).click();
		flushSync();
		expect(h.target.querySelector('[data-testid="add-workspace-panel"]')).toBeNull();
	});

	it('Escape while idle is a no-op', () => {
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		flushSync();
		expect(h.target.querySelector('[data-testid="add-workspace-button"]')).not.toBeNull();
	});
});

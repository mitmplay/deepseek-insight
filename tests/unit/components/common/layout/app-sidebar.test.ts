/**
 * AppSidebar unit tests — the conversation page's left rail.
 *
 * Component-direct mount (no page harness): the rail is presentational
 * — collapse/width/drag live in the page — so every test spies on the
 * onToggleCollapse / onResizeStart callbacks and reads the branch
 * surfaces through data-testids. The rail's BODY (SidebarSessions)
 * loads /api/dsh/sessions on mount, so every mount rides a route-aware
 * fetch stub (add-workspace-button.test.ts pattern).
 *
 * Covers the previously-uncovered paths:
 *  - the three render branches: collapsed stub / embedded rail /
 *    standalone width-wrapper (default mount)
 *  - paneledSessionIds default [] vs an explicit array
 *  - the collapse/expand buttons (both hosts) fire onToggleCollapse
 *  - the standalone gutter reports mousedown via onResizeStart
 *  - the rail-owned filter state: a pill pick flows through the
 *    onfilterchange relay back into the row's summary
 *  - navigateToSession: an adopted workspace's fresh session becomes a
 *    seed deep link through window.location.assign
 *  - the header's CanvasCopyButton (2026-09-02): the click payoff — the
 *    page's captureContainer (the ConversationPage root) flows through
 *    to the PNG render (html-to-image mocked, canvas-copy-button.test.ts
 *    pattern)
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppSidebar from '$lib/components/common/layout/AppSidebar.svelte';
import { setWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';
import { toBlob } from 'html-to-image';

vi.mock('html-to-image', () => ({ toBlob: vi.fn(), toCanvas: vi.fn() }));

const mockedToBlob = vi.mocked(toBlob);
import type {
	DsiDirectoryListing,
	DsiPreset,
	DsiSessionSummary,
	DsiWorkspaceSummary
} from '$lib/types';

const jsonResponse = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Sessions with TWO discriminating dimensions (pills render only when
 *  a dimension discriminates — one value shows no pills). */
const SESSIONS: DsiSessionSummary[] = [
	{
		sessionId: 's-current',
		title: 'Current work',
		agentPreset: 'main',
		running: false,
		blank: false,
		updatedAt: Date.now() - 60_000,
		workspace: '/tmp/alpha',
		turns: null
	},
	{
		sessionId: 's-two',
		title: 'Research thread',
		agentPreset: 'research',
		running: false,
		blank: false,
		updatedAt: Date.now() - 120_000,
		workspace: '/tmp/beta',
		turns: null
	},
	{
		sessionId: 's-three',
		title: 'Third thread',
		agentPreset: 'research',
		running: false,
		blank: false,
		updatedAt: Date.now() - 240_000,
		workspace: '/tmp/alpha',
		turns: null
	}
];

const REGISTRY: DsiWorkspaceSummary[] = [
	{ workspaceId: 'w-a', title: 'alpha', path: '/tmp/alpha', sessionIds: [] },
	{ workspaceId: 'w-b', title: 'beta', path: '/tmp/beta', sessionIds: [] }
];

const PRESETS: DsiPreset[] = [
	{ id: 'main', name: null, description: null, isDefault: true },
	{ id: 'research', name: 'Research', description: null, isDefault: false }
];

const LISTING: DsiDirectoryListing = {
	path: '/tmp/new-folder',
	home: '/tmp',
	crumbs: [
		{ name: 'tmp', path: '/tmp', hidden: false },
		{ name: 'new-folder', path: '/tmp/new-folder', hidden: false }
	],
	entries: [],
	truncated: false
};

/** Route-aware fetch stub: the sidebar's GET plus the Add-workspace
 *  flow's directory/adopt/create endpoints. */
interface FetchLog {
	url: string;
	method: string;
	body?: unknown;
}

function stubFetch(log: FetchLog[]): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const url = String(input);
			const method = init?.method ?? 'GET';
			log.push({
				url,
				method,
				body: init?.body ? JSON.parse(String(init.body)) : undefined
			});
			if (url === '/api/dsh/sessions' && method === 'GET')
				return jsonResponse({ ok: true, sessions: SESSIONS, workspaces: REGISTRY, presets: PRESETS });
			if (url === '/api/dsh/sessions')
				return jsonResponse({ ok: true, sessionId: 's-adopted', agentPreset: null });
			if (url === '/api/dsh/workspaces') return jsonResponse({ ok: true });
			if (url === '/api/dsh/directory') return jsonResponse({ ok: true, listing: LISTING });
			return jsonResponse({ ok: true });
		})
	);
}

/** Multi-await settle — the rail's load chain ($effect → fetch → state). */
async function settle(rounds = 12): Promise<void> {
	for (let i = 0; i < rounds; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

function mountSidebar(
	props: Record<string, unknown> = {},
	callbacks: { onToggleCollapse?: () => void; onResizeStart?: (e: MouseEvent) => void } = {}
) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onToggleCollapse = callbacks.onToggleCollapse ?? vi.fn<() => void>();
	const onResizeStart = callbacks.onResizeStart ?? vi.fn<(e: MouseEvent) => void>();
	const instance = mount(AppSidebar, {
		target,
		props: {
			currentSessionId: 's-current',
			onToggleCollapse,
			onResizeStart,
			...props
		}
	});
	return { target, instance, onToggleCollapse, onResizeStart };
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
	localStorage.clear();
});

describe('AppSidebar — standalone branch (default mount)', () => {
	it('renders the width-carrying wrapper + gutter beside the rail; rows load through the body', async () => {
		const log: FetchLog[] = [];
		stubFetch(log);
		// No paneledSessionIds prop → the default [] path.
		const { target, instance, onToggleCollapse } = mountSidebar({ width: 320 });
		await settle();
		const wrap = target.querySelector('[data-testid="app-sidebar"]') as HTMLElement;
		expect(wrap).not.toBeNull();
		expect(wrap.style.width).toBe('320px');
		// Robust to in-flight title experiments (a concurrent agent's probe
		// suffix): pins the TITLE ELEMENT renders, not the exact suffix.
		expect(target.querySelector('[data-testid="sidebar-title"]')?.textContent).toMatch(
			/^Deepseek Insight/
		);
		// The gutter is the wrapper's flex SIBLING (never clipped).
		expect(target.querySelector('[data-testid="sidebar-gutter"]')).not.toBeNull();
		// The body loaded: the spine renders the non-current sessions.
		expect(target.querySelectorAll('[data-testid="sidebar-session-card"]')).toHaveLength(2);
		// Collapse button fires the page-owned toggle.
		const collapse = target.querySelector('button[aria-label="Collapse sidebar"]') as HTMLButtonElement;
		collapse.click();
		flushSync();
		expect(onToggleCollapse).toHaveBeenCalledTimes(1);
		unmount(instance);
	});

	it('gutter mousedown reports through onResizeStart (drag math is page-owned)', async () => {
		const log: FetchLog[] = [];
		stubFetch(log);
		const { target, instance, onResizeStart } = mountSidebar();
		await settle();
		const gutter = target.querySelector('[data-testid="sidebar-gutter"]') as HTMLElement;
		const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
		gutter.dispatchEvent(down);
		expect(onResizeStart).toHaveBeenCalledTimes(1);
		expect(onResizeStart).toHaveBeenCalledWith(down);
		unmount(instance);
	});

	it('paneled sessions leave the spine (explicit paneledSessionIds array)', async () => {
		const log: FetchLog[] = [];
		stubFetch(log);
		const { target, instance } = mountSidebar({ paneledSessionIds: ['s-three'] });
		await settle();
		const rows = target.querySelectorAll('[data-testid="sidebar-session-card"]');
		expect(rows).toHaveLength(1); // s-two only — s-three is paneled away
		unmount(instance);
	});

	it('a pill pick flows through the rail-owned filter state back into the summary', async () => {
		const log: FetchLog[] = [];
		stubFetch(log);
		const { target, instance } = mountSidebar();
		await settle();
		// The filter row ships expanded (2026-09-18) — pick the preset pill.
		const pill = target.querySelector('[data-testid="filter-preset-research"]') as HTMLButtonElement;
		expect(pill).not.toBeNull();
		pill.click();
		flushSync();
		// The relay updated the rail's filter → the summary names the agent.
		const summary = target.querySelector('[data-testid="filter-summary"]');
		expect(summary?.textContent).toContain('Research');
		unmount(instance);
	});
});

describe('AppSidebar — collapsed stub', () => {
	it('renders the 34px stub; the expand button fires onToggleCollapse', async () => {
		const log: FetchLog[] = [];
		stubFetch(log);
		const { target, instance, onToggleCollapse } = mountSidebar({ collapsed: true });
		await settle();
		const stub = target.querySelector('[data-testid="app-sidebar-collapsed"]') as HTMLElement;
		expect(stub).not.toBeNull();
		expect(target.querySelector('[data-testid="app-sidebar"]')).toBeNull();
		expect(stub.textContent).toContain('Deepseek Insight');
		const expand = stub.querySelector('button[aria-label="Expand sidebar"]') as HTMLButtonElement;
		expect(expand.getAttribute('aria-expanded')).toBe('false');
		expand.click();
		flushSync();
		expect(onToggleCollapse).toHaveBeenCalledTimes(1);
		unmount(instance);
	});
});

describe('AppSidebar — embedded rail (placement panels-zoom)', () => {
	it('renders the BARE rail: no width wrapper, no gutter; collapse still fires', async () => {
		const log: FetchLog[] = [];
		stubFetch(log);
		const { target, instance, onToggleCollapse } = mountSidebar({ embedded: true });
		await settle();
		const rail = target.querySelector('[data-testid="app-sidebar"]') as HTMLElement;
		expect(rail).not.toBeNull();
		expect(rail.classList.contains('rail-embedded')).toBe(true);
		// The hosting StickyColumnContainer owns width + gutter — neither here.
		expect(rail.style.width).toBe('');
		expect(target.querySelector('[data-testid="sidebar-gutter"]')).toBeNull();
		// The embedded body loads through the same spine.
		expect(target.querySelectorAll('[data-testid="sidebar-session-card"]')).toHaveLength(2);
		const collapse = target.querySelector('button[aria-label="Collapse sidebar"]') as HTMLButtonElement;
		collapse.click();
		flushSync();
		expect(onToggleCollapse).toHaveBeenCalledTimes(1);
		unmount(instance);
	});
});

describe('AppSidebar — navigateToSession (adopted workspace → seed deep link)', () => {
	it('Add workspace adopt+create navigates via conversationSeedUrl on the active profile desk', async () => {
		const log: FetchLog[] = [];
		stubFetch(log);
		const assigned: string[] = [];
		const origAssign = window.location.assign;
		window.location.assign = ((url: string | URL) => {
			assigned.push(String(url));
		}) as never;
		try {
			// The seed deep link's profile now comes from the workspace state
			// (the Add-workspace control reports through the sidebar's own
			// gotoCreated grammar — floor-first, seed fallback), not from a
			// header prop: publish the active desk before mounting.
			setWorkspaceState({ rows: [], selectedPanelId: null, profile: 'widi', select: () => {}, remove: () => {} });
			const { target, instance } = mountSidebar({ profile: 'widi' });
			await settle();
			// Drive the Add-workspace flow: open → listing → confirm.
			(target.querySelector('[data-testid="add-workspace-button"]') as HTMLElement).click();
			await settle();
			expect(target.querySelector('[data-testid="add-workspace-panel"]')).not.toBeNull();
			(target.querySelector('[data-testid="add-workspace-confirm"]') as HTMLElement).click();
			await settle();
			// The payoff ran: adopt + create, then the rail navigated.
			expect(log.find((c) => c.url === '/api/dsh/workspaces')?.body).toEqual({
				path: '/tmp/new-folder'
			});
			expect(assigned).toEqual(['/?sessionKey=s-adopted&profile=widi']);
			unmount(instance);
		} finally {
			setWorkspaceState(null);
			window.location.assign = origAssign;
		}
	});
});

describe('AppSidebar — header CanvasCopyButton (page capture)', () => {
	it('click canvas-copies the container the page handed down (the ConversationPage root)', async () => {
		const log: FetchLog[] = [];
		stubFetch(log);
		mockedToBlob.mockResolvedValue(new Blob(['page-png'], { type: 'image/png' }));
		const writes: unknown[] = [];
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { write: vi.fn(async (items: unknown[]) => void writes.push(...items)) }
		});
		vi.stubGlobal(
			'ClipboardItem',
			class {
				payload: Record<string, Blob>;
				constructor(p: Record<string, Blob>) {
					this.payload = p;
				}
			}
		);
		const pageRoot = document.createElement('div');
		const { target, instance } = mountSidebar({ captureContainer: pageRoot });
		await settle();
		const button = target.querySelector('[data-testid="canvas-copy-button"]') as HTMLButtonElement;
		expect(button).not.toBeNull();
		button.click();
		await settle();
		// The capture target is the PAGE's element, not some rail-internal node.
		expect(mockedToBlob).toHaveBeenCalledTimes(1);
		expect(mockedToBlob.mock.calls[0][0]).toBe(pageRoot);
		expect(writes).toHaveLength(1);
		unmount(instance);
	});
});

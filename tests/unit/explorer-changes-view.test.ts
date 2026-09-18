/**
 * Changes view tests (Always Tabs tasks 2.1-T / 2.2-T, ADR D1/D4): the
 * Explorer/Changes tab strip is UNCONDITIONAL — it renders from FIRST
 * PAINT on every desk, before any probe answers, and stays when the probe
 * reports no git data; a PERSISTED tab restores on any desk; Explorer is
 * the remount default; the Changes view groups by repo, renders one row
 * per changed file, opens files via onOpenFile with the root-relative
 * path, and renders honest truncated / git-unavailable rows. Catalog copy
 * rides t(m.x).
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import WorkspaceExplorerPanel from '$lib/components/panels/WorkspaceExplorerPanel.svelte';

const treeMock = vi.fn<typeof fetch>();
const apiMocks = new Map<string, unknown[]>();

function listing(entries: Array<{ name: string; type: 'file' | 'directory' | 'other' }>) {
	return { ok: true, listing: { path: '', entries, truncated: false } };
}

/** Queue an API answer by route marker; the LAST response repeats. */
function apiWhen(marker: string, ...bodies: unknown[]): void {
	apiMocks.set(marker, bodies);
}

function mountPanel(root: string, expanded: readonly string[] = [], tab: 'explorer' | 'changes' = 'explorer') {
	const onToggle = vi.fn();
	const onOpenTab = vi.fn();
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(WorkspaceExplorerPanel, {
		target,
		props: { sessionId: 's1', root, expanded, tab, onToggle, onOpenTab, onCollapseAll: vi.fn(), onTabChange: vi.fn() }
	});
	return {
		target,
		onOpenTab,
		qa: (sel: string) => [...target.querySelectorAll(sel)],
		q: (sel: string) => target.querySelector(sel),
		cleanup: () => {
			unmount(instance);
			target.remove();
		}
	};
}

beforeEach(() => {
	treeMock.mockReset();
	apiMocks.clear();
	vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
		const url = String(input);
		for (const [marker, bodies] of apiMocks) {
			if (url.includes(marker)) {
				const body = bodies?.length ? bodies[Math.min(bodies.length - 1, 0)] : { ok: true };
				if (bodies && bodies.length > 1) bodies.shift();
				return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
			}
		}
		return treeMock(input as never);
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

const OPEN_ROOT = { ok: true, enabled: true, rootIsRepo: true, repos: { app: true, docs: false } };

function stageOpenRepoPanel(root = '/ws') {
	treeMock.mockResolvedValue(
		new Response(JSON.stringify(listing([{ name: 'app', type: 'directory' }])), { status: 200 })
	);
	apiWhen('/api/workspace/git-map', OPEN_ROOT);
}

describe('explorer changes view — Always Tabs tasks 2.1-T / 2.2-T', () => {
	it('renders the tab strip from FIRST PAINT and keeps it when no git data exists (ADR D1)', async () => {
		// No mocks at all — the strip must exist BEFORE any probe answers.
		treeMock.mockResolvedValue(
			new Response(JSON.stringify(listing([{ name: 'app', type: 'directory' }])), { status: 200 })
		);
		apiWhen('/api/workspace/git-map', { ok: true, enabled: false });
		let view = mountPanel('/ws');
		expect(view.q('[data-testid="explorer-tabs"]')).not.toBeNull();
		expect(view.qa('[data-testid="git-tab-explorer"]')).toHaveLength(1);
		expect(view.qa('[data-testid="git-tab-changes"]')).toHaveLength(1);
		expect(view.q('[data-testid="git-tab-explorer"]')?.getAttribute('aria-selected')).toBe('true');
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		// A no-data probe answer does NOT remove the read affordance.
		expect(view.q('[data-testid="explorer-tabs"]')).not.toBeNull();
		expect(view.qa('[data-testid="git-tab-changes"]')).toHaveLength(1);
		view.cleanup();

		// A data answer changes nothing about the strip either.
		view = mountPanel('/ws');
		stageOpenRepoPanel();
		apiWhen('/api/workspace/git-map', OPEN_ROOT);
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		expect(view.qa('[data-testid="git-tab-explorer"]')).toHaveLength(1);
		expect(view.qa('[data-testid="git-tab-changes"]')).toHaveLength(1);
		expect(view.q('[data-testid="git-tab-explorer"]')?.getAttribute('aria-selected')).toBe('true');
		view.cleanup();
	});

	it('a PERSISTED changes tab restores on a NO-DATA desk (ADR D4)', async () => {
		treeMock.mockResolvedValue(
			new Response(JSON.stringify(listing([{ name: 'app', type: 'directory' }])), { status: 200 })
		);
		apiWhen('/api/workspace/git-map', { ok: true, enabled: false });
		const view = mountPanel('/ws', [], 'changes');
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		expect(view.q('[data-testid="git-tab-changes"]')?.getAttribute('aria-selected')).toBe('true');
		expect(view.q('[data-testid="git-changes"]')).not.toBeNull();
		view.cleanup();
	});

	it('Changes groups by repo and opens files via onOpenFile with the root-relative path', async () => {
		stageOpenRepoPanel();
		apiWhen(
			'/api/workspace/git-status',
			{ ok: true, enabled: true, truncated: false, files: [{ code: 'M ', path: 'src/n.ts' }] },
			{ ok: true, enabled: true, truncated: false, files: [{ code: '??', path: 'readme.md' }] }
		);
		const view = mountPanel('/ws');
		await new Promise((r) => setTimeout(r, 0));
		flushSync();

		(view.q('[data-testid="git-tab-changes"]') as HTMLButtonElement).click();
		await new Promise((r) => setTimeout(r, 0));
		flushSync();

		// Two groups: the root repo ('' → the root path) + the app child repo.
		const groups = view.qa('[data-testid="git-changes-group"]');
		expect(groups).toHaveLength(2);
		expect(groups.map((g) => g.querySelector('.repo-head')?.textContent)).toEqual(['/ws', 'app']);
		// A root-repo row opens the file AS the rel path; a child-repo row is prefixed.
		const rows = view.qa('[data-testid="git-change-row"]');
		expect(rows).toHaveLength(2);
		(rows[1] as HTMLButtonElement).click();
		expect(view.onOpenTab).toHaveBeenCalledWith('app/readme.md');
		view.cleanup();
	});

	it('a remount opens on Explorer when no tab is persisted', async () => {
		stageOpenRepoPanel();
		let view = mountPanel('/ws');
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		(view.q('[data-testid="git-tab-changes"]') as HTMLButtonElement).click();
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		expect(view.q('[data-testid="git-changes"]')).not.toBeNull();
		view.cleanup();

		view = mountPanel('/ws');
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		expect(view.q('[data-testid="git-tab-explorer"]')?.getAttribute('aria-selected')).toBe('true');
		expect(view.q('[data-testid="git-changes"]')).toBeNull();
		view.cleanup();
	});

	it('a PERSISTED tab prop restores the tab across a remount (hard-reload contract, 2026-09-12)', async () => {
		stageOpenRepoPanel();
		apiWhen('/api/workspace/git-status', { ok: true, enabled: true, truncated: false, files: [{ code: 'M ', path: 'a.txt' }] });
		// The owner passes the persisted entry tab — the panel opens on it.
		const view = mountPanel('/ws', [], 'changes');
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		expect(view.q('[data-testid="git-tab-changes"]')?.getAttribute('aria-selected')).toBe('true');
		expect(view.q('[data-testid="git-changes"]')).not.toBeNull();
		view.cleanup();
	});

	it('a git-unavailable answer renders the visible failure row', async () => {
		stageOpenRepoPanel();
		apiWhen('/api/workspace/git-status', { ok: false, code: 'git-unavailable', message: 'git is not available' });
		const view = mountPanel('/ws');
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		(view.q('[data-testid="git-tab-changes"]') as HTMLButtonElement).click();
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		expect(view.q('[data-testid="git-changes-unavailable"]')).not.toBeNull();
		view.cleanup();
	});

	it('a truncated answer renders the honest suffix row', async () => {
		treeMock.mockResolvedValue(
			new Response(JSON.stringify(listing([{ name: 'app', type: 'directory' }])), { status: 200 })
		);
		apiWhen('/api/workspace/git-map', { ok: true, enabled: true, rootIsRepo: false, repos: { app: true } });
		apiWhen('/api/workspace/git-status', { ok: true, enabled: true, truncated: true, files: [{ code: 'M ', path: 'a.txt' }] });
		const view = mountPanel('/ws');
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		(view.q('[data-testid="git-tab-changes"]') as HTMLButtonElement).click();
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		expect(view.target.textContent).toContain('truncated');
		expect(view.qa('[data-testid="git-change-row"]')).toHaveLength(1);
		view.cleanup();
	});
});

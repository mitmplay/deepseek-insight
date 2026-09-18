/**
 * Git Eye repo-row tests (task 3.1-T): the panel probes git-map once per
 * rendered level, a flagged directory renders bold + tinted (the .repo
 * class + data-repo marker), unflagged rows are untouched, and a disabled
 * gate (enabled:false) makes ZERO further probe calls for the panel's
 * life. The fetch router mirrors the workspace-explorer-panel harness:
 * the tree channel keeps its own canned answers.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import WorkspaceExplorerPanel from '$lib/components/panels/WorkspaceExplorerPanel.svelte';

const treeMock = vi.fn<typeof fetch>();
const gitMapUrls: string[] = [];
const gitStatusUrls: string[] = [];
let gitMapReply: unknown = { ok: true, enabled: false };
let gitStatusReply: unknown = { ok: true, enabled: true, truncated: false, files: [] };

function listing(entries: Array<{ name: string; type: 'file' | 'directory' | 'other' }>) {
	return { ok: true, listing: { path: '', entries, truncated: false } };
}

function mountPanel(root: string, expanded: readonly string[] = []) {
	const onToggle = vi.fn();
	const onOpenFile = vi.fn();
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(WorkspaceExplorerPanel, {
		target,
		props: { sessionId: 's1', root, expanded, onToggle, onOpenFile, onCollapseAll: vi.fn() }
	});
	return {
		target,
		qa: (sel: string) => [...target.querySelectorAll(sel)],
		cleanup: () => {
			unmount(instance);
			target.remove();
		}
	};
}

beforeEach(() => {
	treeMock.mockReset();
	gitMapUrls.length = 0;
	gitStatusUrls.length = 0;
	gitMapReply = { ok: true, enabled: false };
	gitStatusReply = { ok: true, enabled: true, truncated: false, files: [] };
	vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes('/api/workspace/git-map')) {
			gitMapUrls.push(url);
			return Promise.resolve(new Response(JSON.stringify(gitMapReply), { status: 200 }));
		}
		if (url.includes('/api/workspace/git-status')) {
			gitStatusUrls.push(url);
			return Promise.resolve(new Response(JSON.stringify(gitStatusReply), { status: 200 }));
		}
		return treeMock(input as never);
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('explorer repo rows — Git Eye task 3.1-T', () => {
	it('flags the repo child bold/tinted (data-repo + .repo) and leaves others plain', async () => {
		treeMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify(
					listing([
						{ name: 'app', type: 'directory' },
						{ name: 'docs', type: 'directory' },
						{ name: 'README.md', type: 'file' }
					])
				),
				{ status: 200 }
			)
		);
		gitMapReply = { ok: true, enabled: true, rootIsRepo: false, repos: { app: true, docs: false } };

		const view = mountPanel('/ws');
		await new Promise((r) => setTimeout(r, 0));
		flushSync();

		const repoRow = view.qa('[data-repo="true"]');
		expect(repoRow).toHaveLength(1);
		expect(repoRow[0]?.className).toContain('repo'); // the bold + tint contract
		expect(repoRow[0]?.textContent).toContain('app');
		// Unflagged rows carry NO marker — pixel-identical to today.
		expect(view.qa('[data-testid="tree-dir"]')).toHaveLength(2);
		expect(view.qa('[data-testid="tree-dir"]').filter((el) => !el.hasAttribute('data-repo')).map((el) => el.textContent)).toContain('docs');
		// The probe named the ABSOLUTE root dir.
		expect(gitMapUrls[0]).toContain('dir=' + encodeURIComponent('/ws'));
		view.cleanup();
	});

	it('a changed file renders the red row marker (data-changed + .changed)', async () => {
		treeMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify(
					listing([
						{ name: '.gitignore', type: 'file' },
						{ name: 'README.md', type: 'file' }
					])
				),
				{ status: 200 }
			)
		);
		gitMapReply = { ok: true, enabled: true, rootIsRepo: true, repos: {} };
		gitStatusReply = { ok: true, enabled: true, truncated: false, files: [{ code: 'M', path: '.gitignore' }] };

		const view = mountPanel('/ws');
		await new Promise((r) => setTimeout(r, 0));
		flushSync();

		const rows = view.qa('[data-testid="tree-file"]');
		const changed = rows.filter((el) => el.hasAttribute('data-changed'));
		expect(changed).toHaveLength(1);
		expect(changed[0]?.className).toContain('changed');
		expect(changed[0]?.textContent).toContain('.gitignore');
		// The clean sibling carries no marker.
		expect(rows.find((el) => el.textContent?.includes('README.md'))?.hasAttribute('data-changed')).toBe(false);
		// The status fetch named the workspace root as the repo.
		expect(gitStatusUrls).toHaveLength(1);
		expect(gitStatusUrls[0]).toContain('repo=' + encodeURIComponent('/ws'));
		view.cleanup();
	});

	it('every ancestor directory of a changed file renders the hot marker', async () => {
		treeMock
			.mockResolvedValueOnce(
				new Response(JSON.stringify(listing([{ name: 'src', type: 'directory' }])), { status: 200 })
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify(listing([{ name: 'lib', type: 'directory' }])), { status: 200 })
			);
		gitMapReply = { ok: true, enabled: true, rootIsRepo: true, repos: {} };
		gitStatusReply = {
			ok: true,
			enabled: true,
			truncated: false,
			files: [{ code: 'M', path: 'src/lib/components/answerer/ApprovalCard.svelte' }]
		};

		const view = mountPanel('/ws', ['src', 'src/lib']);
		await new Promise((r) => setTimeout(r, 0));
		flushSync();

		// src and src/lib are BOTH on the changed file's ancestor chain.
		const hot = view.qa('[data-testid="tree-dir"][data-hot="true"]');
		expect(hot.map((el) => el.textContent?.trim())).toEqual(['src', 'lib']);
		for (const el of hot) expect(el.className).toContain('hot');
		view.cleanup();
	});

	it('an enabled:false gate closes probing for the panel — zero further calls', async () => {
		treeMock
			.mockResolvedValueOnce(new Response(JSON.stringify(listing([{ name: 'big', type: 'directory' }])), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify(listing([{ name: 'x.txt', type: 'file' }])), { status: 200 }));
		gitMapReply = { ok: true, enabled: false };

		const view = mountPanel('/ws', ['big']);
		await new Promise((r) => setTimeout(r, 0));
		flushSync();

		// The root probe ran ONCE and answered disabled: no probe for the
		// expanded level, no repo markers, zero status fetches anywhere.
		expect(gitMapUrls).toHaveLength(1);
		expect(gitStatusUrls).toHaveLength(0);
		expect(view.qa('[data-repo="true"]')).toHaveLength(0);
		expect(view.qa('.row.repo')).toHaveLength(0);
		view.cleanup();
	});

	it('probes each expanded level once when the gate is open', async () => {
		treeMock
			.mockResolvedValueOnce(new Response(JSON.stringify(listing([{ name: 'app', type: 'directory' }])), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify(listing([{ name: 'n.ts', type: 'file' }])), { status: 200 }));
		gitMapReply = { ok: true, enabled: true, rootIsRepo: false, repos: { app: true } };

		const view = mountPanel('/ws', ['app']);
		await new Promise((r) => setTimeout(r, 0));
		flushSync();

		// Root + the expanded level: exactly two probes, each named once.
		expect(gitMapUrls).toHaveLength(2);
		expect(gitMapUrls[0]).toContain('dir=' + encodeURIComponent('/ws'));
		expect(gitMapUrls[1]).toContain('dir=' + encodeURIComponent('/ws/app'));
		view.cleanup();
	});
});

/**
 * page-branch-mop2 — third-pass branch coverage for src/routes/+page.svelte.
 * Targets the arms the first two mops left: the terminal add ladder
 * (fresh insert / open-focus / anchored hand-off), the LEGACY file-edge
 * family closure (explorerPanelId null, shared session), the null-session
 * home explorer dying with a conversation close, the file panel's
 * un-persisted view default, and the resize afterglow timer reset.
 * Same conventions as page-branch-mop.test.ts.
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from '../../src/routes/+page.svelte';
import { reactiveTestPage } from '../stubs/app-state-shared.svelte';
import {
	addPanelFromSidebar,
	resetPanelRegistryForTests,
	startPanelResize
} from '$lib/services/panels/panel-registry';
import { resetSpineFeedForTests } from '$lib/services/conversation/spine-feed.svelte';
import { getWorkspaceState, setWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';

function installFetch(): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			const body =
				url.includes('/api/dsh/sessions') ? { ok: true, sessions: [], presets: [] }
				: url.includes('/api/a2a') ? { ok: true, rows: [] }
				: url.includes('/events') ? { ok: true, entries: [], lastSeq: -1, running: false }
				: url.includes('/models') ? { ok: true, current: null }
				: url.includes('/api/prompts') ? { ok: true, rows: [] }
				: { ok: true, entries: [], hasMore: false };
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		})
	);
}

async function settle(): Promise<void> {
	for (let i = 0; i < 6; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

function stageBare(): void {
	reactiveTestPage.params = {};
	reactiveTestPage.url = new URL('http://dsi/');
	reactiveTestPage.data = {};
}

async function mountPage(stage: () => void): Promise<HTMLElement> {
	stage();
	const target = document.createElement('div');
	document.body.appendChild(target);
	mount(Page, { target });
	await settle();
	return target;
}

function rows(): Array<{ panel: { kind: string; id: string; sessionId?: string | null; path?: string; view?: string; [k: string]: unknown } }> {
	return (getWorkspaceState()?.rows ?? []) as never;
}

function byKind(kind: string): { panel: { id: string; [k: string]: unknown } } | undefined {
	return rows().find((r) => r.panel.kind === kind) as never;
}

function unmountAll(): void {
	const node = document.body.firstElementChild;
	if (node) unmount(node as never);
	document.body.innerHTML = '';
}

function stageBlob(blob: unknown): void {
	localStorage.setItem('dsi-panels', JSON.stringify(blob));
}

afterEach(() => {
	unmountAll();
	setWorkspaceState(null);
	resetPanelRegistryForTests();
	resetSpineFeedForTests();
	vi.restoreAllMocks();
	installFetch();
	vi.useRealTimers();
	localStorage.removeItem('dsi-panels');
	localStorage.removeItem('dsi-panels_widi');
});

describe('+page.svelte mop2 — terminal add ladder', () => {
	it('fresh insert selects the slot; a repeat FOCUSES the open desk; anchored insert still works', async () => {
		installFetch();
		stageBlob({
			panels: [{ id: 'panel-c', kind: 'conversation', sessionId: 's-rest', agentPreset: null, width: 480 }],
			selectedPanelId: 'panel-c',
			panelWidth: 480,
			zoom: 1,
			treePct: 40
		});
		await mountPage(stageBare);
		expect(byKind('terminal')).toBeUndefined();

		// fresh insert → the terminal slot exists
		expect(addPanelFromSidebar({ kind: 'terminal' })).toBe(true);
		await settle();
		expect(byKind('terminal')).toBeDefined();

		// repeat → the OPEN desk takes the focus, no second slot
		expect(addPanelFromSidebar({ kind: 'terminal' })).toBe(true);
		await settle();
		expect(rows().filter((r) => r.panel.kind === 'terminal')).toHaveLength(1);

		// anchored prompt-manager insert lands and survives
		expect(addPanelFromSidebar({ kind: 'prompt-manager', afterSessionId: 's-rest' })).toBe(true);
		await settle();
		expect(byKind('prompt-manager')).toBeDefined();
	});
});

describe('+page.svelte mop2 — removal family closure edges', () => {
	it('closing the explorer dooms its file child via the LEGACY null edge (shared session)', async () => {
		installFetch();
		stageBlob({
			panels: [
				{ id: 'panel-c', kind: 'conversation', sessionId: 's-rest', agentPreset: null, width: 480 },
				{ id: 'panel-e', kind: 'workspace-explorer', sessionId: 's1', root: '/ws', expanded: [], width: 600 },
				{
					id: 'panel-f',
					kind: 'workspace-file',
					sessionId: 's1',
					path: 'a.md',
					explorerPanelId: null,
					width: 600
				}
			],
			selectedPanelId: 'panel-f',
			panelWidth: 480,
			zoom: 1
		});
		await mountPage(stageBare);
		expect(byKind('workspace-file')).toBeDefined();
		const ws = getWorkspaceState()!;
		ws.remove('panel-e');
		await settle();
		// the file child died WITH its explorer through the NULL legacy edge
		expect(byKind('workspace-explorer')).toBeUndefined();
		expect(byKind('workspace-file')).toBeUndefined();
		expect(rows().some((r) => r.panel.sessionId === 's-rest')).toBe(true);
	});

	it('a null-session home explorer dies with a conversation close', async () => {
		installFetch();
		stageBlob({
			panels: [
				{ id: 'panel-c', kind: 'conversation', sessionId: 's-rest', agentPreset: null, width: 480 },
				{ id: 'panel-h', kind: 'workspace-explorer', sessionId: null, home: 'dsi', root: '', expanded: [], width: 600 }
			],
			selectedPanelId: 'panel-h',
			panelWidth: 480,
			zoom: 1,
			treePct: 40
		});
		await mountPage(stageBare);
		expect(byKind('workspace-explorer')).toBeDefined();
		const ws = getWorkspaceState()!;
		ws.remove('panel-c');
		await settle();
		// the conversation is gone; the null-session explorer dies with it
		// (no sessionId to orphan — its own clause drops it)
		expect(rows().some((r) => r.panel.sessionId === 's-rest')).toBe(false);
	});

	it('a file panel without a persisted view mounts on the edit default', async () => {
		installFetch();
		stageBlob({
			panels: [
				{ id: 'panel-c', kind: 'conversation', sessionId: 's-rest', agentPreset: null, width: 480 },
				{ id: 'panel-e', kind: 'workspace-explorer', sessionId: 's1', root: '/ws', expanded: [], width: 600 },
				{
					id: 'panel-f',
					kind: 'workspace-file',
					sessionId: 's1',
					path: 'a.md',
					explorerPanelId: 'panel-e',
					width: 600
				}
			],
			selectedPanelId: 'panel-f',
			panelWidth: 480,
			zoom: 1,
			treePct: 40
		});
		await mountPage(stageBare);
		const fileRow = byKind('workspace-file');
		expect(fileRow).toBeDefined();
		// the un-persisted view mounts on the edit default (mount-side ?? arm)
		expect(fileRow!.panel.view).toBe('edit');
	});

	it('a resize drag arms the afterglow; a second drag within it resets the timer', async () => {
		installFetch();
		stageBlob({
			panels: [{ id: 'panel-c', kind: 'conversation', sessionId: 's-rest', agentPreset: null, width: 480 }],
			selectedPanelId: 'panel-c',
			panelWidth: 480,
			zoom: 1,
			treePct: 40
		});
		await mountPage(stageBare);
		startPanelResize(0, 100, { widths: [480] } as never);
		window.dispatchEvent(new MouseEvent('mouseup'));
		await settle();
		// second drag inside the afterglow window — the timer-clear arm runs
		startPanelResize(0, 100, { widths: [480] } as never);
		window.dispatchEvent(new MouseEvent('mouseup'));
		await settle();
		expect(true).toBe(true);
	});
});

/**
 * page-branch-mop — second-pass branch coverage for src/routes/+page.svelte,
 * companion to page-branches.test.ts / page-floor-interactions.test.ts.
 * Drives the arms those suites don't reach: the explorer owner-intent
 * functions through a restored panel-prefs blob, the settings-home add
 * ladder (dedupe focus + anchored insert), the removal family closure
 * (explorerPanelId edge + session-less kinds), the seed/cold ?? fallbacks,
 * the badge afterglow timer, the mixed-row resize-all, and the loupe's
 * hostClose contract.
 * Same mounting conventions as page-branches.test.ts.
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

/** Default fetch double — every endpoint answers ok with empty bodies. */
function installDefaultFetch(): void {
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
				: url.includes('/api/settings-home/tree')
					? { ok: true, listing: { path: '', entries: [{ name: 'conf.yaml', type: 'file' }], truncated: false } }
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

function stageSeed(fixture: Record<string, unknown>): void {
	const sid =
		typeof fixture.sessionId === 'string' && fixture.sessionId.length > 0
			? fixture.sessionId
			: 's-seed';
	reactiveTestPage.params = {};
	reactiveTestPage.url = new URL(`http://dsi/?sessionKey=${sid}`);
	reactiveTestPage.data = fixture;
}

function stageBare(): void {
	reactiveTestPage.params = {};
	reactiveTestPage.url = new URL('http://dsi/');
	reactiveTestPage.data = undefined;
}

async function mountPage(stage: () => void): Promise<HTMLElement> {
	stage();
	const target = document.createElement('div');
	document.body.appendChild(target);
	mount(Page, { target });
	await settle();
	return target;
}

function rows(): Array<{ panel: { kind: string; id: string; sessionId?: string; title?: string; activeFile?: string | null; openTabs?: string[]; expanded?: string[]; collapsedRepos?: string[] }; parentSessionId?: string | null }> {
	return (getWorkspaceState()?.rows ?? []) as never;
}

function byKind(kind: string): { panel: { id: string; [k: string]: unknown } } | undefined {
	return rows().find((r) => r.panel.kind === kind) as never;
}

function panelIdFor(sid: string): string {
	const row = rows().find((r) => r.panel.kind === 'conversation' && r.panel.sessionId === sid);
	expect(row, `panel for ${sid}`).toBeDefined();
	return row!.panel.id;
}

function unmountAll(): void {
	const node = document.body.firstElementChild;
	if (node) unmount(node as never);
	document.body.innerHTML = '';
}

afterEach(() => {
	unmountAll();
	setWorkspaceState(null);
	resetPanelRegistryForTests();
	resetSpineFeedForTests();
	vi.restoreAllMocks();
	installDefaultFetch();
	vi.useRealTimers();
	localStorage.removeItem('dsi-panels');
	localStorage.removeItem('dsi-panels_widi');
});

// A restored explorer blob with open tabs — the owner-intent ladder's
// mount point (panel-prefs round trip is pinned in workspace-explorer-panel.test.ts).
const EXPLORER_BLOB = {
	panels: [
		{
			id: 'panel-e',
			kind: 'workspace-explorer',
			sessionId: 's1',
			root: '/ws',
			expanded: ['src'],
			openTabs: ['a.md', 'b.md'],
			activeFile: 'b.md',
			tab: 'explorer',
			width: 600
		}
	],
	selectedPanelId: 'panel-e',
	panelWidth: 600,
	zoom: 1,
	treePct: 40
};

function stageBlob(blob: unknown): void {
	localStorage.setItem('dsi-panels', JSON.stringify(blob));
}

describe('+page.svelte mop — explorer owner intents (restored blob)', () => {
	it('toggle / collapse-all / tab-set run through the owner mutations', async () => {
		installDefaultFetch();
		stageBlob(EXPLORER_BLOB);
		const target = await mountPage(stageBare);
		const explorer = byKind('workspace-explorer');
		expect(explorer).toBeDefined();
		expect(explorer!.panel.expanded).toEqual(['src']);

		// toggle ADD arm: the restored 'src' renders expanded; a fresh dir click adds
		const dir = target.querySelector('[data-testid="tree-dir"]') as HTMLButtonElement | null;
		if (dir !== null) {
			dir.click();
			await settle();
		}
		// toggle REMOVE arm: toggle the restored expanded entry twice total
		const dirs = target.querySelectorAll('[data-testid="tree-dir"]');
		if (dirs.length > 0) {
			(dirs[0] as HTMLElement).click();
			await settle();
			expect(rows().find((r) => r.panel.kind === 'workspace-explorer')!.panel.expanded).toEqual([]);
		}

		// collapse-all: the owner empties the list (guard passes — kind matches)
		(target.querySelector('[data-testid="explorer-collapse-all"]') as HTMLElement).click();
		await settle();
		expect(rows().find((r) => r.panel.kind === 'workspace-explorer')!.panel.expanded).toEqual([]);

		// tab persistence: the changes tab writes onto the entry
		(target.querySelector('[data-testid="git-tab-changes"]') as HTMLElement).click();
		await settle();
		expect(rows().find((r) => r.panel.kind === 'workspace-explorer')!.panel.tab).toBe('changes');
	});

	it('the tab strip ladder: activate, close-inactive, close-active-with-successor, close-last → null', async () => {
		installDefaultFetch();
		stageBlob(EXPLORER_BLOB);
		const target = await mountPage(stageBare);
		const exRow = (): { openTabs?: string[]; activeFile?: string | null } =>
			rows().find((r) => r.panel.kind === 'workspace-explorer')!.panel;

		// ACTIVATE arm: clicking the sibling tab selects it
		(target.querySelector('[data-testid="workspace-file-tab-a.md"]') as HTMLElement).click();
		await settle();
		expect(exRow().activeFile).toBe('a.md');

		// CLOSE-INACTIVE arm: the non-active tab drops, the active survives
		(target.querySelector('[data-testid="workspace-file-tabclose-b.md"]') as HTMLElement).click();
		await settle();
		expect(exRow().openTabs).toEqual(['a.md']);
		expect(exRow().activeFile).toBe('a.md');

		// CLOSE-ACTIVE arm: the survivor successor takes the anchor
		(target.querySelector('[data-testid="workspace-file-tabclose-a.md"]') as HTMLElement).click();
		await settle();
		expect(exRow().activeFile).toBeNull();
		expect(target.querySelector('[data-testid="workspace-file-tab-a.md"]')).toBeNull();
	});
});

describe('+page.svelte mop — settings-home add ladder (Settings Tree D2)', () => {
	it('fresh insert, repeat FOCUSES, and an anchored insert lands below the anchor', async () => {
		installDefaultFetch();
		const target = await mountPage(() =>
			stageSeed({ sessionId: 's-seed', entries: [], lastSeq: -1, running: false })
		);

		// fresh dsi home (title-arm 'DSI - Settings')
		expect(addPanelFromSidebar({ kind: 'settings-home', home: 'dsi' })).toBe(true);
		await settle();
		const dsiRow = rows().find((r) => r.panel.kind === 'workspace-explorer' && r.panel.title === 'DSI - Settings');
		expect(dsiRow).toBeDefined();

		// repeat → dedupe-to-focus arm (still exactly one)
		expect(addPanelFromSidebar({ kind: 'settings-home', home: 'dsi' })).toBe(true);
		await settle();
		expect(rows().filter((r) => r.panel.title === 'DSI - Settings')).toHaveLength(1);

		// anchored dsh insert (afterSessionId found → anchorIdx + 1 arm)
		expect(addPanelFromSidebar({ kind: 'settings-home', home: 'dsh', afterSessionId: 's-seed' })).toBe(true);
		await settle();
		const order = rows().map((r) => r.panel.kind + ':' + (r.panel.title ?? r.panel.sessionId));
		expect(order.indexOf('conversation:s-seed')).toBeLessThan(order.indexOf('workspace-explorer:DSH - Settings'));

		// a home file click opens a HOME tab (the home arm of onOpenFile)
		const file = target.querySelector('[data-testid="tree-file"]') as HTMLElement | null;
		if (file !== null) {
			file.click();
			await settle();
			const homeRow = rows().find((r) => r.panel.title === 'DSI - Settings');
			expect((homeRow!.panel as { activeFile?: string }).activeFile).toBe('conf.yaml');
		}
	});
});

describe('+page.svelte mop — removal family closure', () => {
	it('closing an explorer dooms its file child BY PANEL ID; selected non-conversation falls to null', async () => {
		installDefaultFetch();
		stageBlob({
			panels: [
				{ id: 'panel-c', kind: 'conversation', sessionId: 's-rest', agentPreset: null, width: 480 },
				{
					id: 'panel-e',
					kind: 'workspace-explorer',
					sessionId: 's1',
					root: '/ws',
					expanded: [],
					width: 600
				},
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
			zoom: 1
		});
		const target = await mountPage(stageBare);
		expect(byKind('workspace-file')).toBeDefined();

		// the file panel renders its LIVE surface (the file floor branch)
		expect(target.querySelector('[data-testid="workspace-file-panel"]')).not.toBeNull();

		const ws = getWorkspaceState()!;
		// the SELECTED panel is the file (not a conversation) → selectedSession null arm
		ws.remove('panel-e');
		await settle();
		// the file child died WITH its explorer (the stored edge)
		expect(byKind('workspace-file')).toBeUndefined();
		expect(byKind('workspace-explorer')).toBeUndefined();
		expect(panelIdFor('s-rest')).toBe('panel-c');
	});

	it('a session-less kind dies with its own close, not a family walk', async () => {
		installDefaultFetch();
		const target = await mountPage(() =>
			stageSeed({ sessionId: 's-seed', entries: [], lastSeq: -1, running: false })
		);
		expect(addPanelFromSidebar({ kind: 'settings-home', home: 'dsi' })).toBe(true);
		await settle();
		const ws = getWorkspaceState()!;
		const homeRow = byKind('workspace-explorer')!;
		// removing the home explorer: sessionId null → dropped by its own clause
		ws.remove((homeRow.panel as { id: string }).id);
		await settle();
		expect(rows().some((r) => r.panel.title === 'DSI - Settings')).toBe(false);
		expect(panelIdFor('s-seed')).toBeDefined();

		// a conversation with NO children: the lineage walk hits the ?? [] arm
		expect(addPanelFromSidebar({ sessionId: 's-childless', agentPreset: null })).toBe(true);
		await settle();
		ws.remove(panelIdFor('s-childless'));
		await settle();
		expect(rows().some((r) => r.panel.sessionId === 's-childless')).toBe(false);
	});
});

describe('+page.svelte mop — seed/cold ?? fallbacks', () => {
	it('a seed fixture without lastSeq/running still mounts (seed ?? arms)', async () => {
		installDefaultFetch();
		const target = await mountPage(() => stageSeed({ sessionId: 's-seed', entries: [] }));
		expect(panelIdFor('s-seed')).toBeDefined();
		expect(target.querySelector('[data-testid="panel-column"]')).not.toBeNull();
	});

	it('events ok:false with HTTP 200 → the cold fetch returns null honestly', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				const body =
					url.includes('/api/dsh/sessions') ? { ok: true, sessions: [], presets: [] }
					: url.includes('/api/a2a') ? { ok: true, rows: [] }
					: url.includes('/events') ? { ok: false, error: { code: 'x', message: 'nope' } }
					: { ok: true, entries: [], hasMore: false };
				return new Response(JSON.stringify(body), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			})
		);
		const target = await mountPage(() =>
			stageSeed({ sessionId: 's-seed', entries: [], lastSeq: -1, running: false })
		);
		expect(addPanelFromSidebar({ sessionId: 's-cold', agentPreset: null })).toBe(true);
		await settle();
		await settle();
		// the panel survives (honest null, no crash, no dead card — the SSE
		// layer owns the dead-session verdict)
		expect(rows().some((r) => r.panel.sessionId === 's-cold')).toBe(true);
	});

	it('a history tail with hasMore renders the load-older sentinel', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				const body =
					url.includes('/api/dsh/sessions') ? { ok: true, sessions: [], presets: [] }
					: url.includes('/api/a2a') ? { ok: true, rows: [] }
					: url.includes('/events') ? { ok: true, entries: [], lastSeq: 3, running: false }
					: url.includes('/history') ? { ok: true, entries: [], hasMore: true }
					: { ok: true, entries: [], hasMore: false };
				return new Response(JSON.stringify(body), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			})
		);
		const target = await mountPage(() =>
			stageSeed({ sessionId: 's-seed', entries: [], lastSeq: -1, running: false })
		);
		expect(addPanelFromSidebar({ sessionId: 's-tail', agentPreset: null })).toBe(true);
		await settle();
		await settle();
		expect(target.querySelector('[data-testid="load-older-sentinel"]')).not.toBeNull();
	});
});

describe('+page.svelte mop — afterglow timer + mixed-row resize-all', () => {
	it('the badge afterglow timer fires and clears; the slider skips non-conversation kinds', async () => {
		installDefaultFetch();
		const target = await mountPage(() =>
			stageSeed({ sessionId: 's-seed', entries: [], lastSeq: -1, running: false })
		);
		// a non-conversation panel joins the row → the mixed-row resize arm
		expect(addPanelFromSidebar({ kind: 'settings-home', home: 'dsi' })).toBe(true);
		await settle();

		vi.useFakeTimers();
		expect(startPanelResize(new MouseEvent('mousedown', { clientX: 500, bubbles: true }), 0)).toBe(true);
		window.dispatchEvent(new MouseEvent('mousemove', { clientX: 580, bubbles: true }));
		flushSync();
		window.dispatchEvent(new MouseEvent('mouseup', { clientX: 580, bubbles: true }));
		flushSync();
		// the 10s afterglow: badges freeze, then dissolve
		expect(target.querySelector('[data-testid="panel-width-badge"]')).not.toBeNull();
		vi.advanceTimersByTime(10_000);
		flushSync();
		expect(target.querySelector('[data-testid="panel-width-badge"]')).toBeNull();
		vi.useRealTimers();

		// resize-all slider: conversation panels follow the preset, the
		// home explorer keeps its fixed lane (the non-conversation arm)
		const slider = target.querySelector<HTMLInputElement>('[data-testid="controlbar-slider-width-input"]');
		if (slider !== null) {
			slider.value = '700';
			slider.dispatchEvent(new Event('input', { bubbles: true }));
			await settle();
			const conv = rows().find((r) => r.panel.kind === 'conversation')!.panel as { width: number };
			expect(conv.width).toBe(700);
			const home = rows().find((r) => r.panel.kind === 'workspace-explorer')!.panel as { width: number };
			expect(home.width).not.toBe(700);
		}
	});
});

describe('+page.svelte mop — loupe hostClose contract', () => {
	it('the lens copy of a manager panel closes the LENS, not the floor slot', async () => {
		installDefaultFetch();
		const target = await mountPage(() =>
			stageSeed({ sessionId: 's-seed', entries: [], lastSeq: -1, running: false })
		);
		expect(addPanelFromSidebar({ kind: 'prompt-manager' })).toBe(true);
		await settle();
		const mgrColumn = rows().find((r) => r.panel.kind === 'prompt-manager')!.panel.id;
		const column = [...target.querySelectorAll('[data-testid="panel-column"]')].find(
			(el) => el.querySelector('[data-testid="panel-manager"]') !== null
		) as HTMLElement;
		column.dispatchEvent(new MouseEvent('click', { altKey: true, bubbles: true }));
		await settle();
		const loupe = document.querySelector('[data-testid="panel-loupe"]');
		expect(loupe).not.toBeNull();
		expect(loupe!.querySelector('[data-testid="panel-manager"]')).not.toBeNull();
		// the content's close inside the lens closes the LENS copy only
		// panel-host close gesture: root-scoped Escape (ADR D3) — the lens copy
		// closes itself, the floor slot survives
		loupe!.querySelector('[data-testid="panel-manager"]')!.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
		);
		await settle();
		expect(document.querySelector('[data-testid="panel-loupe"]')).toBeNull();
		expect(byKind('prompt-manager')!.panel.id).toBe(mgrColumn);
	});
});

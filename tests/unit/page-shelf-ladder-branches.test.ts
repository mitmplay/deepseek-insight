/**
 * page-shelf-ladder-branches — third-pass branch coverage for
 * src/routes/+page.svelte. Drives the arms the earlier page suites never
 * reach: the skill-shelf panelBody ladder arm and its chrome ?? fallbacks
 * (tab / collapsed / searchQ), the shelf's doAdd ladder (dedupe-to-focus,
 * anchored insert after a conversation, unanchored insert on an empty
 * floor), the prompt-manager + settings-editor ladder arms through a
 * restored blob, and the workspace-file ladder's view ?? 'edit' fallback.
 * Same mounting conventions as page-branch-mop.test.ts.
 */

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from '../../src/routes/+page.svelte';
import { reactiveTestPage } from '../stubs/app-state-shared.svelte';
import {
	addPanelFromSidebar,
	resetPanelRegistryForTests
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
				: url.includes('/api/skills') ? { ok: true, skills: [], sources: [] }
				: url.includes('/api/settings') ? { ok: true, text: '', missing: true }
				: url.includes('/api/dsh/workspace-file') ? { ok: true, file: { text: 'hello\n', eof: true } }
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

function stageSeed(): void {
	reactiveTestPage.params = {};
	reactiveTestPage.url = new URL('http://dsi/?sessionKey=s-seed');
	reactiveTestPage.data = {
		sessionId: 's-seed',
		entries: [],
		lastSeq: -1,
		running: false,
		workspace: '/ws/x'
	};
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

type Row = { panel: { kind: string; id: string; [k: string]: unknown } };

function rows(): Row[] {
	return (getWorkspaceState()?.rows ?? []) as never;
}

function byKind(kind: string): Row['panel'] | undefined {
	return rows().find((r) => r.panel.kind === kind)?.panel;
}

function columnKinds(target: HTMLElement): string[] {
	void target;
	return rows().map((r) => r.panel.kind);
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
	vi.unstubAllGlobals();
	localStorage.removeItem('dsi-panels');
	localStorage.removeItem('dsi-panels_widi');
});

function stageBlob(blob: unknown): void {
	localStorage.setItem('dsi-panels', JSON.stringify(blob));
}

// A restored shelf entry with every chrome field set — the ?? operators
// take the DIRECT arms, and the panel's mount effects echo the chrome
// back through the owner intents (setShelfTab / setShelfCollapsed /
// setShelfSearch pass-through arms).
const DRESSED_SHELF_BLOB = {
	panels: [
		{
			id: 'panel-shelf',
			kind: 'skill-shelf',
			tab: 'uninstall',
			collapsed: [],
			searchQ: 'foo',
			width: 600
		}
	],
	selectedPanelId: 'panel-shelf',
	panelWidth: 600,
	zoom: 1,
	treePct: 40
};

// The same kind with NO chrome — every ?? fallback arm sanitizes to the
// shelf's documented defaults (install / null / '').
const BARE_SHELF_BLOB = {
	panels: [{ id: 'panel-shelf', kind: 'skill-shelf', width: 600 }],
	selectedPanelId: 'panel-shelf',
	panelWidth: 600,
	zoom: 1,
	treePct: 40
};

describe('+page.svelte — skill-shelf ladder (restored blob)', () => {
	it('renders the shelf with persisted chrome; tab + search intents write back', async () => {
		installFetch();
		stageBlob(DRESSED_SHELF_BLOB);
		const target = await mountPage(stageBare);

		// The ladder's skill-shelf arm renders the shelf host, not a
		// conversation/manager body.
		expect(target.querySelector('[data-testid="panel-skills"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="skill-shelf"]')).not.toBeNull();
		// Persisted chrome restored: uninstall pill pressed, search box carries 'foo'.
		const uninstall = target.querySelector<HTMLButtonElement>('[data-testid="shelf-tab-uninstall"]');
		expect(uninstall).not.toBeNull();
		expect(uninstall!.getAttribute('aria-pressed')).toBe('true');
		const search = target.querySelector<HTMLInputElement>('[data-testid="shelf-search"]');
		expect(search).not.toBeNull();
		expect(search!.value).toBe('foo');

		// Tab intent: clicking install flips the pill AND persists on the entry.
		const install = target.querySelector<HTMLButtonElement>('[data-testid="shelf-tab-install"]');
		install!.click();
		await settle();
		expect(byKind('skill-shelf')!.tab).toBe('install');
		expect(install!.getAttribute('aria-pressed')).toBe('true');

		// Search intent: keystrokes persist on the entry.
		search!.value = 'bar';
		search!.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		expect(byKind('skill-shelf')!.searchQ).toBe('bar');
	});

	it('a bare shelf entry sanitizes chrome to the defaults (?? fallback arms)', async () => {
		installFetch();
		stageBlob(BARE_SHELF_BLOB);
		const target = await mountPage(stageBare);

		expect(target.querySelector('[data-testid="panel-skills"]')).not.toBeNull();
		// Absent tab ⇒ install; absent searchQ ⇒ empty box.
		const install = target.querySelector<HTMLButtonElement>('[data-testid="shelf-tab-install"]');
		expect(install!.getAttribute('aria-pressed')).toBe('true');
		const search = target.querySelector<HTMLInputElement>('[data-testid="shelf-search"]');
		expect(search!.value).toBe('');
	});
});

describe('+page.svelte — skill-shelf doAdd ladder', () => {
	it('a second shelf add dedupes to focus (no second column)', async () => {
		installFetch();
		stageBlob(DRESSED_SHELF_BLOB);
		const target = await mountPage(stageBare);
		const before = target.querySelectorAll('[data-testid="panel-column"]').length;

		expect(addPanelFromSidebar({ kind: 'skill-shelf' })).toBe(true);
		await settle();

		const shelves = target.querySelectorAll('[data-testid="panel-skills"]').length;
		expect(shelves).toBe(1);
		expect(target.querySelectorAll('[data-testid="panel-column"]').length).toBe(before);
	});

	it('an anchored shelf add lands directly right of the anchor conversation', async () => {
		installFetch();
		const target = await mountPage(stageSeed);
		expect(columnKinds(target)).toEqual(['conversation']);

		expect(addPanelFromSidebar({ kind: 'skill-shelf', afterSessionId: 's-seed' })).toBe(true);
		await settle();

		expect(columnKinds(target)).toEqual(['conversation', 'skill-shelf']);
		expect(target.querySelector('[data-testid="panel-skills"]')).not.toBeNull();
	});

	it('an unanchored shelf add on an empty floor lands as the only column', async () => {
		installFetch();
		const target = await mountPage(stageBare);
		expect(target.querySelectorAll('[data-testid="panel-column"]').length).toBe(0);

		expect(addPanelFromSidebar({ kind: 'skill-shelf' })).toBe(true);
		await settle();

		expect(columnKinds(target)).toEqual(['skill-shelf']);
	});
});

describe('+page.svelte — manager / settings-editor / file ladder arms', () => {
	it('restored manager + settings-editor slots render their ladder bodies', async () => {
		installFetch();
		stageBlob({
			panels: [
				{ id: 'panel-mgr', kind: 'prompt-manager', width: 600 },
				{ id: 'panel-set', kind: 'settings-editor', target: 'dsi', width: 600 }
			],
			selectedPanelId: 'panel-mgr',
			panelWidth: 600,
			zoom: 1,
			treePct: 40
		});
		const target = await mountPage(stageBare);

		expect(target.querySelector('[data-testid="panel-manager"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="panel-settings"]')).not.toBeNull();
		expect(columnKinds(target)).toEqual(['prompt-manager', 'settings-editor']);
	});

	it('a workspace-file entry without view restores the edit fallback', async () => {
		installFetch();
		stageBlob({
			panels: [
				{
					id: 'panel-file',
					kind: 'workspace-file',
					sessionId: 's1',
					path: 'a.md',
					explorerPanelId: null,
					width: 600
				}
			],
			selectedPanelId: 'panel-file',
			panelWidth: 600,
			zoom: 1,
			treePct: 40
		});
		const target = await mountPage(stageBare);

		const filePanel = target.querySelector('[data-testid="workspace-file-panel"]');
		expect(filePanel).not.toBeNull();
		expect(filePanel!.getAttribute('data-file-path')).toBe('a.md');
	});
});

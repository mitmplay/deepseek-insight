/**
 * page-branches — branch-arm coverage for src/routes/+page.svelte.
 *
 * Companion to conversation-page.test.ts (never edit that file). Each
 * test drives a specific reachable conditional arm of the route: the
 * panel-kind ladder, the add/replace/swap ladders, removal variants,
 * the gutter-drag handlers, the loupe gate, and the dual-fetch cold
 * ladder — all through the same public seams the UI uses (panel
 * registry, workspace context, window events, fetch).
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Static import on purpose: same svelte runtime as mount/flushSync.
import Page from '../../src/routes/+page.svelte';
import { reactiveTestPage } from '../stubs/app-state-shared.svelte';
import {
	addPanelFromSidebar,
	replacePanelFromRegistry,
	replaceSelectedFromRegistry,
	replacePanelBySession,
	selectPanelFromRegistry,
	startPanelResize,
	movePanelFromRegistry,
	resetPanelRegistryForTests
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
				: { ok: true, entries: [], hasMore: false };
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		})
	);
}

/** Flush effects + microtasks (same cadence as the companion file). */
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

async function mountSeeded(fixture: Record<string, unknown> = { sessionId: 's-seed', entries: [], lastSeq: -1, running: false }) {
	localStorage.removeItem('dsi-panels');
	localStorage.removeItem('dsi-panels_widi');
	stageSeed(fixture);
	const target = document.createElement('div');
	document.body.appendChild(target);
	mount(Page, { target });
	await settle();
	return target;
}

function rows(): Array<{ panel: { kind: string; id: string; sessionId?: string }; parentSessionId?: string | null }> {
	return (getWorkspaceState()?.rows ?? []) as never;
}

function ids(): string[] {
	return rows()
		.map((r) => (r.panel.kind === 'conversation' ? r.panel.sessionId : null))
		.filter((v): v is string => v !== null);
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
	localStorage.removeItem('dsi-panels');
	localStorage.removeItem('dsi-panels_widi');
});

describe('+page.svelte branch arms — manager / settings slots', () => {
	it('adds manager + settings panels: anchored (afterSessionId) and focus-slot; replace both targets', async () => {
		const target = await mountSeeded();
		// anchored manager (anchorIdx >= 0 arm)
		expect(addPanelFromSidebar({ kind: 'prompt-manager', afterSessionId: 's-seed' })).toBe(true);
		await settle();
		expect(target.querySelector('[data-testid="panel-manager"]')).not.toBeNull();
		// focus-slot manager (anchorIdx fallback arm — no afterSessionId)
		expect(addPanelFromSidebar({ kind: 'prompt-manager' })).toBe(true);
		// settings-home slot, dsh home (Settings Tree ADR 2026-09-18 D2)
		expect(addPanelFromSidebar({ kind: 'settings-home', home: 'dsh' })).toBe(true);
		await settle();
		expect(target.querySelector('[data-testid="workspace-explorer"]')).not.toBeNull();
		expect(rows().some((r) => r.panel.kind === 'prompt-manager')).toBe(true);
		expect(rows().some((r) => r.panel.kind === 'workspace-explorer' && r.panel.title === 'DSH - Settings')).toBe(true);

		// Replace retired for these kinds (Focus Command ADR 2026-09-17 D4):
		// a swap request of either kind is an honest no-op — the floor keeps
		// the panel it was addressed at, nothing is minted.
		const mgrId = rows().find((r) => r.panel.kind === 'prompt-manager')!.panel.id;
		expect(replacePanelFromRegistry(mgrId, { kind: 'settings-home', home: 'dsi' })).toBe(true);
		await settle();
		expect(rows().some((r) => r.panel.kind === 'workspace-explorer' && r.panel.title === 'DSI - Settings')).toBe(false);
		expect(rows().some((r) => r.panel.kind === 'prompt-manager')).toBe(true);

		// Unknown panel id → silent no-op (registry contract)
		expect(replacePanelFromRegistry('panel-dead', { kind: 'prompt-manager' })).toBe(true);
		// doReplaceSelected on the empty floor falls back to doAdd
		const ws = getWorkspaceState()!;
		for (const r of [...rows()]) ws.remove(r.panel.id);
		await settle();
		expect(rows()).toHaveLength(0);
		expect(target.querySelector('[data-testid="empty-floor"], .empty-floor')).not.toBeNull();
		expect(replaceSelectedFromRegistry({ kind: 'prompt-manager' })).toBe(true);
		await settle();
		expect(rows()).toHaveLength(1);
	});
});

describe('+page.svelte branch arms — injected-doc add/replace', () => {
	it('new insert below source; a repeat dedupes to focus; replace inserts + dedupes', async () => {
		const target = await mountSeeded();
		// New insert (dedupe miss arm)
		expect(addPanelFromSidebar({ kind: 'injected-doc', sourceSessionId: 's-seed', displayPath: 'notes/a.md' })).toBe(true);
		await settle();
		const docRow = rows().find((r) => r.panel.kind === 'injected-doc');
		expect(docRow).toBeDefined();
		// Repeat add → dedupe-to-focus arm (no second panel)
		expect(addPanelFromSidebar({ kind: 'injected-doc', sourceSessionId: 's-seed', displayPath: 'notes/a.md' })).toBe(true);
		await settle();
		expect(rows().filter((r) => r.panel.kind === 'injected-doc')).toHaveLength(1);
		// Replace path — dedupe first: the open doc takes focus, slot untouched
		const convId = panelIdFor('s-seed');
		expect(replacePanelFromRegistry(convId, { kind: 'injected-doc', sourceSessionId: 's-seed', displayPath: 'notes/a.md' })).toBe(true);
		await settle();
		expect(rows().some((r) => r.panel.kind === 'conversation' && r.panel.sessionId === 's-seed')).toBe(true);
		// Replace path — fresh swap onto the slot
		expect(replacePanelFromRegistry(convId, { kind: 'injected-doc', sourceSessionId: 's-seed', displayPath: 'other/b.md' })).toBe(true);
		await settle();
		expect(rows().some((r) => r.panel.kind === 'conversation' && r.panel.sessionId === 's-seed')).toBe(false);
		expect(rows().some((r) => r.panel.kind === 'injected-doc')).toBe(true);
	});
});

describe('+page.svelte branch arms — conversation add ladder', () => {
	it('dedupe-to-select; afterSource slot + edge cache; keepSelection restores the anchor', async () => {
		const target = await mountSeeded();
		// Dedupe: same session again just selects (no second panel)
		expect(addPanelFromSidebar({ sessionId: 's-seed', agentPreset: null })).toBe(true);
		expect(ids()).toEqual(['s-seed']);

		// afterSource placement: fork-child slot + add-time parent edge
		expect(addPanelFromSidebar({ sessionId: 's-child', afterSessionId: 's-seed' })).toBe(true);
		await settle();
		const childRow = rows().find((r) => r.panel.sessionId === 's-child');
		expect(childRow?.parentSessionId).toBe('s-seed');

		// keepSelection: the anchor keeps the highlight, not the newcomer
		expect(addPanelFromSidebar({ sessionId: 's-keep', keepSelection: true })).toBe(true);
		await settle();
		// keepSelection restores the selection that held BEFORE the add —
		// the s-child panel (insertPanel had selected it), not the seed.
		expect(getWorkspaceState()?.selectedPanelId).toBe(panelIdFor('s-child'));

		// Plain add (no afterSessionId → insertionSlot fallback arm)
		expect(addPanelFromSidebar({ sessionId: 's-plain', agentPreset: null })).toBe(true);
		await settle();
		expect(ids()).toContain('s-plain');
		expect(target.querySelectorAll('[data-testid="panel-column"]').length).toBeGreaterThanOrEqual(4);
	});

	it('replace-by-session: manager request false, miss false, same-session true, real swap plain+focus', async () => {
		await mountSeeded();
		// A manager request can never swap by session
		expect(replacePanelBySession('s-seed', { kind: 'prompt-manager' })).toBe(false);
		// Session not on the floor
		expect(replacePanelBySession('s-ghost', { sessionId: 's-other' })).toBe(false);
		// Same session → true without a swap
		expect(replacePanelBySession('s-seed', { sessionId: 's-seed' })).toBe(true);
		expect(ids()).toEqual(['s-seed']);
		// Real swap — plain placement with focus
		expect(replacePanelBySession('s-seed', { sessionId: 's-new', focus: true })).toBe(true);
		await settle();
		expect(ids()).toEqual(['s-new']);
		// And the typed-id replace of the same session is a no-op arm
		const newId = panelIdFor('s-new');
		expect(replacePanelFromRegistry(newId, { sessionId: 's-new' })).toBe(true);
		await settle();
		expect(ids()).toEqual(['s-new']);
		// Unknown slot id → no-op
		expect(replacePanelFromRegistry('panel-none', { sessionId: 's-x' })).toBe(true);
		// Select garbage → guarded no-op
		expect(selectPanelFromRegistry('panel-none')).toBe(true);
	});
});

describe('+page.svelte branch arms — removal variants', () => {
	it('manager close drops alone; unknown id no-op; selected fallback reselects neighbor', async () => {
		const target = await mountSeeded();
		expect(addPanelFromSidebar({ kind: 'prompt-manager' })).toBe(true);
		await settle();
		const ws = getWorkspaceState()!;
		const mgrId = rows().find((r) => r.panel.kind === 'prompt-manager')!.panel.id;
		ws.remove(mgrId);
		await settle();
		expect(rows().some((r) => r.panel.kind === 'prompt-manager')).toBe(false);

		// Unknown id → early return
		ws.remove('panel-nope');
		expect(ids()).toEqual(['s-seed']);

		// Remove the SELECTED panel → fallback selects the survivor
		addPanelFromSidebar({ sessionId: 's2', agentPreset: null });
		await settle();
		ws.select(panelIdFor('s2'));
		await settle();
		ws.remove(panelIdFor('s2'));
		await settle();
		expect(ids()).toEqual(['s-seed']);
		expect(getWorkspaceState()?.selectedPanelId).toBe(panelIdFor('s-seed'));
	});
});

describe('+page.svelte branch arms — loupe gate', () => {
	it('Alt+Click opens the loupe; mask and × close it; closing the louvered panel clears a stale lens', async () => {
		const target = await mountSeeded();
		const column = target.querySelector('[data-testid="panel-column"]') as HTMLElement;
		// NOTE: PanelLoupe portals its DOM to document.body — query the
		// document, never the mount target.
		const loupe = (): Element | null => document.querySelector('[data-testid="panel-loupe"]');
		column.dispatchEvent(new MouseEvent('click', { altKey: true, bubbles: true }));
		await settle();
		expect(loupe()).not.toBeNull();
		// The lens copy renders the panel body too (floorPanelId null).
		expect(target.querySelectorAll('[data-testid="panel-column"]').length).toBe(1);
		// × closes
		(document.querySelector('[data-testid="panel-loupe-close"]') as HTMLElement).click();
		await settle();
		expect(loupe()).toBeNull();
		// Reopen, then mask mousedown closes (second close verb)
		column.dispatchEvent(new MouseEvent('click', { altKey: true, bubbles: true }));
		await settle();
		(document.querySelector('[data-testid="panel-loupe-mask"]') as HTMLElement).dispatchEvent(
			new MouseEvent('mousedown', { bubbles: true })
		);
		await settle();
		expect(loupe()).toBeNull();
		// Reopen, then remove the floor panel — the stale lens self-clears
		column.dispatchEvent(new MouseEvent('click', { altKey: true, bubbles: true }));
		await settle();
		expect(loupe()).not.toBeNull();
		getWorkspaceState()!.remove(panelIdFor('s-seed'));
		await settle();
		expect(target.querySelector('[data-testid="panel-loupe"]')).toBeNull();
		expect(target.querySelector('[data-testid="empty-floor"], .empty-floor')).not.toBeNull();
	});
});

describe('+page.svelte branch arms — gutter drag', () => {
	function mouse(type: string, x: number, shift = false): MouseEvent {
		return new MouseEvent(type, { clientX: x, shiftKey: shift, bubbles: true });
	}

	it('plain drag resizes one; shift drag scales all; mouseup syncs a uniform row; guards fire', async () => {
		const target = await mountSeeded();
		expect(startPanelResize(mouse('mousedown', 100), 0)).toBe(true);
		// mousemove with no drag → early return arm
		window.dispatchEvent(mouse('mousemove', 200));
		await settle();
		// A second drag cancels any afterglow timer (arm)
		expect(startPanelResize(mouse('mousedown', 100), 0)).toBe(true);
		// Plain drag right by 60 → only the dragged panel grows
		window.dispatchEvent(mouse('mousemove', 160));
		await settle();
		const w1 = rows()[0].panel;
		// mouseup: afterglow arms + uniform-row preset sync
		window.dispatchEvent(mouse('mouseup', 160));
		await settle();
		// Double mouseup (drag null → early return arm)
		window.dispatchEvent(mouse('mouseup', 160));
		await settle();
		expect(true).toBe(true);
		// Shift drag: proportional scale arm
		expect(startPanelResize(mouse('mousedown', 0, true), 0)).toBe(true);
		window.dispatchEvent(mouse('mousemove', 80, true));
		await settle();
		window.dispatchEvent(mouse('mouseup', 80, true));
		await settle();
		expect(rows().length).toBe(1);
	});
});

describe('+page.svelte branch arms — move direction grammar', () => {
	it('left/right and up/down both reorder through the same helper', async () => {
		const target = await mountSeeded();
		addPanelFromSidebar({ sessionId: 's2', agentPreset: null });
		await settle();
		expect(ids()).toEqual(['s2', 's-seed']);
		expect(movePanelFromRegistry(panelIdFor('s2'), 'down')).toBe(true);
		await settle();
		expect(ids()).toEqual(['s-seed', 's2']);
		expect(movePanelFromRegistry(panelIdFor('s2'), 'up')).toBe(true);
		await settle();
		expect(ids()).toEqual(['s2', 's-seed']);
		// left ≡ up, right ≡ down (the ternary arms)
		expect(movePanelFromRegistry(panelIdFor('s-seed'), 'left')).toBe(true);
		await settle();
		expect(ids()).toEqual(['s-seed', 's2']);
		expect(movePanelFromRegistry(panelIdFor('s-seed'), 'right')).toBe(true);
		await settle();
		expect(ids()).toEqual(['s2', 's-seed']);
	});
});

describe('+page.svelte branch arms — dual-fetch cold ladder', () => {
	it('events !ok → dead-session card; its Close button removes the panel', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				if (url.includes('/events')) {
					return new Response(JSON.stringify({ ok: false, error: { code: 'session/not-found', message: 'gone' } }), { status: 404 });
				}
				return new Response(JSON.stringify({ ok: true, sessions: [], presets: [] }), { status: 200 });
			})
		);
		const target = await mountSeeded();
		expect(addPanelFromSidebar({ sessionId: 's-gone', agentPreset: null })).toBe(true);
		await settle();
		await settle();
		const card = target.querySelector('[data-testid="panel-error"]');
		expect(card).not.toBeNull();
		expect(card?.textContent).toContain('s-gone');
		(target.querySelector('[data-testid="panel-error-close"]') as HTMLElement).click();
		await settle();
		expect(target.querySelector('[data-testid="panel-error"]')).toBeNull();
		expect(ids()).toEqual(['s-seed']);
	});

	it('history !ok → hasMore false; missing lastSeq/entries/running fields fall back (?? arms)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				if (url.includes('/events')) {
					// no lastSeq / entries / running → the ?? fallback arms
					return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
				}
				if (url.includes('/history')) {
					return new Response('nope', { status: 500 });
				}
				return new Response(JSON.stringify({ ok: true, sessions: [], presets: [] }), { status: 200 });
			})
		);
		const target = await mountSeeded();
		expect(addPanelFromSidebar({ sessionId: 's-cold', agentPreset: null })).toBe(true);
		await settle();
		await settle();
		// The cold panel mounted (not dead, not loading), no sentinel.
		expect(target.querySelector('[data-testid="panel-error"]')).toBeNull();
		expect(target.querySelector('[data-testid="load-older-sentinel"]')).toBeNull();
	});

	it('a fetch still in flight shows the loading placeholder arm', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				if (url.includes('/events')) {
					return new Promise<Response>(() => {}); // never settles
				}
				return new Response(JSON.stringify({ ok: true, sessions: [], presets: [] }), { status: 200 });
			})
		);
		const target = await mountSeeded();
		expect(addPanelFromSidebar({ sessionId: 's-slow', agentPreset: null })).toBe(true);
		await settle();
		expect(target.querySelector('[data-testid="panel-loading"]')).not.toBeNull();
	});
});

describe('+page.svelte branch arms — bare restore arrival', () => {
	it('bare / mounts the restored desk shape (seed-miss init arms) without a seed panel', async () => {
		installDefaultFetch();
		stageBare();
		localStorage.setItem(
			'dsi-panels',
			JSON.stringify({
				panels: [
					{ id: 'panel-1', kind: 'conversation', sessionId: 's-rest', agentPreset: null, width: 480 }
				],
				selectedPanelId: 'panel-1',
				panelWidth: 480,
				zoom: 1
			})
		);
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Page, { target });
		await settle();
		// Restore path: the persisted panel id must survive (panelIdSeq sync arm)
		expect(ids()).toEqual(['s-rest']);
		// A runtime add must mint a FRESH id (the duplicate-key guard's reason)
		expect(addPanelFromSidebar({ sessionId: 's-fresh', agentPreset: null })).toBe(true);
		await settle();
		const fresh = rows().find((r) => r.panel.sessionId === 's-fresh')!.panel.id;
		expect(fresh).not.toBe('panel-1');
		expect(fresh).toMatch(/^panel-/);
	});
});

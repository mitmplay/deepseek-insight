/**
 * PanelLoupe route-wiring unit tests (task 3.2-T, PAIRED with 3.2) —
 * the route-level pieces mounted through the real +page.svelte (the
 * conversation-page.test.ts recipe: $app/state reactive stub + staged
 * seed data + route-aware fetch double):
 *
 *  - Alt+Click a column opens the loupe on THAT panel and selects it
 *    (D6: activation rode the same gesture, earlier phase; the modifier
 *    moved from Shift — The Loupe for Every Panel, 2026-09-08);
 *  - Alt+Click another column while open REPOINTS the lens (one
 *    dialog, new session — never stacking, D5);
 *  - Escape clears the state, the dialog unmounts, the floor selection
 *    is unchanged (still the louvered panel);
 *  - closing the louvered panel from its column closes the lens (the
 *    removePanel edge) — and so does a /new swap that mints a fresh id
 *    for the louvered slot (the seed/reset edge, clearLoupeIfGone);
 *  - a dead session in the lens renders the SAME error card the column
 *    renders, and the cold branch renders the full-props transcript in
 *    the lens — the D7 ladder shared, one fetch path.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Static on purpose: the page must bind to the SAME svelte runtime as
// mount/flushSync (the conversation-page.test.ts note applies verbatim).
import Page from '../../src/routes/+page.svelte';
import { reactiveTestPage } from '../stubs/app-state-shared.svelte';
import { resetSpineFeedForTests } from '$lib/services/conversation/spine-feed.svelte';
import {
	addPanelFromSidebar,
	replacePanelFromRegistry,
	resetPanelRegistryForTests
} from '$lib/services/panels/panel-registry';

/** Route-aware fetch double (the conversation-page default, plus a
 *  dead-session arm: `dead` sessions 404 their /events tail, so
 *  ensureCold files the honest error card). */
function installDefaultFetch(dead: string[] = []): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			const deadHit = dead.find((sid) => url.includes(`/session/${encodeURIComponent(sid)}/`));
			if (deadHit !== undefined) {
				return new Response('not found', { status: 404 });
			}
			const body =
				url.includes('/api/dsh/sessions') ? { ok: true, sessions: [] }
				: url.includes('/api/a2a') ? { ok: true, rows: [] }
				: url.includes('/events') ? { ok: true, entries: [], lastSeq: -1, running: false }
				: url.includes('/models') ? { ok: true, current: null }
				: { ok: true, hasMore: false };
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		})
	);
}

async function settle(): Promise<void> {
	for (let i = 0; i < 8; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

/** Stage the seed (?sessionKey=s-a) with a primed cold transcript, then
 *  mount the real route. Returns the mount target. */
async function mountPageWithSeed(dead: string[] = []): Promise<{ target: HTMLElement; instance: ReturnType<typeof mount> }> {
	installDefaultFetch(dead);
	reactiveTestPage.params = {};
	reactiveTestPage.url = new URL('http://dsi/?sessionKey=s-a');
	reactiveTestPage.data = {
		sessionId: 's-a',
		title: 'Seed session',
		workspace: null,
		agentPreset: null,
		entries: [{ kind: 'user-message', id: 'u:1', seq: 1, time: 1001, text: 'seed transcript line' }],
		lastSeq: 1,
		running: false
	};
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(Page, { target });
	await settle();
	return { target, instance };
}

/** The pointer-then-click gesture (D6): activation first, loupe second. */
function altClickColumn(target: HTMLElement, sessionId: string): void {
	const column = target.querySelector(`[data-testid="panel-column"][data-session-id="${sessionId}"]`) as HTMLElement;
	column.dispatchEvent(new Event('pointerdown', { bubbles: true }));
	column.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
}

const loupe = (): HTMLElement | null =>
	document.querySelector('[data-testid="panel-loupe"]');
const columnOf = (target: HTMLElement, sessionId: string): HTMLElement =>
	target.querySelector(`[data-testid="panel-column"][data-session-id="${sessionId}"]`) as HTMLElement;

afterEach(() => {
	resetSpineFeedForTests(); // module-scope feed store - test isolation
	resetPanelRegistryForTests();
	resetSpineFeedForTests();
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('PanelLoupe route wiring (The Panel Loupe, Wave 3)', () => {
	it('Alt+Click opens the lens on that panel and selects it (D6)', async () => {
		const { target, instance } = await mountPageWithSeed();
		altClickColumn(target, 's-a');
		await settle();
		const dialog = loupe();
		expect(dialog).not.toBeNull();
		expect(dialog?.getAttribute('data-session-id')).toBe('s-a');
		expect(dialog?.parentElement).toBe(document.body); // D2: portaled
		expect(columnOf(target, 's-a').classList.contains('selected')).toBe(true);
		unmount(instance);
	});

	it('Alt+Click another column while open repoints the lens — exactly one dialog', async () => {
		const { target, instance } = await mountPageWithSeed();
		expect(addPanelFromSidebar({ sessionId: 's-b', agentPreset: null })).toBe(true);
		await settle();
		altClickColumn(target, 's-a');
		await settle();
		altClickColumn(target, 's-b');
		await settle();
		const dialogs = document.querySelectorAll('[data-testid="panel-loupe"]');
		expect(dialogs).toHaveLength(1);
		expect(dialogs[0].getAttribute('data-session-id')).toBe('s-b');
		unmount(instance);
	});

	it('Escape clears the lens; the column selection is unchanged', async () => {
		const { target, instance } = await mountPageWithSeed();
		altClickColumn(target, 's-a');
		await settle();
		expect(loupe()).not.toBeNull();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		await settle();
		expect(loupe()).toBeNull();
		// D6 left the operator looking at the column they were reading.
		expect(columnOf(target, 's-a').classList.contains('selected')).toBe(true);
		unmount(instance);
	});

	it('closing the louvered panel from its column closes the lens', async () => {
		const { target, instance } = await mountPageWithSeed();
		expect(addPanelFromSidebar({ sessionId: 's-b', agentPreset: null })).toBe(true);
		await settle();
		altClickColumn(target, 's-b');
		await settle();
		expect(loupe()).not.toBeNull();
		(columnOf(target, 's-b').querySelector('[data-testid="panel-close"]') as HTMLElement).click();
		await settle();
		expect(loupe()).toBeNull();
		expect(target.querySelector('[data-testid="panel-column"][data-session-id="s-b"]')).toBeNull();
		unmount(instance);
	});

	it('a /new swap on the louvered slot (fresh id) clears the lens', async () => {
		const { target, instance } = await mountPageWithSeed();
		altClickColumn(target, 's-a');
		await settle();
		expect(loupe()).not.toBeNull();
		const slotId = columnOf(target, 's-a').getAttribute('data-panel-id') as string;
		expect(replacePanelFromRegistry(slotId, { sessionId: 's-c', agentPreset: null })).toBe(true);
		await settle();
		expect(loupe()).toBeNull();
		unmount(instance);
	});

	it('a dead session in the lens renders the same error card the column renders', async () => {
		const { target, instance } = await mountPageWithSeed(['s-dead']);
		expect(addPanelFromSidebar({ sessionId: 's-dead', agentPreset: null })).toBe(true);
		await settle();
		// The column already carries the honest error card (shared ladder).
		expect(columnOf(target, 's-dead').querySelector('[data-testid="panel-error"]')).not.toBeNull();
		altClickColumn(target, 's-dead');
		await settle();
		const dialog = loupe();
		expect(dialog).not.toBeNull();
		expect(dialog?.querySelector('[data-testid="panel-error"]')).not.toBeNull();
		unmount(instance);
	});

	it('the cold branch renders the full-props transcript inside the lens (D7, one ladder)', async () => {
		const { target, instance } = await mountPageWithSeed();
		altClickColumn(target, 's-a');
		await settle();
		const dialog = loupe();
		expect(dialog).not.toBeNull();
		// The seeded cold entries render as the real transcript in the lens.
		expect(dialog?.querySelector('[data-testid="message-bubble"]')?.textContent).toContain(
			'seed transcript line'
		);
		// The lens is the OUTSIDE-floor mount (D3): its composer exists, but
		// the lens panel is not a registry slot — a floor-only fact.
		expect(dialog?.querySelector('[data-testid="prompt-textarea"]')).not.toBeNull();
		unmount(instance);
	});
});
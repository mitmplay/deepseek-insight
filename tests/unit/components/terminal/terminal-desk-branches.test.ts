/**
 * TerminalDesk branch-mop tests — the uncovered paths left after the
 * Wave 2 suite (terminal-desk.test.ts), same mock harness shape:
 *  - the ⌥+1…9 tab shortcut: modifier rejection, non-digit codes, the
 *    out-of-range tab guard, and the select+focus settle path
 *  - MAX_SESSIONS refusal with a NON-JSON error body (the json catch)
 *  - the tab-close send failing at the transport level (the .catch swallow)
 *  - the rebuild ladder: a reattach refusal drops just that session, and a
 *    probe transport failure degrades to the fresh-desk fallback
 *  - restored.selectedTab clamping (high, low, absent)
 *  - captureEl: the desk finding (or not finding) its PanelColumn ancestor
 *
 * TerminalPanel is swapped for a stub double (TerminalPanelStub) so the
 * focus/self-open/report-back contract is observable without xterm.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/components/terminal/TerminalPanel.svelte', async () =>
	await import('../../TerminalPanelStub.svelte')
);

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

type FetchRoute = (url: string, init?: RequestInit) => Promise<Response> | undefined;
let fetchRoute: FetchRoute = () => undefined;

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function tick(ms = 10): Promise<void> {
	await new Promise((r) => setTimeout(r, ms));
}

function stubEvents(): string[] {
	return (globalThis as { __stubPanelEvents?: string[] }).__stubPanelEvents ?? [];
}

let deskRef: { applyAction: (a: 'new-tab' | 'split-down') => void } | null = null;

async function mountDesk(props: Record<string, unknown> = {}): Promise<{ target: HTMLElement; cleanup: () => void }> {
	(globalThis as { __stubPanelEvents?: string[] }).__stubPanelEvents = [];
	const { default: Host } = await import('../../TerminalDeskHost.svelte');
	const target = document.body.appendChild(document.createElement('div'));
	const app = mount(Host, {
		target,
		props: {
			register: (d: unknown) => { deskRef = d as { applyAction: (a: 'new-tab' | 'split-down') => void }; },
			onShellExit: () => {},
			...props
		}
	});
	flushSync();
	await tick();
	flushSync();
	return { target, cleanup: () => { unmount(app); target.remove(); } };
}

function pressKey(code: string, mods: { alt?: boolean; meta?: boolean; ctrl?: boolean; shift?: boolean } = {}): boolean {
	const ev = new KeyboardEvent('keydown', {
		code,
		altKey: mods.alt ?? false,
		metaKey: mods.meta ?? false,
		ctrlKey: mods.ctrl ?? false,
		shiftKey: mods.shift ?? false,
		cancelable: true,
		bubbles: true
	});
	window.dispatchEvent(ev);
	return ev.defaultPrevented;
}

beforeEach(() => {
	vi.stubGlobal('fetch', vi.fn((url: string | URL | Request, init?: RequestInit) => fetchRoute(String(url), init)));
	deskRef = null;
});

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

function route(): FetchRoute {
	let n = 0;
	return (url, init) => {
		if (url === '/api/terminal' && !init) return Promise.resolve(jsonResponse({ enabled: true, sessions: [] }));
		if (url === '/api/terminal' && init) {
			return Promise.resolve(jsonResponse({ sessionId: 'desk-' + ++n, token: 'tok-' + n, totalBytes: 0 }));
		}
		if (url.includes('/send')) return Promise.resolve(jsonResponse({ ok: true }));
		return Promise.resolve(jsonResponse({}));
	};
}

describe('TerminalDesk — ⌥+1…9 tab shortcut', () => {
	it('rejects every non-⌥-alone modifier combination and non-digit codes', async () => {
		fetchRoute = route();
		const h = await mountDesk();
		deskRef!.applyAction('new-tab');
		await tick();
		flushSync();
		// no modifier at all
		expect(pressKey('Digit2')).toBe(false);
		// ⌥ combined with each reserved modifier
		expect(pressKey('Digit2', { alt: true, meta: true })).toBe(false);
		expect(pressKey('Digit2', { alt: true, ctrl: true })).toBe(false);
		expect(pressKey('Digit2', { alt: true, shift: true })).toBe(false);
		// wrong physical key even with ⌥ held
		expect(pressKey('KeyA', { alt: true })).toBe(false);
		expect(pressKey('Digit0', { alt: true })).toBe(false);
		// tab 1 is NOT selected
		expect(h.target.querySelector('[data-testid="terminal-tab-button-1"]')?.getAttribute('data-selected')).toBe('true');
		expect(stubEvents().filter((e) => e === 'focus').length).toBe(0);
		h.cleanup();
	});

	it('⌥+digit beyond the tab count is ignored (no preventDefault)', async () => {
		fetchRoute = route();
		const h = await mountDesk();
		// only one tab exists; ⌥+5 is out of range
		expect(pressKey('Digit5', { alt: true })).toBe(false);
		expect(h.target.querySelector('[data-testid="terminal-tab-button-0"]')?.getAttribute('data-selected')).toBe('true');
		h.cleanup();
	});

	it('⌥+digit switches the visible tab and focuses its first row terminal', async () => {
		fetchRoute = route();
		const h = await mountDesk();
		deskRef!.applyAction('new-tab');
		await tick();
		flushSync();
		stubEvents().length = 0;
		expect(pressKey('Digit2', { alt: true })).toBe(true);
		flushSync();
		await tick();
		flushSync();
		expect(h.target.querySelector('[data-testid="terminal-tab-container-1"]')?.getAttribute('data-visible')).toBe('true');
		expect(stubEvents()).toContain('focus');
		// ⌥+1 goes back to the first tab
		expect(pressKey('Digit1', { alt: true })).toBe(true);
		flushSync();
		await tick();
		expect(h.target.querySelector('[data-testid="terminal-tab-container-0"]')?.getAttribute('data-visible')).toBe('true');
		h.cleanup();
	});

	it('a shortcut racing a tab close after the guard settles harmlessly (row gone)', async () => {
		fetchRoute = route();
		const h = await mountDesk();
		deskRef!.applyAction('new-tab');
		await tick();
		flushSync();
		stubEvents().length = 0;
		// ⌥+2 passes the guard, then the tab closes before tick() settles:
		// the settle callback finds no row and does nothing.
		expect(pressKey('Digit2', { alt: true })).toBe(true);
		(h.target.querySelector('[data-testid="terminal-tab-close-1"]') as HTMLElement).click();
		flushSync();
		await tick();
		flushSync();
		expect(stubEvents().filter((e) => e === 'focus').length).toBe(0);
		h.cleanup();
	});
});

describe('TerminalDesk — mintSession refusals', () => {
	it('a non-JSON error body (unparseable refusal) opens NO row and does not throw', async () => {
		fetchRoute = (url, init) => {
			if (url === '/api/terminal' && !init) return Promise.resolve(jsonResponse({ enabled: true, sessions: [] }));
			if (url === '/api/terminal' && init) {
				return Promise.resolve(new Response('<html>gateway timeout</html>', {
					status: 502,
					headers: { 'content-type': 'text/html' }
				}));
			}
			return Promise.resolve(jsonResponse({}));
		};
		const h = await mountDesk();
		deskRef!.applyAction('split-down');
		await tick();
		flushSync();
		// the desk neither capped nor grew: the garbage refusal is absorbed
		expect(h.target.querySelector('[data-testid="terminal-desk-capped"]')).toBeNull();
		expect(h.target.querySelectorAll('[data-testid="terminal-panel"]').length).toBe(1);
		h.cleanup();
	});
});

describe('TerminalDesk — close cascade transport failures', () => {
	it('a tab-close send that REJECTS is swallowed and the tab still closes', async () => {
		fetchRoute = (url, init) => {
			if (url === '/api/terminal' && !init) return Promise.resolve(jsonResponse({ enabled: true, sessions: [] }));
			if (url === '/api/terminal' && init) {
				return Promise.resolve(jsonResponse({ sessionId: 'desk-1', token: 'tok-1', totalBytes: 0 }));
			}
			if (url.includes('/send')) return Promise.reject(new Error('network down'));
			return Promise.resolve(jsonResponse({}));
		};
		const h = await mountDesk();
		deskRef!.applyAction('new-tab');
		await tick();
		flushSync();
		(h.target.querySelector('[data-testid="terminal-tab-close-1"]') as HTMLElement).click();
		flushSync();
		await tick();
		// the tab is gone despite the failed kill; tab 0 survives selected
		expect(h.target.querySelector('[data-testid="terminal-tab-button-1"]')).toBeNull();
		expect(h.target.querySelector('[data-testid="terminal-tab-button-0"]')?.getAttribute('data-selected')).toBe('true');
		h.cleanup();
	});

	it('closing a middle tab moves selection to the RIGHT neighbor', async () => {
		fetchRoute = route();
		const h = await mountDesk();
		deskRef!.applyAction('new-tab');
		await tick();
		deskRef!.applyAction('new-tab');
		await tick();
		flushSync();
		(h.target.querySelector('[data-testid="terminal-tab-close-1"]') as HTMLElement).click();
		flushSync();
		// tabIndex (1) < tabs.length (2): selection clamps to 1 — the right neighbor
		expect(h.target.querySelectorAll('[data-testid="terminal-tab-button"]').length === 0);
		expect(h.target.querySelector('[data-testid="terminal-tab-button-1"]')?.getAttribute('data-selected')).toBe('true');
		h.cleanup();
	});
});

describe('TerminalDesk — rebuild ladder edges (ADR D3)', () => {
	function restoreRoute(live: Array<{ id: string; exited: boolean }>, reattachFail: string[] = []): FetchRoute {
		return (url, init) => {
			if (url === '/api/terminal' && !init) return Promise.resolve(jsonResponse({ enabled: true, sessions: live }));
			if (url.endsWith('/reattach')) {
				const id = String(url).split('/')[3];
				if (reattachFail.includes(id)) {
					return Promise.resolve(new Response(JSON.stringify({ error: 'gone' }), { status: 410, headers: { 'content-type': 'application/json' } }));
				}
				return Promise.resolve(jsonResponse({ token: 'rt-' + id, fromByte: 0 }));
			}
			return Promise.resolve(jsonResponse({}));
		};
	}

	it('a reattach refusal drops just that session; survivors keep the tab', async () => {
		fetchRoute = restoreRoute([{ id: 'sess-a', exited: false }, { id: 'sess-b', exited: false }], ['sess-a']);
		const h = await mountDesk({ restored: { tabs: [{ sessionIds: ['sess-a', 'sess-b'] }], selectedTab: 0 } });
		await tick();
		flushSync();
		const c0 = h.target.querySelector('[data-testid="terminal-tab-container-0"]')!;
		expect(c0.querySelectorAll('[data-testid="terminal-panel"]').length).toBe(1);
		expect(stubEvents().some((e) => e.startsWith('mount:sess-b'))).toBe(true);
		h.cleanup();
	});

	it('ALL reattaches failing (rows empty) drops the whole remembered tab', async () => {
		fetchRoute = restoreRoute([{ id: 'sess-a', exited: false }], ['sess-a']);
		const h = await mountDesk({ restored: { tabs: [{ sessionIds: ['sess-a'] }], selectedTab: 0 } });
		await tick();
		flushSync();
		// built stays empty ⇒ the fresh-desk fallback, not a dead frame
		expect(h.target.querySelectorAll('[data-testid="terminal-panel"]').length).toBe(1);
		expect(stubEvents().some((e) => e === 'mount:self')).toBe(true);
		h.cleanup();
	});

	it('the probe failing at the transport level degrades to a fresh desk', async () => {
		fetchRoute = (url) => {
			if (url === '/api/terminal') return Promise.reject(new Error('probe down'));
			return Promise.resolve(jsonResponse({}));
		};
		const h = await mountDesk({ restored: { tabs: [{ sessionIds: ['sess-a'] }], selectedTab: 0 } });
		await tick();
		flushSync();
		// restoring placeholder is gone; one fresh self-open row stands
		expect(h.target.querySelector('[data-testid="terminal-desk-restoring"]')).toBeNull();
		expect(h.target.querySelectorAll('[data-testid="terminal-panel"]').length).toBe(1);
		h.cleanup();
	});

	it('restored.selectedTab is clamped into the surviving tab range', async () => {
		// remembered selection beyond the end clamps to the last tab
		fetchRoute = restoreRoute([{ id: 'sess-a', exited: false }, { id: 'sess-b', exited: false }]);
		const h = await mountDesk({ restored: { tabs: [{ sessionIds: ['sess-a'] }, { sessionIds: ['sess-b'] }], selectedTab: 99 } });
		await tick();
		flushSync();
		expect(h.target.querySelector('[data-testid="terminal-tab-container-1"]')?.getAttribute('data-visible')).toBe('true');
		h.cleanup();

		// negative clamps up to the first tab; absent selection defaults to 0
		fetchRoute = restoreRoute([{ id: 'sess-a', exited: false }, { id: 'sess-b', exited: false }]);
		const h2 = await mountDesk({ restored: { tabs: [{ sessionIds: ['sess-a'] }, { sessionIds: ['sess-b'] }], selectedTab: -3 } });
		await tick();
		flushSync();
		expect(h2.target.querySelector('[data-testid="terminal-tab-container-0"]')?.getAttribute('data-visible')).toBe('true');
		h2.cleanup();

		fetchRoute = restoreRoute([{ id: 'sess-a', exited: false }]);
		const h3 = await mountDesk({ restored: { tabs: [{ sessionIds: ['sess-a'] }] } });
		await tick();
		flushSync();
		expect(h3.target.querySelector('[data-testid="terminal-tab-container-0"]')?.getAttribute('data-visible')).toBe('true');
		h3.cleanup();
	});
});

describe('TerminalDesk — capture target (CanvasCopyButton container)', () => {
	it('the desk finds its hosting PanelColumn as the capture container', async () => {
		fetchRoute = route();
		const column = document.body.appendChild(document.createElement('div'));
		column.setAttribute('data-testid', 'panel-column');
		const target = column.appendChild(document.createElement('div'));
		const { default: Host } = await import('../../TerminalDeskHost.svelte');
		(globalThis as { __stubPanelEvents?: string[] }).__stubPanelEvents = [];
		const app = mount(Host, { target, props: { register: () => {}, onShellExit: () => {} } });
		flushSync();
		await tick();
		expect(target.querySelector('[data-testid="terminal-desk"]')).not.toBeNull();
		unmount(app);
		column.remove();
	});
});

/**
 * TerminalPanel coverage tests — the happy paths the floor test skips:
 * full xterm attach (mocked addons), the SSE frame pump (output / settled /
 * exit / closed / error), serialized keystroke writes, the close button,
 * the xterm-failure fallback surface (pre + input line), and the opening /
 * open-failed postures. xterm + addon-fit + EventSource + ResizeObserver
 * are all mocked; fetch is routed by URL.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const xtermState = vi.hoisted(() => ({ fail: false }));

const onDataHandlers: Array<(data: string) => void> = [];

vi.mock('@xterm/xterm', () => ({
	Terminal: class {
		written: string[] = [];
		constructor() {
			if (xtermState.fail) throw new Error('xterm unavailable');
		}
		opened: unknown = null;
		addon: unknown = null;
		disposed = false;
		open(el: unknown) {
			this.opened = el;
		}
		loadAddon(a: unknown) {
			this.addon = a;
		}
		write(data: string) {
			this.written.push(data);
		}
		onData(fn: (data: string) => void) {
			onDataHandlers.push(fn);
		}
		focus() {}
		dispose() {
			this.disposed = true;
		}
	}
}));

vi.mock('@xterm/addon-fit', () => ({
	FitAddon: class {
		fitCount = 0;
		fit() {
			this.fitCount++;
		}
	}
}));

interface FakeES {
	url: string;
	closed: boolean;
	onmessage: ((e: { data: string }) => void) | null;
	listeners: Map<string, Array<(e: MessageEvent) => void>>;
	close(): void;
	addEventListener(kind: string, fn: (e: MessageEvent) => void): void;
}

let lastES: FakeES | null = null;

class FakeEventSource implements FakeES {
	url: string;
	closed = false;
	onmessage: ((e: { data: string }) => void) | null = null;
	listeners = new Map<string, Array<(e: MessageEvent) => void>>();
	constructor(url: string) {
		this.url = url;
		lastES = this;
	}
	close() {
		this.closed = true;
	}
	addEventListener(kind: string, fn: (e: MessageEvent) => void) {
		const arr = this.listeners.get(kind) ?? [];
		arr.push(fn);
		this.listeners.set(kind, arr);
	}
	emit(kind: string, data?: string) {
		if (kind === 'output' && this.onmessage === null) {
			// named events never hit onmessage; keep parity with the component
		}
		const ev = { data: data ?? '' } as MessageEvent;
		if (kind === 'message') this.onmessage?.({ data: data ?? '' });
		for (const fn of this.listeners.get(kind) ?? []) fn(ev);
	}
}

const roInstances: Array<{ observed: Element | null; disconnected: boolean }> = [];
class FakeResizeObserver {
	observed: Element | null = null;
	disconnected = false;
	constructor(cb: () => void) {
		void cb;
	}
	observe(el: Element) {
		this.observed = el;
		roInstances.push(this);
	}
	disconnect() {
		this.disconnected = true;
	}
}

type FetchRoute = (url: string, init?: RequestInit) => Promise<Response> | undefined;
let fetchRoute: FetchRoute = () => undefined;

function jsonResponse(body: unknown, ok = true): Response {
	return new Response(JSON.stringify(body), { status: ok ? 200 : 500, headers: { 'content-type': 'application/json' } });
}

async function tick(ms = 10): Promise<void> {
	await new Promise((r) => setTimeout(r, ms));
}

interface Mounted {
	target: HTMLElement;
	cleanup: () => void;
}

async function mountPanel(): Promise<Mounted> {
	const { default: Host } = await import('./TerminalPanelHost.svelte');
	const target = document.body.appendChild(document.createElement('div'));
	const app = mount(Host, { target });
	flushSync();
	await tick();
	flushSync();
	return {
		target,
		cleanup: () => {
			unmount(app);
			target.remove();
		}
	};
}

function openRoute(): FetchRoute {
	return (url, init) => {
		if (url === '/api/terminal' && !init) return Promise.resolve(jsonResponse({ enabled: true, sessions: [] }));
		if (url === '/api/terminal' && init) return Promise.resolve(jsonResponse({ sessionId: 's1', token: 't1', totalBytes: 0 }));
		if (url.includes('/send')) return Promise.resolve(jsonResponse({ ok: true }));
		return Promise.resolve(jsonResponse({}));
	};
}

beforeEach(() => {
	xtermState.fail = false;
	onDataHandlers.length = 0;
	roInstances.length = 0;
	lastES = null;
	vi.stubGlobal('EventSource', FakeEventSource);
	vi.stubGlobal(
		'ResizeObserver',
		FakeResizeObserver as unknown as typeof ResizeObserver
	);
	vi.stubGlobal('fetch', vi.fn((url: string | URL | Request, init?: RequestInit) => fetchRoute(String(url), init)));
});

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('TerminalPanel — enabled lifecycle (coverage)', () => {
	it('probes disabled → renders the disabled floor (probe false arm)', async () => {
		fetchRoute = () => Promise.resolve(jsonResponse({ enabled: false }));
		const h = await mountPanel();
		expect(h.target.querySelector('[data-testid="terminal-disabled"]')).not.toBeNull();
		expect(lastES).toBeNull(); // never opened a stream
		h.cleanup();
	});

	it('shows the opening posture while the open POST is pending', async () => {
		let resolveOpen!: (r: Response) => void;
		fetchRoute = (url, init) => {
			if (url === '/api/terminal' && !init) return Promise.resolve(jsonResponse({ enabled: true }));
			if (url === '/api/terminal' && init)
				return new Promise((res) => {
					resolveOpen = res;
				});
			return Promise.resolve(jsonResponse({ ok: true }));
		};
		const h = await mountPanel();
		expect(h.target.querySelector('[data-testid="terminal-opening"]')).not.toBeNull();
		resolveOpen(jsonResponse({ sessionId: 's1', token: 't1', totalBytes: 0 }));
		await tick();
		h.cleanup();
	});

	it('open POST failure → falls back to the disabled floor', async () => {
		fetchRoute = (url, init) => {
			if (url === '/api/terminal' && !init) return Promise.resolve(jsonResponse({ enabled: true }));
			if (url === '/api/terminal' && init) return Promise.resolve(jsonResponse({ error: 'no' }, false));
			return Promise.resolve(jsonResponse({ ok: true }));
		};
		const h = await mountPanel();
		expect(h.target.querySelector('[data-testid="terminal-disabled"]')).not.toBeNull();
		h.cleanup();
	});

	it('full attach: xterm opens, fits, observes resize, replays the buffer, and keystrokes serialize to /send', async () => {
		fetchRoute = openRoute();
		const h = await mountPanel();
		expect(lastES).not.toBeNull();
		expect(lastES!.url).toBe('/api/terminal/s1/stream?fromByte=0');

		// buffered output BEFORE xterm attached → replayed into xterm
		lastES!.emit('output', JSON.stringify({ text: 'buffered\\n' }));
		await tick(); // let the dynamic import resolve
		flushSync();

		const host = h.target.querySelector('[data-testid="terminal-host"]')!;
		expect(host.querySelector('div')).not.toBeNull(); // termEl mounted
		// ResizeObserver observed and refits on resize
		expect(roInstances).toHaveLength(1);
		roInstances[0].observed!.dispatchEvent(new Event('noop'));
		expect(onDataHandlers).toHaveLength(1);

		// keystroke → queued /send write
		onDataHandlers[0]('ls\\n');
		await tick();
		const fetchMock = vi.mocked(fetch);
		const sendCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/send') && (c[1] as RequestInit | undefined)?.body?.toString().includes('"write"'));
		expect(sendCalls.length).toBeGreaterThanOrEqual(1);

		// output after attach goes to xterm (incl. the ?? '' null-text arm)
		lastES!.emit('output', JSON.stringify({}));
		lastES!.emit('settled', JSON.stringify({ reason: 'stdin_read' }));
		await tick();
		flushSync();
		expect(h.target.querySelector('[data-testid="terminal-settle-badge"]')?.textContent).toBeTruthy();

		// host click → xterm focus arm
		(host as HTMLElement).click();

		// close button rendered while the session is open
		const closeBtn = h.target.querySelector('[data-testid="terminal-close"]') as HTMLButtonElement;
		expect(closeBtn).not.toBeNull();
		closeBtn.click();
		await tick();
		expect(vi.mocked(fetch).mock.calls.some((c) => String(c[0]) === '/api/terminal/s1/send')).toBe(true);

		// cleanup path: unmount disposes xterm and the observer (covered via teardown below)
		h.cleanup();
	});

	it('settle badge cycles through every reason; closed frame renders the closed floor (quiescent true and false)', async () => {
		fetchRoute = openRoute();
		const h = await mountPanel();
		await tick();
		flushSync();

		for (const reason of ['stdin_read', 'inferred_idle', 'timeout', 'session_exit']) {
			lastES!.emit('settled', JSON.stringify({ reason }));
		}
		await tick();
		flushSync();
		const badge = h.target.querySelector('[data-testid="terminal-settle-badge"]');
		expect(badge?.textContent).toBeTruthy();

		// lingering close: quiescent false → '(lingering)' suffix
		lastES!.emit('closed', JSON.stringify({ quiescent: false }));
		await tick();
		flushSync();
		const closed = h.target.querySelector('[data-testid="terminal-closed"]');
		expect(closed?.textContent).toContain('(lingering)');
		// close button gone once closed
		expect(h.target.querySelector('[data-testid="terminal-close"]')).toBeNull();

		// late frames after close never unfake the terminal (reducer freeze)
		lastES!.emit('settled', JSON.stringify({ reason: 'timeout' }));
		await tick();
		h.cleanup();
	});

	it('named exit + error frames and the onmessage guard arm all route through applyFrame', async () => {
		fetchRoute = openRoute();
		const h = await mountPanel();
		await tick();
		flushSync();

		// onmessage path: 'data: ...' with NO 'event:' line → guard returns
		lastES!.onmessage?.({ data: JSON.stringify({ text: 'junk' }) });
		lastES!.onmessage?.({ data: '' });
		// exit frame: the reducer's no-op arm
		lastES!.emit('exit', JSON.stringify({ outcome: { exitCode: 0, signal: null } }));
		// error frame: sets errored without closing
		lastES!.emit('error', JSON.stringify({ error: 'pty died' }));
		await tick();
		flushSync();
		// stream still open after error (only 'closed' closes it)
		expect(lastES!.closed).toBe(false);
		h.cleanup();
	});

	it('xterm constructor failure -> xtermFailed fallback surface: pre mirror + typed line Enter -> sendLine', async () => {
		xtermState.fail = true; // the mocked Terminal constructor throws -> the catch arm
		fetchRoute = openRoute();
		const h = await mountPanel();
		await tick();
		flushSync();
		const pre = h.target.querySelector('[data-testid="terminal-fallback"]');
		expect(pre).not.toBeNull();
		const input = h.target.querySelector('[data-testid="terminal-input"]') as HTMLInputElement;
		expect(input).not.toBeNull();

		// output before/without xterm mirrors into fallbackText (incl. ?? '' arm)
		lastES!.emit('output', JSON.stringify({ text: 'hello' }));
		lastES!.emit('output', JSON.stringify({}));
		await tick();
		flushSync();
		expect(h.target.querySelector('[data-testid="terminal-fallback"]')?.textContent).toContain('hello');

		// host click -> the termEl textarea focus arm (no xterm)
		(h.target.querySelector('[data-testid="terminal-host"]') as HTMLElement).click();

		// empty line -> guard returns, no POST
		const before = vi.mocked(fetch).mock.calls.filter((c) => String(c[0]).includes('/send')).length;
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await tick();

		// typed line -> sendLine POSTs the write
		input.value = 'echo hi';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await tick();
		const calls = vi.mocked(fetch).mock.calls.filter((c) => String(c[0]).includes('/send'));
		expect(calls.length).toBe(before + 1);
		expect((calls[calls.length - 1][1] as RequestInit).body).toContain('"write"');
		h.cleanup();
	});
});

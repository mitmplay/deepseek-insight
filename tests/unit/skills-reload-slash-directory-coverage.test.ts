/**
 * Coverage round (floor-82 task): direct unit coverage for two files at the
 * 80% per-file floor —
 *
 *  - SettingsSkillsReloadButton.svelte — presentational cancel verb:
 *    title/aria-label from the paraglide message, click → oncancelreload.
 *  - slash-directory.svelte.ts — the session-keyed catalog cache: idle →
 *    loading → ready, single-flight sharing, failed-fetch un-caching,
 *    invalidate / invalidateAll no-ops and listener fan-out with unsubscribe.
 *
 * Fetch is stubbed at the route seam (slash-panel-wiring pattern); the
 * module cache is session-keyed module state, so afterEach invalidates all.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsSkillsReloadButton from '../../src/lib/components/settings-skills/SettingsSkillsReloadButton.svelte';
import {
	directoryFor,
	invalidate,
	invalidateAll,
	onCatalogInvalidated
} from '../../src/lib/services/chat/slash-directory.svelte';

function jsonRes(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

interface Gate {
	promise: Promise<Response>;
	resolve: (v: Response) => void;
}

function deferredGate(): Gate {
	let resolve!: (v: Response) => void;
	const promise = new Promise<Response>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

/** Flush the microtask chain enough for a settled fetch to land in $state. */
async function settle(): Promise<void> {
	for (let i = 0; i < 6; i++) {
		await Promise.resolve();
	}
	// Response.json() settles on a macrotask in happy-dom.
	await new Promise((resolve) => setTimeout(resolve, 0));
	flushSync();
}

const OK_CATALOG = {
	ok: true,
	commands: [{ name: 'compact', description: 'Compact the session context' }],
	skills: [{ name: 'dsh-doc', description: 'Answer from the DSH docs', modelInvocable: true }]
};

type FetchPlan = (url: string) => Promise<Response> | Response;

function stubFetch(plan: FetchPlan): Array<{ url: string }> {
	const calls: Array<{ url: string }> = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
			calls.push({ url });
			return await plan(url);
		})
	);
	return calls;
}
// ── SettingsSkillsReloadButton ──────────────────────────────────────────

describe('SettingsSkillsReloadButton', () => {
	function mountButton(oncancelreload: () => void) {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(SettingsSkillsReloadButton, { target, props: { oncancelreload } });
		return {
			instance,
			target,
			button: () =>
				target.querySelector('button[data-testid="shelf-reload-cancel"]') as HTMLButtonElement
		};
	}

	it('renders type=button with title and aria-label from the cancel message', () => {
		const { instance, target, button } = mountButton(vi.fn());
		const b = button();
		expect(b).toBeTruthy();
		expect(b.getAttribute('type')).toBe('button');
		expect(b.getAttribute('title')).toBeTruthy();
		expect(b.getAttribute('aria-label')).toBe(b.getAttribute('title'));
		// the decorative icon is hidden from the a11y tree
		const icon = b.querySelector('svg');
		expect(icon?.getAttribute('aria-hidden')).toBe('true');
		unmount(instance);
		target.remove();
	});

	it('invokes oncancelreload exactly once per click', () => {
		const oncancelreload = vi.fn();
		const { instance, target, button } = mountButton(oncancelreload);
		button().click();
		flushSync();
		button().click();
		flushSync();
		expect(oncancelreload).toHaveBeenCalledTimes(2);
		unmount(instance);
		target.remove();
	});
});

// ── slash-directory ─────────────────────────────────────────────────────

describe('slash-directory', () => {
	beforeEach(() => {
		invalidateAll();
	});

	afterEach(() => {
		invalidateAll();
		vi.unstubAllGlobals();
	});

	it('a cold read starts loading and lands ready with wire-order rows', async () => {
		const calls = stubFetch(() => jsonRes(OK_CATALOG));
		const view = directoryFor('sess-ready');
		// the fetch starts synchronously inside the read
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe('/api/dsh/session/sess-ready/catalog');
		expect(view.state).toBe('loading');
		expect(view.commands).toEqual([]);
		expect(view.skills).toEqual([]);
		await settle();
		expect(view.state).toBe('ready');
		// host order kept verbatim — no client-side resort
		expect(view.commands).toEqual(OK_CATALOG.commands);
		expect(view.skills).toEqual(OK_CATALOG.skills);
	});

	it('a warm read never refetches and returns the same stable view', async () => {
		const calls = stubFetch(() => jsonRes(OK_CATALOG));
		const first = directoryFor('sess-warm');
		await settle();
		const second = directoryFor('sess-warm');
		expect(second).toBe(first);
		expect(calls).toHaveLength(1);
	});

	it('concurrent cold reads share ONE fetch (single-flight)', async () => {
		const gate = deferredGate();
		const calls = stubFetch(() => gate.promise);
		const a = directoryFor('sess-flight');
		const b = directoryFor('sess-flight');
		expect(a).toBe(b);
		expect(calls).toHaveLength(1);
		gate.resolve(jsonRes(OK_CATALOG));
		await settle();
		expect(a.state).toBe('ready');
		expect(a.commands).toHaveLength(1);
	});

	it('a non-ok body fails the view once, un-caches, and the next read retries', async () => {
		let n = 0;
		const calls = stubFetch(() => {
			n++;
			return jsonRes({ ok: false, error: { message: 'catalog exploded' } }, 500);
		});
		const view = directoryFor('sess-bad');
		await settle();
		expect(view.state).toBe('failed');
		expect(view.commands).toEqual([]);
		expect(view.skills).toEqual([]);
		// un-cached: the next read starts a fresh fetch
		const again = directoryFor('sess-bad');
		expect(n).toBe(2);
		expect(again).not.toBe(view);
		expect(again.state).toBe('loading');
		expect(calls).toHaveLength(2);
		await settle();
		expect(again.state).toBe('failed');
	});

	it('an HTTP error with an unparseable body degrades to the generic failure path', async () => {
		const calls = stubFetch(() => new Response('not json at all', { status: 503 }));
		const view = directoryFor('sess garbage');
		expect(calls[0].url).toContain('sess%20garbage');
		await settle();
		expect(view.state).toBe('failed');
		expect(view.commands).toEqual([]);
	});

	it('a rejected fetch (network throw) marks the view failed, not ready', async () => {
		stubFetch(() => {
			throw new Error('socket reset');
		});
		const view = directoryFor('sess-netfail');
		await settle();
		expect(view.state).toBe('failed');
		expect(view.skills).toEqual([]);
	});

	it('a body with non-array commands is rejected as a failed catalog', async () => {
		stubFetch(() => jsonRes({ ok: true, commands: 'nope', skills: [] }));
		const view = directoryFor('sess-shape');
		await settle();
		expect(view.state).toBe('failed');
	});

	it('invalidate drops one session, fires its listener; absent keys still notify', async () => {
		stubFetch(() => jsonRes(OK_CATALOG));
		const seen: Array<string | 'all'> = [];
		const off = onCatalogInvalidated((scope) => seen.push(scope));
		directoryFor('sess-a');
		directoryFor('sess-b');
		await settle();
		invalidate('sess-a');
		expect(seen).toEqual(['sess-a']);
		// sess-b keeps its cache; sess-a refetches on the next read
		const b = directoryFor('sess-b');
		expect(b.state).toBe('ready');
		invalidate('never-cached-session');
		expect(seen).toEqual(['sess-a', 'never-cached-session']);
		off();
		invalidateAll();
		expect(seen).toEqual(['sess-a', 'never-cached-session']);
	});

	it('invalidateAll clears every session and fans out the all-scope once per listener', async () => {
		const calls = stubFetch(() => jsonRes(OK_CATALOG));
		directoryFor('sess-x');
		directoryFor('sess-y');
		await settle();
		const seen: Array<string | 'all'> = [];
		onCatalogInvalidated((scope) => seen.push(scope));
		invalidateAll();
		expect(seen).toEqual(['all']);
		// both sessions were dropped: next reads refetch
		directoryFor('sess-x');
		directoryFor('sess-y');
		expect(calls.filter((c) => c.url.includes('sess-x')).length).toBe(2);
		expect(calls.filter((c) => c.url.includes('sess-y')).length).toBe(2);
	});

	it('onCatalogInvalidated unsubscribe removes exactly its own listener', () => {
		const seen: string[] = [];
		const offA = onCatalogInvalidated(() => seen.push('a'));
		const offB = onCatalogInvalidated(() => seen.push('b'));
		offA();
		invalidate('sess-any');
		expect(seen).toEqual(['b']);
		offB();
	});
});

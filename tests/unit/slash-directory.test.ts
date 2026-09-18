/**
 * slash-directory (Slash Menu W1, task 1.3-T): the composer's `/` menu
 * catalog cache — fetch discipline (first read per session, single-flight),
 * lifecycle states, honest failure (un-cache + retry), and the three
 * invalidation calls. The cache contract the menu (2.1) and the ladder
 * rung (1.4) build on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	directoryFor,
	invalidate,
	invalidateAll,
	onCatalogInvalidated,
	type SlashDirectory
} from '$lib/services/chat/slash-directory.svelte';

/** Stubbed fetch — capture calls, script per-test answers. */
let fetchCalls: { url: string; init?: RequestInit }[] = [];
let script: ((url: string) => { status: number; body: unknown }) | undefined;

function okCatalog(commands: unknown[] = [], skills: unknown[] = []) {
	return { ok: true, commands, skills };
}

beforeEach(() => {
	fetchCalls = [];
	script = undefined;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			fetchCalls.push({ url, init });
			const answer = script?.(String(url)) ?? { status: 200, body: okCatalog() };
			return new Response(JSON.stringify(answer.body), {
				status: answer.status,
				headers: { 'content-type': 'application/json' }
			});
		})
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

/** Drive pending microtask chains to settle (fetch stub + res.json()). */
async function flush(): Promise<void> {
	for (let i = 0; i < 8; i++) {
		await Promise.resolve();
	}
}

describe('slash-directory — fetch discipline', () => {
	it('first read per session fetches exactly once (single-flight)', async () => {
		script = () => ({ status: 200, body: okCatalog([{ name: 'compact', description: 'd' }]) });
		const dir = directoryFor('s1');
		expect(dir.state).toBe('loading');
		// A concurrent read before settle shares the SAME flight.
		const second = directoryFor('s1');
		await flush();
		expect(fetchCalls.length).toBe(1);
		expect(fetchCalls[0]?.url).toBe('/api/dsh/session/s1/catalog');
		expect(directoryFor('s1').state).toBe('ready');
		expect(directoryFor('s1').commands).toEqual([{ name: 'compact', description: 'd' }]);
		expect(second.state).toBe('ready');
	});

	it('no refetch without invalidation — repeat reads serve the cache', async () => {
		await flush(); // s1 warmed? no — fresh module state per test file run is NOT guaranteed; use unique ids
		script = () => ({ status: 200, body: okCatalog() });
		directoryFor('s9');
		await flush();
		expect(fetchCalls.length).toBe(1);
		directoryFor('s9');
		directoryFor('s9');
		await flush();
		expect(fetchCalls.length).toBe(1);
	});

	it('states transition idle → loading → ready with wire-order rows', async () => {
		const commands = [
			{ name: 'compact', description: 'a' },
			{ name: 'plan', description: 'b', input: { hint: '[off]', images: true } }
		];
		const skills = [{ name: 'dsh-doc', description: 'docs', modelInvocable: true }];
		script = () => ({ status: 200, body: okCatalog(commands, skills) });
		const dir = directoryFor('s2');
		expect(dir.state).toBe('loading'); // idle observed internally; the FIRST observable read is loading
		await flush();
		const after = directoryFor('s2');
		expect(after.state).toBe('ready');
		expect(after.commands).toEqual(commands);
		expect(after.skills).toEqual(skills);
	});

	it('different sessions fetch separately — one cache entry per session', async () => {
		await flush();
		script = () => ({ status: 200, body: okCatalog() });
		directoryFor('sa');
		directoryFor('sb');
		await flush();
		expect(fetchCalls.length).toBe(2);
		const urls = fetchCalls.map((c) => c.url).sort();
		expect(urls).toEqual(['/api/dsh/session/sa/catalog', '/api/dsh/session/sb/catalog']);
	});
});

describe('slash-directory — honest failure', () => {
	it('a failed fetch un-caches: state failed, next read retries', async () => {
		let fail = true;
		script = () =>
			fail
				? { status: 502, body: { ok: false, error: { code: 'session/not-found', message: 'nope' } } }
				: { status: 200, body: okCatalog([{ name: 'compact', description: 'd' }]) };
		const dir = directoryFor('sf');
		await flush();
		expect(dir.state).toBe('failed');
		expect(dir.commands).toEqual([]);
		// The failure un-cached — the next read starts a NEW flight.
		fail = false;
		const retry = directoryFor('sf');
		expect(retry.state).toBe('loading');
		await flush();
		expect(directoryFor('sf').state).toBe('ready');
		expect(fetchCalls.length).toBe(2);
	});
});

describe('slash-directory — invalidation', () => {
	it('invalidate(sessionId) drops that entry — next read refetches', async () => {
		script = () => ({ status: 200, body: okCatalog() });
		directoryFor('si');
		await flush();
		expect(fetchCalls.length).toBe(1);
		invalidate('si');
		directoryFor('si');
		await flush();
		expect(fetchCalls.length).toBe(2);
	});

	it('invalidateAll() drops every entry', async () => {
		script = () => ({ status: 200, body: okCatalog() });
		directoryFor('sw1');
		directoryFor('sw2');
		await flush();
		expect(fetchCalls.length).toBe(2);
		invalidateAll();
		directoryFor('sw1');
		directoryFor('sw2');
		await flush();
		expect(fetchCalls.length).toBe(4);
	});

	it('invalidate on an absent key is a no-op (cache contract — no throw, no fetch)', async () => {
		expect(() => invalidate('never-cached')).not.toThrow();
		expect(fetchCalls.length).toBe(0);
	});

	it('invalidations fire the registry listeners with their scope', () => {
		const seen: (string | 'all')[] = [];
		const off = onCatalogInvalidated((scope) => seen.push(scope));
		invalidate('sx');
		invalidateAll();
		off();
		invalidate('sy'); // unsubscribed — not seen
		expect(seen).toEqual(['sx', 'all']);
	});
});

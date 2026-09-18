/**
 * current-model unit tests — the per-session promise cache over
 * GET /api/dsh/session/{id}/models. Fetch is stubbed (browser API,
 * BC-1/BC-2): one call per session, cached across mounts, failures
 * and junk bodies resolve undefined (the footer's no-limit fallback).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCurrentModel } from '$lib/services/conversation/current-model';

const fetchMock = vi.fn<typeof fetch>();

afterEach(() => {
	fetchMock.mockReset();
});

function stubFetch(impl: () => Promise<Response>): void {
	vi.stubGlobal('fetch', fetchMock.mockImplementation(impl));
}

describe('getCurrentModel (per-session cache)', () => {
	it('resolves current.model from the models directory', async () => {
		let calls = 0;
		stubFetch(async () => {
			calls += 1;
			return new Response(JSON.stringify({ current: { model: 'glm-4.7' } }), { status: 200 });
		});
		await expect(getCurrentModel(`s-${calls}`)).resolves.toBe('glm-4.7');
		vi.unstubAllGlobals();
	});

	it('caches per session: a second mount makes NO second call, failures stay cached', async () => {
		let calls = 0;
		stubFetch(async () => {
			calls += 1;
			return new Response(JSON.stringify({ current: { model: 'm' } }), { status: 200 });
		});
		const a = getCurrentModel('cache-1');
		const b = getCurrentModel('cache-1'); // same promise
		await Promise.all([a, b]);
		expect(calls).toBe(1);

		// A DIFFERENT session fetches its own.
		await getCurrentModel('cache-2');
		expect(calls).toBe(2);
		vi.unstubAllGlobals();
	});

	it('non-OK response resolves undefined (never throws)', async () => {
		stubFetch(async () => new Response('nope', { status: 404 }));
		await expect(getCurrentModel('gone-1')).resolves.toBeUndefined();
		vi.unstubAllGlobals();
	});

	it('junk JSON body resolves undefined via the null-safe read', async () => {
		stubFetch(async () => new Response('<html>not json</html>', { status: 200 }));
		await expect(getCurrentModel('junk-1')).resolves.toBeUndefined();
		vi.unstubAllGlobals();
	});

	it('empty directory (current null) resolves undefined', async () => {
		stubFetch(async () => new Response(JSON.stringify({ current: null }), { status: 200 }));
		await expect(getCurrentModel('empty-1')).resolves.toBeUndefined();
		vi.unstubAllGlobals();
	});

	it('network failure resolves undefined (fetch rejects)', async () => {
		stubFetch(async () => {
			throw new TypeError('Failed to fetch');
		});
		await expect(getCurrentModel('dead-1')).resolves.toBeUndefined();
		vi.unstubAllGlobals();
	});
});

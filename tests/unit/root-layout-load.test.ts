/**
 * Root layout load (+layout.ts) — the operator-config preload:
 * the client arm awaits the ONE /api/config fetch before render; the
 * SSR arm skips (a relative fetch has no origin server-side). Both
 * arms via vi.doMock of the browser flag + a fresh module import.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const configPayload = {
	ok: true,
	chat: {},
	conversation: {},
	home: {},
	a2a: {},
	panel: {},
	sidebar: {}
};

function stubConfigFetch(): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn(async () =>
		new Response(JSON.stringify(configPayload), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		})
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

afterEach(() => {
	vi.resetModules();
	vi.doUnmock('$app/environment');
	vi.unstubAllGlobals();
});

describe('+layout load — operator config before first render', () => {
	it('the client arm awaits the /api/config fetch', async () => {
		const fetchMock = stubConfigFetch();
		vi.doMock('$app/environment', () => ({ browser: true, dev: false, building: false, version: 'test' }));
		const { load } = await import('../../src/routes/+layout');
		const result = await load({} as never);
		expect(fetchMock).toHaveBeenCalledWith('/api/config');
		expect(result).toEqual({});
	});

	it('the SSR arm skips the fetch entirely', async () => {
		const fetchMock = stubConfigFetch();
		vi.doMock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));
		const { load } = await import('../../src/routes/+layout');
		const result = await load({} as never);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(result).toEqual({});
	});
});

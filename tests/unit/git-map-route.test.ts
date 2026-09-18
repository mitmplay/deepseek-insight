/**
 * git-map route tests (Always Tabs task 1.1-T, ADR D2): the route is
 * DESK-INDEPENDENT — it answers real flags on every access mode WITHOUT
 * any gate call, bad params reject 400, and filesystem failures keep the
 * honest error face (404 vanished, 403 forbidden).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { detectSpy } = vi.hoisted(() => ({
	detectSpy: vi.fn()
}));

vi.mock('$lib/server/git-probe', () => ({
	detectRepos: detectSpy
}));

import { GET } from '../../src/routes/api/workspace/git-map/+server';

function get(query: string): Promise<Response> {
	return GET({ url: new URL('http://localhost/api/workspace/git-map' + query) } as never) as Promise<Response>;
}

const MAP = { rootIsRepo: true, repos: { app: true, docs: false } };

beforeEach(() => {
	detectSpy.mockReset();
});

describe('GET /api/workspace/git-map', () => {
	it('rejects missing sessionId or dir with 400 before anything runs', async () => {
		expect((await get('')).status).toBe(400);
		expect((await get('?sessionId=s1')).status).toBe(400);
		expect((await get('?dir=/ws')).status).toBe(400);
	});

	it('answers real flags on EVERY desk with NO gate call (Always Tabs D2)', async () => {
		detectSpy.mockResolvedValueOnce(MAP);
		const res = await get('?sessionId=s1&dir=' + encodeURIComponent('/ws'));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, enabled: true, ...MAP });
		expect(detectSpy).toHaveBeenCalledWith('/ws');
	});

	it('a vanished directory is a 404 with the probe-failed code', async () => {
		detectSpy.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'ENOENT' }));
		const res = await get('?sessionId=s1&dir=/gone');
		expect(res.status).toBe(404);
		expect((await res.json()).error.code).toBe('probe-failed');
	});

	it('a forbidden directory is a 403', async () => {
		detectSpy.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));
		expect((await get('?sessionId=s1&dir=/private')).status).toBe(403);
	});

	it('an unexpected probe failure keeps the shared error face (Always Tabs task 3.1)', async () => {
		detectSpy.mockRejectedValueOnce(new Error('host unreachable'));
		const res = await get('?sessionId=s1&dir=/ws');
		expect(res.status).toBe(503);
	});
});

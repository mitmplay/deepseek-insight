/**
 * git-status route tests (Always Tabs task 1.2-T, ADR D2): GET
 * /api/workspace/git-status — DESK-INDEPENDENT (no gate call), realpath
 * containment of the repo inside the workspace root (403 outside-workspace),
 * the bounded status answer, and the VISIBLE git-unavailable failure.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { statusSpy, insideSpy, FakeGitUnavailable } = vi.hoisted(() => ({
	statusSpy: vi.fn(),
	insideSpy: vi.fn(),
	FakeGitUnavailable: class GitUnavailableError extends Error {}
}));

vi.mock('$lib/server/git-probe', () => ({
	GitUnavailableError: FakeGitUnavailable,
	gitStatus: statusSpy,
	isInsideRoot: insideSpy
}));

import { GET } from '../../src/routes/api/workspace/git-status/+server';

function get(query: string): Promise<Response> {
	return GET({ url: new URL('http://localhost/api/workspace/git-status' + query) } as never) as Promise<Response>;
}

const PARAMS = '?sessionId=s1&root=' + encodeURIComponent('/ws') + '&repo=' + encodeURIComponent('/ws/app');

beforeEach(() => {
	statusSpy.mockReset();
	insideSpy.mockReset();
});

describe('GET /api/workspace/git-status', () => {
	it('rejects missing params with 400 before anything runs', async () => {
		expect((await get('')).status).toBe(400);
		expect((await get('?sessionId=s1&root=/ws')).status).toBe(400);
	});

	it('refuses a repo outside the workspace root with 403 outside-workspace', async () => {
		insideSpy.mockResolvedValueOnce(false);
		const res = await get(PARAMS);
		expect(res.status).toBe(403);
		expect((await res.json()).error.code).toBe('outside-workspace');
		expect(statusSpy).not.toHaveBeenCalled();
	});

	it('returns the bounded file list for a contained repo', async () => {
		insideSpy.mockResolvedValueOnce(true);
		statusSpy.mockResolvedValueOnce({
			truncated: true,
			files: [{ code: 'M ', path: 'a.txt' }]
		});
		const res = await get(PARAMS);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			ok: true,
			enabled: true,
			truncated: true,
			files: [{ code: 'M ', path: 'a.txt' }]
		});
	});

	it('a missing git binary is a VISIBLE ok:false git-unavailable failure', async () => {
		insideSpy.mockResolvedValueOnce(true);
		statusSpy.mockRejectedValueOnce(new FakeGitUnavailable('the git binary is not available'));
		const res = await get(PARAMS);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ ok: false, code: 'git-unavailable' });
	});

	it('a status failure keeps the shared error face (Always Tabs task 3.1)', async () => {
		insideSpy.mockResolvedValueOnce(true);
		statusSpy.mockRejectedValueOnce(new Error('git died'));
		const res = await get(PARAMS);
		expect(res.status).toBe(503);
	});
});

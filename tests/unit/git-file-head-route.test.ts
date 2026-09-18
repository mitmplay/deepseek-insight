/**
 * git-file-head route tests (Always Tabs task 1.3-T, ADR D2): per-case
 * route behavior with git-probe mocked — bad params, DESK-INDEPENDENT
 * (no gate call), no enclosing repo, containment refusal, the head
 * answer, and the visible git-unavailable failure.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { headSpy, insideSpy, resolveSpy, FakeGitUnavailable } = vi.hoisted(() => ({
	headSpy: vi.fn(),
	insideSpy: vi.fn(),
	resolveSpy: vi.fn(),
	FakeGitUnavailable: class GitUnavailableError extends Error {}
}));

vi.mock('$lib/server/git-probe', () => ({
	GitUnavailableError: FakeGitUnavailable,
	gitFileHead: headSpy,
	isInsideRoot: insideSpy,
	resolveEnclosingRepo: resolveSpy
}));

import { GET } from '../../src/routes/api/workspace/git-file-head/+server';

function get(query: string): Promise<Response> {
	return GET({ url: new URL('http://localhost/api/workspace/git-file-head' + query) } as never) as Promise<Response>;
}

const PARAMS = '?sessionId=s1&root=' + encodeURIComponent('/ws') + '&path=' + encodeURIComponent('app/src/a.ts');

beforeEach(() => {
	headSpy.mockReset();
	insideSpy.mockReset();
	resolveSpy.mockReset();
});

describe('GET /api/workspace/git-file-head', () => {
	it('rejects missing params with 400 before anything runs', async () => {
		expect((await get('')).status).toBe(400);
		expect((await get('?sessionId=s1&root=/ws')).status).toBe(400);
	});

	it('a path no repo encloses is a 404 no-repo', async () => {
		resolveSpy.mockResolvedValueOnce(null);
		const res = await get(PARAMS);
		expect(res.status).toBe(404);
		expect((await res.json()).error.code).toBe('no-repo');
	});

	it('refuses a repo outside the workspace root with 403 outside-workspace', async () => {
		resolveSpy.mockResolvedValueOnce({ repo: '/elsewhere/app', rel: 'src/a.ts' });
		insideSpy.mockResolvedValueOnce(false);
		const res = await get(PARAMS);
		expect(res.status).toBe(403);
		expect((await res.json()).error.code).toBe('outside-workspace');
		expect(headSpy).not.toHaveBeenCalled();
	});

	it('answers the head text for a tracked file', async () => {
		resolveSpy.mockResolvedValueOnce({ repo: '/ws/app', rel: 'src/a.ts' });
		insideSpy.mockResolvedValueOnce(true);
		headSpy.mockResolvedValueOnce('before text\n');
		const res = await get(PARAMS);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, enabled: true, head: 'before text\n' });
	});

	it('answers head null for an untracked file (the honest no-before)', async () => {
		resolveSpy.mockResolvedValueOnce({ repo: '/ws/app', rel: 'new.ts' });
		insideSpy.mockResolvedValueOnce(true);
		headSpy.mockResolvedValueOnce(null);
		const res = await get(PARAMS);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, enabled: true, head: null });
	});

	it('a missing git binary is a VISIBLE ok:false git-unavailable failure', async () => {
		resolveSpy.mockResolvedValueOnce({ repo: '/ws/app', rel: 'a.ts' });
		insideSpy.mockResolvedValueOnce(true);
		headSpy.mockRejectedValueOnce(new FakeGitUnavailable('the git binary is not available'));
		const res = await get(PARAMS);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ ok: false, code: 'git-unavailable' });
	});
});

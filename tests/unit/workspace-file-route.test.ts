/**
 * workspace-file route tests (W2 task 2.1-T, spec "2026-09-09 - DSI
 * Workspace Explorer") — GET /api/dsh/workspace-file, the ONE route that
 * touches host file bytes (ADR "The Workspace Explorer" D2):
 *   - a valid request forwards {sessionId, path, range?} to
 *     readWorkspaceFile and resolves {ok:true, file} (200);
 *   - missing sessionId / path and non-positive page params reject 400
 *     BEFORE any rpc;
 *   - every host refusal maps its HTTP status (404/403/413/415) with the
 *     host's verbatim code + message — a panel never renders blank;
 *   - any other DshRpcError is 502; a transport failure is 503.
 *
 * Handlers invoked directly with a URLSearchParam-backed Request; the
 * connection is mocked (the established goal-route.test.ts pattern).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DshRpcError } from '$lib/server/dsh-rpc';

const readWorkspaceFileSpy = vi.fn();
const workspaceOwnerSessionIdSpy = vi.fn();
vi.mock('$lib/server/dsh-connection', () => ({
	getDshConnection: () => ({
		readWorkspaceFile: readWorkspaceFileSpy,
		// Root-owner resolution: identity stub (root resolves to itself),
		// so the forwarded-sessionId pins hold.
		workspaceOwnerSessionId: workspaceOwnerSessionIdSpy
	})
}));

import { GET } from '../../src/routes/api/dsh/workspace-file/+server';

function get(query: string): Promise<Response> {
	return GET({
		url: new URL('http://localhost/api/dsh/workspace-file' + query)
	} as never) as Promise<Response>;
}

const FILE = {
	offset: 1,
	text: '# Stub Workspace',
	lines: 1,
	eof: false,
	absolutePath: '/tmp/dsi-e2e-ws/README.md',
	version: 'v1'
};

beforeEach(() => {
	readWorkspaceFileSpy.mockReset();
	workspaceOwnerSessionIdSpy.mockReset();
	workspaceOwnerSessionIdSpy.mockImplementation(async (sid: string) => sid);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('GET /api/dsh/workspace-file — happy path (2.1-T)', () => {
	it('forwards {sessionId, path} with no range when no page params are given', async () => {
		readWorkspaceFileSpy.mockResolvedValueOnce(FILE);
		const res = await get('?sessionId=s1&path=README.md');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, file: FILE });
		expect(readWorkspaceFileSpy).toHaveBeenCalledExactlyOnceWith('s1', 'README.md', undefined);
	});

	it('forwards offset/limit as the line window', async () => {
		readWorkspaceFileSpy.mockResolvedValueOnce({ ...FILE, offset: 3, lines: 2, eof: true });
		const res = await get('?sessionId=s1&path=README.md&offset=3&limit=2');
		expect(res.status).toBe(200);
		expect(readWorkspaceFileSpy).toHaveBeenCalledExactlyOnceWith('s1', 'README.md', { offset: 3, limit: 2 });
	});

	it('URL-encoded unicode/space paths decode before the rpc', async () => {
		readWorkspaceFileSpy.mockResolvedValueOnce(FILE);
		await get('?sessionId=s1&path=' + encodeURIComponent('docs/笔记 文件.md'));
		expect(readWorkspaceFileSpy).toHaveBeenCalledWith('s1', 'docs/笔记 文件.md', undefined);
	});
});

describe('GET /api/dsh/workspace-file — 400 before any rpc (2.1-T)', () => {
	it.each([
		['missing sessionId', '?path=README.md'],
		['blank sessionId', '?sessionId=%20%20&path=README.md'],
		['missing path', '?sessionId=s1'],
		['empty path', '?sessionId=s1&path='],
		['zero offset', '?sessionId=s1&path=a&offset=0'],
		['negative limit', '?sessionId=s1&path=a&limit=-2'],
		['fractional limit', '?sessionId=s1&path=a&limit=1.5'],
		['non-numeric offset', '?sessionId=s1&path=a&offset=one']
	])('rejects %s with 400', async (_name, query) => {
		const res = await get(query);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.ok).toBe(false);
		expect(body.error.code).toMatch(/^bad-/);
		expect(readWorkspaceFileSpy).not.toHaveBeenCalled();
	});
});

describe('GET /api/dsh/workspace-file — refusal mapping (2.1-T)', () => {
	it.each([
		['workspace-file/not-found', 404],
		['workspace-file/outside-workspace', 403],
		['workspace-file/too-large', 413],
		['workspace-file/not-text', 415],
		['workspace-file/not-regular-file', 415]
	])('maps %s to HTTP %i with the host message verbatim', async (code, status) => {
		readWorkspaceFileSpy.mockRejectedValueOnce(new DshRpcError(code, 'host said why', { path: 'x' }));
		const res = await get('?sessionId=s1&path=x');
		expect(res.status).toBe(status);
		const body = await res.json();
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe(code);
		expect(body.error.message).toBe('DSH RPC ' + code + ': host said why');
	});

	it('maps an unknown host rejection to 502 and a transport failure to 503', async () => {
		readWorkspaceFileSpy.mockRejectedValueOnce(new DshRpcError('gateway/arguments-invalid', 'bad args'));
		expect((await get('?sessionId=s1&path=x')).status).toBe(502);
		readWorkspaceFileSpy.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
		expect((await get('?sessionId=s1&path=x')).status).toBe(503);
	});
});

/**
 * workspace-tree route tests (bugfix 2026-09-09) — GET
 * /api/dsh/workspace-tree, the live tree's listing seam
 * (workspaceFiles/list, session-authorized):
 *   - forwards {sessionId, path} with '' defaulting to the root;
 *   - missing sessionId rejects 400 before any rpc;
 *   - not-found / outside-workspace / not-directory map 404/403/415;
 *   - unknown host rejection → 502; transport failure → 503.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DshRpcError } from '$lib/server/dsh-rpc';

const listWorkspaceDirectorySpy = vi.fn();
const workspaceOwnerSessionIdSpy = vi.fn();
vi.mock('$lib/server/dsh-connection', () => ({
	getDshConnection: () => ({
		listWorkspaceDirectory: listWorkspaceDirectorySpy,
		// Root-owner resolution: the stub is an IDENTITY (a root session
		// resolves to itself), so the forwarded-sessionId pins hold.
		workspaceOwnerSessionId: workspaceOwnerSessionIdSpy
	})
}));

import { GET } from '../../src/routes/api/dsh/workspace-tree/+server';

function get(query: string): Promise<Response> {
	return GET({ url: new URL('http://localhost/api/dsh/workspace-tree' + query) } as never) as Promise<Response>;
}

const LISTING = { path: '', entries: [{ name: 'README.md', type: 'file' }], truncated: false };

beforeEach(() => {
	listWorkspaceDirectorySpy.mockReset();
	workspaceOwnerSessionIdSpy.mockReset();
	workspaceOwnerSessionIdSpy.mockImplementation(async (sid: string) => sid);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('GET /api/dsh/workspace-tree (bugfix)', () => {
	it('forwards {sessionId, path} — absent path lists the root as \'\'', async () => {
		listWorkspaceDirectorySpy.mockResolvedValueOnce(LISTING);
		const res = await get('?sessionId=s1');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, listing: LISTING });
		expect(listWorkspaceDirectorySpy).toHaveBeenCalledExactlyOnceWith('s1', '');
	});

	it('forwards the nested relative path verbatim', async () => {
		listWorkspaceDirectorySpy.mockResolvedValueOnce({ ...LISTING, path: 'docs' });
		await get('?sessionId=s1&path=' + encodeURIComponent('docs/sub dir'));
		expect(listWorkspaceDirectorySpy).toHaveBeenCalledWith('s1', 'docs/sub dir');
	});

	it('addresses the RPC at the ROOT owner for a sub-agent session (2026-09-10)', async () => {
		listWorkspaceDirectorySpy.mockResolvedValueOnce(LISTING);
		workspaceOwnerSessionIdSpy.mockResolvedValueOnce('root-1');
		await get('?sessionId=sub-1&path=');
		expect(listWorkspaceDirectorySpy).toHaveBeenCalledWith('root-1', '');
	});

	it('rejects a missing sessionId with 400 before any rpc', async () => {
		const res = await get('?path=docs');
		expect(res.status).toBe(400);
		expect(listWorkspaceDirectorySpy).not.toHaveBeenCalled();
	});

	it.each([
		['workspace-file/not-found', 404],
		['workspace-file/outside-workspace', 403],
		['workspace-file/not-directory', 415]
	])('maps %s to HTTP %i with the host code verbatim', async (code, status) => {
		listWorkspaceDirectorySpy.mockRejectedValueOnce(new DshRpcError(code, 'host said why'));
		const res = await get('?sessionId=s1');
		expect(res.status).toBe(status);
		const body = await res.json();
		expect(body.error.code).toBe(code);
	});

	it('maps an unknown host rejection to 502 and a transport failure to 503', async () => {
		listWorkspaceDirectorySpy.mockRejectedValueOnce(new DshRpcError('gateway/arguments-invalid', 'x'));
		expect((await get('?sessionId=s1')).status).toBe(502);
		listWorkspaceDirectorySpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
		expect((await get('?sessionId=s1')).status).toBe(503);
	});
});

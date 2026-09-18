/**
 * workspace-file-bytes route tests (2026-09-10) — GET
 * /api/dsh/workspace-file-bytes, the binary preview seam
 * (workspaceFiles/readBytes, image extensions only):
 *   - happy path joins the byte windows and answers the image mime;
 *   - missing sessionId/path reject 400; unknown extension rejects 415;
 *   - not-found maps 404; unknown host rejection → 502.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DshRpcError } from '$lib/server/dsh-rpc';

const readWorkspaceFileBytesSpy = vi.fn();
const workspaceOwnerSessionIdSpy = vi.fn();
vi.mock('$lib/server/dsh-connection', () => ({
	getDshConnection: () => ({
		readWorkspaceFileBytes: readWorkspaceFileBytesSpy,
		// identity root-owner resolution (a root resolves to itself)
		workspaceOwnerSessionId: workspaceOwnerSessionIdSpy
	})
}));

import { GET } from '../../src/routes/api/dsh/workspace-file-bytes/+server';

function get(query: string): Promise<Response> {
	return GET({ url: new URL('http://localhost/api/dsh/workspace-file-bytes' + query) } as never) as Promise<Response>;
}

// a 4-byte "png" split across two windows of 3
const B64 = (bytes: number[]) => Buffer.from(bytes).toString('base64');

beforeEach(() => {
	readWorkspaceFileBytesSpy.mockReset();
	workspaceOwnerSessionIdSpy.mockReset();
	workspaceOwnerSessionIdSpy.mockImplementation(async (sid: string) => sid);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('GET /api/dsh/workspace-file-bytes', () => {
	it('joins the windows and answers the image mime', async () => {
		readWorkspaceFileBytesSpy
			.mockResolvedValueOnce({ offset: 0, data: B64([1, 2, 3]), eof: false, absolutePath: '/w/a.png', version: 'v' })
			.mockResolvedValueOnce({ offset: 3, data: B64([4]), eof: true, absolutePath: '/w/a.png', version: 'v' });
		const res = await get('?sessionId=s1&path=%2Fw%2Fa.png');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/png');
		expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from([1, 2, 3, 4]));
		expect(readWorkspaceFileBytesSpy).toHaveBeenNthCalledWith(1, 's1', '/w/a.png', { offset: 0, length: 512 * 1024 });
		expect(readWorkspaceFileBytesSpy).toHaveBeenNthCalledWith(2, 's1', '/w/a.png', { offset: 3, length: 512 * 1024 });
	});

	it('rejects a missing sessionId with 400 before any rpc', async () => {
		const res = await get('?path=%2Fw%2Fa.png');
		expect(res.status).toBe(400);
		expect(readWorkspaceFileBytesSpy).not.toHaveBeenCalled();
	});

	it('rejects an unknown image extension with 415', async () => {
		const res = await get('?sessionId=s1&path=%2Fw%2Fa.exe');
		expect(res.status).toBe(415);
		expect(readWorkspaceFileBytesSpy).not.toHaveBeenCalled();
	});

	it('maps workspace-file/not-found to HTTP 404 with the host message verbatim', async () => {
		readWorkspaceFileBytesSpy.mockRejectedValueOnce(
			new DshRpcError('workspace-file/not-found', 'host said why')
		);
		const res = await get('?sessionId=s1&path=%2Fw%2Fa.png');
		expect(res.status).toBe(404);
		expect((await res.json()).error.message).toContain('host said why');
	});

	it('maps an unknown host rejection to 502', async () => {
		readWorkspaceFileBytesSpy.mockRejectedValueOnce(new DshRpcError('session/not-found', 'nope'));
		const res = await get('?sessionId=s1&path=%2Fw%2Fa.png');
		expect(res.status).toBe(502);
	});
});

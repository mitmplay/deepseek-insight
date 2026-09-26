/**
 * workspace-file-bytes route tests (2026-09-10; direct-fs 2026-09-28) — GET
 * /api/dsh/workspace-file-bytes, the binary preview seam (plain filesystem
 * read, contained to the workspace root — no RPC):
 *   - happy path answers the image mime with the file's bytes;
 *   - missing root/path reject 400; unknown extension rejects 415;
 *   - a ".." walk outside the root rejects 403; missing file rejects 404;
 *   - a directory rejects 415.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { GET } from '../../src/routes/api/dsh/workspace-file-bytes/+server';

function get(query: string): Promise<Response> {
	return GET({ url: new URL('http://localhost/api/dsh/workspace-file-bytes' + query) } as never) as Promise<Response>;
}

let repo: string | null = null;
afterEach(() => {
	if (repo !== null) {
		rmSync(repo, { recursive: true, force: true });
		repo = null;
	}
});

function workspace(): string {
	repo = mkdtempSync(path.join(tmpdir(), 'dsi-bytes-'));
	return repo;
}

describe('GET /api/dsh/workspace-file-bytes', () => {
	it('answers the image mime with the file bytes', async () => {
		const root = workspace();
		writeFileSync(path.join(root, 'a.png'), Buffer.from([1, 2, 3, 4]));
		const res = await get('?root=' + encodeURIComponent(root) + '&path=a.png');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/png');
		expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from([1, 2, 3, 4]));
	});

	it('reads a nested root-relative path', async () => {
		const root = workspace();
		mkdirSync(path.join(root, 'assets'));
		writeFileSync(path.join(root, 'assets', 'b.svg'), '<svg/>');
		const res = await get('?root=' + encodeURIComponent(root) + '&path=assets%2Fb.svg');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/svg+xml');
	});

	it('rejects a missing root with 400', async () => {
		const res = await get('?path=a.png');
		expect(res.status).toBe(400);
	});

	it('rejects a missing path with 400', async () => {
		const res = await get('?root=' + encodeURIComponent(tmpdir()));
		expect(res.status).toBe(400);
	});

	it('rejects an unknown image extension with 415', async () => {
		const root = workspace();
		writeFileSync(path.join(root, 'a.exe'), 'bin');
		const res = await get('?root=' + encodeURIComponent(root) + '&path=a.exe');
		expect(res.status).toBe(415);
	});

	it('rejects a ".." walk outside the root with 403', async () => {
		const root = workspace();
		const res = await get('?root=' + encodeURIComponent(root) + '&path=' + encodeURIComponent('../x.png'));
		expect(res.status).toBe(403);
	});

	it('maps a missing file to 404', async () => {
		const root = workspace();
		const res = await get('?root=' + encodeURIComponent(root) + '&path=nope.png');
		expect(res.status).toBe(404);
		expect((await res.json()).error.code).toBe('workspace-file/not-found');
	});

	it('rejects a directory with 415', async () => {
		const root = workspace();
		mkdirSync(path.join(root, 'dir.png'));
		const res = await get('?root=' + encodeURIComponent(root) + '&path=dir.png');
		expect(res.status).toBe(415);
	});
});

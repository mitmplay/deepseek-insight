/**
 * file-write route tests (File Eye task 1.3-T): the direct save —
 * refusal BEFORE any fs touch (bad body, closed gate, outside-root over
 * realpaths) and the happy path writing exact bytes over a REAL temp
 * file tree.
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { gateSpy, insideSpy } = vi.hoisted(() => ({
	gateSpy: vi.fn(),
	insideSpy: vi.fn()
}));

vi.mock('$lib/server/git-probe', () => ({
	gitGateEnabled: gateSpy,
	isInsideRoot: insideSpy
}));

import { POST } from '../../src/routes/api/workspace/file-write/+server';

function post(body: unknown): Promise<Response> {
	return POST({ request: new Request('http://localhost/api/workspace/file-write', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	}) } as never) as Promise<Response>;
}

beforeEach(() => {
	gateSpy.mockReset();
	insideSpy.mockReset();
	gateSpy.mockResolvedValue(true);
	insideSpy.mockResolvedValue(true);
});

describe('POST /api/workspace/file-write', () => {
	it('rejects a non-JSON body and missing fields with 400, fs untouched', async () => {
		expect((await post('not json{')).status).toBe(400);
		expect((await post({ sessionId: 's1' })).status).toBe(400);
		expect((await post({ sessionId: 's1', root: '/ws', path: 'a.txt' })).status).toBe(400);
	});

	it('a closed gate is a 403 gate-closed BEFORE the filesystem is touched', async () => {
		gateSpy.mockResolvedValueOnce(false);
		const res = await post({ sessionId: 's1', root: '/ws', path: 'a.txt', content: 'x' });
		expect(res.status).toBe(403);
		expect((await res.json()).error.code).toBe('gate-closed');
		expect(insideSpy).not.toHaveBeenCalled();
	});

	it('refuses a path outside the workspace root with 403 outside-workspace', async () => {
		insideSpy.mockResolvedValueOnce(false);
		const res = await post({ sessionId: 's1', root: '/ws', path: '../escape.txt', content: 'x' });
		expect(res.status).toBe(403);
		expect((await res.json()).error.code).toBe('outside-workspace');
	});

	it('writes the EXACT bytes for a contained path', async () => {
		const dir = await fs.mkdtemp(nodePath.join(tmpdir(), 'file-write-'));
		await fs.writeFile(nodePath.join(dir, 'existing.txt'), 'old\n');
		try {
			const res = await post({ sessionId: 's1', root: dir, path: 'existing.txt', content: 'new exact bytes\n' });
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ ok: true, written: true });
			await expect(fs.readFile(nodePath.join(dir, 'existing.txt'), 'utf8')).resolves.toBe('new exact bytes\n');
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it('traversal-shaped paths cannot smuggle a write past containment', async () => {
		const dir = await fs.mkdtemp(nodePath.join(tmpdir(), 'file-write-esc-'));
		try {
			// insideSpy answers like the REAL isInsideRoot would for ../escape:
			// the realpath of the target falls outside the root → false.
			insideSpy.mockReset();
			insideSpy.mockResolvedValueOnce(false);
			const res = await post({ sessionId: 's1', root: dir, path: '../outside.txt', content: 'x' });
			expect(res.status).toBe(403);
			await expect(fs.readFile(nodePath.resolve(dir, '..', 'outside.txt'), 'utf8')).rejects.toThrow();
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
			await fs.rm(nodePath.resolve(dir, '..', 'outside.txt'), { force: true });
		}
	});

	it('surfaces a write failure honestly (missing parent dir)', async () => {
		const dir = await fs.mkdtemp(nodePath.join(tmpdir(), 'file-write-miss-'));
		try {
			const res = await post({ sessionId: 's1', root: dir, path: 'no/such/dir/f.txt', content: 'x' });
			expect(res.status).toBe(500);
			expect((await res.json()).error.code).toBe('write-failed');
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
});

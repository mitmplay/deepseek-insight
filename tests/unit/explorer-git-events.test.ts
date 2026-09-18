/**
 * The git-events SSE route (Index Pulse W2): contract per ADR D3/D5 —
 * gate at connect, first generation event, ring bumps delivered, abort
 * releases the watcher lease, closed gate answers JSON not a stream.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { closeAllForTests, getGeneration, DEBOUNCE_MS } from '$lib/server/git-watch';

vi.mock('$lib/server/git-probe', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/git-probe')>();
	return {
		...actual,
		gitGateEnabled: vi.fn(async () => (globalThis as any).__dsiPulseGate ?? false)
	};
});

const { GET } = await import('../../src/routes/api/workspace/git-events/+server');

function tmpRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), 'dsi-pulse-route-'));
	execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'ignore' });
	return dir;
}

const DEBOUNCE_WAIT = DEBOUNCE_MS + 200;

function makeRequest(): Request {
	return new Request('http://localhost/', { signal: new AbortController().signal });
}

/** Hold ONE reader per stream: read until `wanted` SSE events have arrived
 *  or the deadline passes. Never cancels — the stream stays open for the
 *  next read (cancelling releases the route's lease, which is the very
 *  lifecycle under test). */
function makeCollector(res: Response) {
	const reader = res.body!.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	return async function readUntil(wanted: number, ms: number): Promise<string> {
		const deadline = Date.now() + ms;
		while (buffer.split('event: ').length - 1 < wanted && Date.now() < deadline) {
			const chunk = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r('TIMEOUT'), 100))]);
			if (chunk === 'TIMEOUT') continue;
			const cast = chunk as ReadableStreamReadResult<Uint8Array>;
			if (cast.done) break;
			buffer += decoder.decode(cast.value, { stream: true });
		}
		return buffer;
	};
}

async function readUntilFirst(read: (w: number, ms: number) => Promise<string>): Promise<string> {
	return read(1, 2000);
}

afterEach(async () => {
	(globalThis as any).__dsiPulseGate = false;
	await closeAllForTests();
});

describe('git-events SSE route', () => {
	it('missing params answer 400 bad-params', async () => {
		const url = new URL('http://localhost/api/workspace/git-events');
		const res = await GET({ url, request: makeRequest() } as any);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe('bad-params');
	});

	it('a closed gate answers JSON enabled:false — never a stream', async () => {
		const repo = tmpRepo();
		try {
			const url = new URL('http://localhost/api/workspace/git-events?sessionId=s1&root=' + encodeURIComponent(repo) + '&repo=' + encodeURIComponent(repo));
			const res = await GET({ url, request: makeRequest() } as any);
			expect(res.headers.get('content-type')).not.toContain('text/event-stream');
			const body = await res.json();
			expect(body).toEqual({ ok: true, enabled: false });
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it('an outside-workspace repo answers 403', async () => {
		(globalThis as any).__dsiPulseGate = true;
		const outer = tmpRepo();
		const inner = tmpRepo();
		try {
			const url = new URL('http://localhost/api/workspace/git-events?sessionId=s1&root=' + encodeURIComponent(outer) + '&repo=' + encodeURIComponent(inner));
			const res = await GET({ url, request: makeRequest() } as any);
			expect(res.status).toBe(403);
			const body = await res.json();
			expect(body.error.code).toBe('outside-workspace');
		} finally {
			rmSync(outer, { recursive: true, force: true });
			rmSync(inner, { recursive: true, force: true });
		}
	});

	it('open gate streams text/event-stream with the initial generation, and a ring delivers a bump', async () => {
		(globalThis as any).__dsiPulseGate = true;
		const repo = tmpRepo();
		try {
			const controller = new AbortController();
			const url = new URL('http://localhost/api/workspace/git-events?sessionId=s1&root=' + encodeURIComponent(repo) + '&repo=' + encodeURIComponent(repo));
			const res = await GET({ url, request: new Request('http://localhost/', { signal: controller.signal }) } as any);
			expect(res.headers.get('content-type')).toContain('text/event-stream');
			expect(res.headers.get('x-accel-buffering')).toBe('no');
			const read = makeCollector(res);
			const first = await readUntilFirst(read);
			expect(first).toContain('event: generation');
			// ring through the REAL path: a real status change (gate mock stays open)
			const before = getGeneration(repo);
			writeFileSync(join(repo, 'ring.txt'), 'r\n');
			execFileSync('git', ['-C', repo, 'add', 'ring.txt'], { stdio: 'ignore' });
			await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT));
			expect(getGeneration(repo)).toBe(before + 1);
			const all = await read(2, 2000);
			expect(all.split('event: generation').length - 1).toBeGreaterThanOrEqual(2);
			controller.abort();
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it('abort releases the lease: the watcher is gone after client disconnect', async () => {
		(globalThis as any).__dsiPulseGate = true;
		const repo = tmpRepo();
		try {
			const { watcherRefCount } = await import('$lib/server/git-watch');
			const controller = new AbortController();
			const url = new URL('http://localhost/api/workspace/git-events?sessionId=s1&root=' + encodeURIComponent(repo) + '&repo=' + encodeURIComponent(repo));
			const resPromise = GET({ url, request: new Request('http://localhost/', { signal: controller.signal }) } as any);
			await resPromise;
			await new Promise((r) => setTimeout(r, 100));
			expect(watcherRefCount(repo, repo)).toBe(1);
			controller.abort();
			await new Promise((r) => setTimeout(r, 150));
			expect(watcherRefCount(repo, repo)).toBeNull();
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});

	it('a ring whose gate re-check fails emits enabled:false', async () => {
		(globalThis as any).__dsiPulseGate = true;
		const repo = tmpRepo();
		try {
			const controller = new AbortController();
			const url = new URL('http://localhost/api/workspace/git-events?sessionId=s1&root=' + encodeURIComponent(repo) + '&repo=' + encodeURIComponent(repo));
			const res = await GET({ url, request: new Request('http://localhost/', { signal: controller.signal }) } as any);
			const read = makeCollector(res);
			await read(1, 2000); // consume the initial generation event
			(globalThis as any).__dsiPulseGate = false; // gate dies mid-stream
			writeFileSync(join(repo, 'outage.txt'), 'o\n');
			execFileSync('git', ['-C', repo, 'add', 'outage.txt'], { stdio: 'ignore' });
			await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT));
			const tail = await read(2, 2500);
			expect(tail).toContain('event: enabled');
			expect(tail).toContain('data: false');
			controller.abort();
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});
});

// --- Coverage round: the untaken seams — gate-probe transport failure
// (non-DshRpcError → 503 host-unreachable JSON) and stream cancel()
// releasing the watcher lease. ---

describe('git-events SSE route — failure and cancel seams', () => {
	it('a gate-probe transport failure answers 503 host-unreachable JSON', async () => {
		const { gitGateEnabled } = await import('$lib/server/git-probe');
		const url = new URL('http://localhost/api/workspace/git-events?sessionId=s1&root=%2Ftmp&repo=%2Ftmp');
		(gitGateEnabled as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new TypeError('fetch failed'));
		try {
			const res = await GET({ url, request: makeRequest() } as any);
			expect(res.status).toBe(503);
			const body = await res.json();
			expect(body.ok).toBe(false);
			expect(body.error.code).toBe('host-unreachable');
		} finally {
			(gitGateEnabled as ReturnType<typeof vi.fn>).mockReset();
		}
	});

	it('a DshRpcError gate failure maps to 502 with the host code', async () => {
		const { DshRpcError } = await import('$lib/server/dsh-rpc');
		const { gitGateEnabled } = await import('$lib/server/git-probe');
		const url = new URL('http://localhost/api/workspace/git-events?sessionId=s1&root=%2Ftmp&repo=%2Ftmp');
		(gitGateEnabled as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new DshRpcError('SESSION_NOT_FOUND', 'session/not-found'));
		try {
			const res = await GET({ url, request: makeRequest() } as any);
			expect(res.status).toBe(502);
			expect((await res.json()).error.code).toBe('SESSION_NOT_FOUND');
		} finally {
			(gitGateEnabled as ReturnType<typeof vi.fn>).mockReset();
		}
	});

	it('cancelling the stream body releases the watcher lease (cancel → cleanup)', async () => {
		(globalThis as any).__dsiPulseGate = true;
		const repo = tmpRepo();
		try {
			const url = new URL('http://localhost/api/workspace/git-events?sessionId=s1&root=' + encodeURIComponent(repo) + '&repo=' + encodeURIComponent(repo));
			const res = await GET({ url, request: makeRequest() } as any);
			const reader = res.body!.getReader();
			await reader.read(); // initial generation event flows
			const { watcherRefCount } = await import('$lib/server/git-watch');
			await new Promise((r) => setTimeout(r, 100));
			expect(watcherRefCount(repo, repo)).toBe(1);
			await reader.cancel();
			await new Promise((r) => setTimeout(r, 150));
			expect(watcherRefCount(repo, repo)).toBeNull();
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});
});

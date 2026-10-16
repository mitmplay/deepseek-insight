// @vitest-environment node
/**
 * Jobs API route (Job Badge Wave 1, Task 1.3-T) — the edge contract:
 * GET refuses a missing sessionId (400), forwards the snapshot verbatim,
 * maps RPC failures through mapRpcFailure/statusFor; POST refuses bad JSON,
 * missing sessionId/jobId, forwards the kill verbatim, and surfaces the
 * fence refusal (belongs to another session) instead of masking it.
 * Spec: dev/specs/2026-10/2026-10-16 - Job Badge.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DshRpcError as TDshRpcError } from '$lib/server/dsh-rpc';

interface FakeApi {
	relay: {
		touchJobRoster: (sessionId: string) => void;
		jobRosterSnapshot: (sessionId: string) => { jobs: unknown[]; pending: boolean };
		jobKill: (sessionId: string, jobId: string) => Promise<unknown>;
	};
}

let fake: FakeApi;
let DshRpcError: typeof TDshRpcError;

function jsonRequest(url: string): never {
	return { url: new URL(url, 'http://x'), request: new Request('http://x') } as never;
}

function postRequest(body: unknown): never {
	return {
		url: new URL('http://x/api/dsh/jobs'),
		request: new Request('http://x/api/dsh/jobs', {
			method: 'POST',
			body: body === 'NOT-JSON' ? 'NOT-JSON' : JSON.stringify(body),
			headers: { 'content-type': 'application/json' }
		})
	} as never;
}

async function importRouteFresh() {
	vi.resetModules();
	const conn = await import('$lib/server/dsh-connection');
	vi.spyOn(conn, 'getDshConnection').mockImplementation(() => fake as never);
	DshRpcError = (await import('$lib/server/dsh-rpc')).DshRpcError;
	return import('../../src/routes/api/dsh/jobs/+server');
}

beforeEach(() => {
	fake = {
		relay: {
			touchJobRoster: vi.fn(),
			jobRosterSnapshot: vi.fn(() => ({ jobs: [], pending: true })),
			jobKill: vi.fn(async () => ({ outcome: 'requested' }))
		}
	};
});
afterEach(() => vi.restoreAllMocks());

describe('GET /api/dsh/jobs', () => {
	it('refuses a missing sessionId with 400', async () => {
		const route = await importRouteFresh();
		const res = await route.GET(jsonRequest('http://x/api/dsh/jobs'));
		expect(res.status).toBe(400);
	});

	it('touches the watch heartbeat and serves the mirror frame verbatim', async () => {
		const jobs = [{ id: 'bash-1', kind: 'bash', label: 't', status: 'running', startedAt: 1, output: { total: 0, earliest: 0 } }];
		fake.relay.jobRosterSnapshot = vi.fn(() => ({ jobs, pending: false }));
		const route = await importRouteFresh();
		const res = await route.GET(jsonRequest('http://x/api/dsh/jobs?sessionId=conv-1'));
		expect(fake.relay.touchJobRoster).toHaveBeenCalledWith('conv-1');
		const body = await res.json();
		expect(body).toEqual({ ok: true, sessionId: 'conv-1', jobs });
	});

	it('serves an honest pending before the first frame', async () => {
		fake.relay.jobRosterSnapshot = vi.fn(() => ({ jobs: [], pending: true }));
		const route = await importRouteFresh();
		const res = await route.GET(jsonRequest('http://x/api/dsh/jobs?sessionId=conv-1'));
		const body = await res.json();
		expect(body).toEqual({ ok: true, sessionId: 'conv-1', jobs: [], pending: true });
	});

	it('maps a relay failure to its mapped status', async () => {
		fake.relay.touchJobRoster = vi.fn(() => {
			throw new DshRpcError('job/list', 'boom', { code: 'gateway/unavailable' });
		});
		const route = await importRouteFresh();
		const res = await route.GET(jsonRequest('http://x/api/dsh/jobs?sessionId=conv-1'));
		expect(res.status).not.toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(false);
	});
});

describe('POST /api/dsh/jobs', () => {
	it('refuses invalid JSON with 400', async () => {
		const route = await importRouteFresh();
		const res = await route.POST(postRequest('NOT-JSON'));
		expect(res.status).toBe(400);
	});

	it('refuses a missing jobId with 400', async () => {
		const route = await importRouteFresh();
		const res = await route.POST(postRequest({ sessionId: 'conv-1' }));
		expect(res.status).toBe(400);
	});

	it('forwards the kill verbatim and returns the outcome', async () => {
		const route = await importRouteFresh();
		const res = await route.POST(postRequest({ sessionId: 'conv-1', jobId: 'bash-1' }));
		expect(fake.relay.jobKill).toHaveBeenCalledWith('conv-1', 'bash-1');
		const body = await res.json();
		expect(body).toEqual({ ok: true, outcome: 'requested' });
	});

	it('surfaces the fence refusal (belongs to another session) as a mapped error', async () => {
		fake.relay.jobKill = vi.fn(async () => {
			throw new DshRpcError('job/kill', 'job bash-1 belongs to another session', {
				code: 'job/not-found'
			});
		});
		const route = await importRouteFresh();
		const res = await route.POST(postRequest({ sessionId: 'conv-1', jobId: 'bash-1' }));
		expect(res.status).not.toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(false);
	});
});

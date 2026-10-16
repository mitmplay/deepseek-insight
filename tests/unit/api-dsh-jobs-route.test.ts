import { describe, expect, it } from 'vitest';

import { GET, POST } from '../../src/routes/api/dsh/jobs/+server.js';
import { getDshConnection, resetDshConnectionForTests } from '$lib/server/dsh-connection';

/**
 * Route contract (Tasks 1.2-T): GET serves the mirror with an honest
 * pending flag; POST kill passthrough keeps its shape.
 */

function makeUrl(sessionId: string | null): URL {
	const u = new URL('http://localhost/api/dsh/jobs');
	if (sessionId !== null) u.searchParams.set('sessionId', sessionId);
	return u;
}

describe('GET /api/dsh/jobs — the roster mirror', () => {
	it('400s without a sessionId', async () => {
		const res = await GET({ url: makeUrl(null) } as never);
		const body = await res.json();
		expect(res.status).toBe(400);
		expect(body.ok).toBe(false);
	});

	it('answers pending before the first frame and the frame after', async () => {
		resetDshConnectionForTests();
		const relay = getDshConnection().relay;
		relay.jobRosterGraceMs = 60_000;
		const opened: string[] = [];
		relay.wireJobRosterTransport({ open: (s) => opened.push(s), close: () => {} });
		const pending = await GET({ url: makeUrl('session-a') } as never);
		const pendingBody = await pending.json();
		expect(pendingBody).toMatchObject({ ok: true, sessionId: 'session-a', jobs: [], pending: true });
		expect(opened).toContain('session-a');
		relay.onJobRosterItem('session-a', { jobs: [{ id: 'bash-9', status: 'running' }] });
		const filled = await GET({ url: makeUrl('session-a') } as never);
		const filledBody = await filled.json();
		expect(filledBody).toEqual({ ok: true, sessionId: 'session-a', jobs: [{ id: 'bash-9', status: 'running' }] });
		expect('pending' in filledBody).toBe(false);
		resetDshConnectionForTests();
	});
});

describe('POST /api/dsh/jobs — kill passthrough shape', () => {
	it('400s without jobId', async () => {
		const res = await POST({ request: new Request('http://x', { method: 'POST', body: JSON.stringify({ sessionId: 's' }) }) } as never);
		expect(res.status).toBe(400);
	});
});

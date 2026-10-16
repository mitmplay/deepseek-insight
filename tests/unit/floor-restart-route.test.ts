import { describe, it, expect, vi, beforeEach } from 'vitest';

const chainMock = vi.fn(() => true);
vi.mock('$lib/server/plugins/restart-chain', () => ({ spawnRestartChain: (...a: unknown[]) => chainMock(...(a as [])) }));

import * as restartServer from '../../src/routes/api/floor/restart/+server.ts';
const { POST } = restartServer;
// GET is intentionally absent on the route (POST-only verb); the record view
// keeps the assertion honest without a failing named import.
const GET = (restartServer as unknown as Record<string, unknown>).GET;

// Answer-before-kill contract (ADR D1): the route answers { ok, restarting }
// from the chain's boolean; the DETACHED chain does the killing after.
describe('POST /api/floor/restart', () => {
	beforeEach(() => { chainMock.mockClear(); chainMock.mockImplementation(() => true); });

	it('answers { ok: true, restarting: true } when the chain spawns', async () => {
		const res = await POST({} as never);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ ok: true, restarting: true });
		expect(chainMock).toHaveBeenCalledTimes(1);
	});

	it('answers honest 500 when the chain cannot spawn', async () => {
		chainMock.mockImplementation(() => false);
		const res = await POST({} as never);
		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body.ok).toBe(false);
	});

	it('is POST-only (GET is not the restart verb)', () => {
		expect(GET).toBeUndefined();
	});
});

